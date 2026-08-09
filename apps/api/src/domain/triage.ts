import {
  ALERT_TYPE_META,
  CATEGORY_MULTIPLIER,
  PRIORITY_BANDS,
  SEVERITY_LABEL,
  SEVERITY_WEIGHT,
  SLA_ACK_MINUTES,
  STATUS_URGENCY_FACTOR,
  alertTypeCategory,
  isClosedStatus,
  isOpenStatus,
  type AlertStatus,
  type AlertType,
  type Priority,
  type Severity,
  type Triage,
} from '@incident-board/shared';

/**
 * The triage engine — the product opinion at the centre of this application.
 *
 * Sorting an operations queue by severity alone is not useful: it puts a `critical` alert that
 * someone is already fixing above a `high` alert nobody has looked at for six hours, and it
 * treats a 9 MW site the same as a 50 MW one. The score below combines four things an operator
 * would weigh anyway:
 *
 *   base   = severity × alert-type category × site capacity, relative to the portfolio
 *   age    = a proportional uplift while nobody has acknowledged it
 *   status = damping once someone is actually working the incident
 *
 * The uplift is *proportional* rather than additive on purpose. An additive term eventually
 * floats a low-severity curtailment notice to the top of the board simply because it is old,
 * which would train operators to ignore the ranking. A percentage of the item's own base keeps
 * trivia trivial no matter how long it sits.
 *
 * The function is pure and takes `now` as an argument: the same alert scores identically in a
 * test at a fixed instant and in production, and no part of the ranking is hidden in a clock.
 */

/** Fraction of base score added per hour unacknowledged. */
export const AGE_UPLIFT_PER_HOUR = 0.04;
/** Maximum age uplift, reached at 12.5 hours. */
export const AGE_UPLIFT_CAP = 0.5;
/** How much a site's share of portfolio capacity can raise its alerts. */
export const SITE_FACTOR_WEIGHT = 0.3;

export interface TriageInput {
  severity: Severity;
  type: AlertType;
  status: AlertStatus;
  detectedAt: string;
  acknowledgedAt: string | null;
  siteCapacityMw: number;
}

export interface TriageContext {
  now: Date;
  /** Largest site in the portfolio, used to normalise the capacity weighting. */
  portfolioMaxCapacityMw: number;
}

export function priorityForScore(score: number): Priority {
  for (const band of PRIORITY_BANDS) {
    if (score >= band.minScore) return band.priority;
  }
  // Unreachable: the last band's bound is -Infinity. Kept so the function is total.
  return 'P4';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`;
}

export function computeTriage(input: TriageInput, context: TriageContext): Triage {
  const detectedMs = Date.parse(input.detectedAt);
  const nowMs = context.now.getTime();

  // A row that survived hydration always has a parseable timestamp; treat anything else as
  // brand new rather than letting NaN poison the arithmetic. Clock skew that puts an alert in
  // the future is clamped to zero for the same reason.
  const ageMinutes = Number.isNaN(detectedMs)
    ? 0
    : Math.max(0, Math.round((nowMs - detectedMs) / 60_000));

  const severityWeight = SEVERITY_WEIGHT[input.severity];
  const category = alertTypeCategory(input.type);
  const categoryMultiplier = CATEGORY_MULTIPLIER[category];

  const capacityRatio =
    context.portfolioMaxCapacityMw > 0
      ? clamp(input.siteCapacityMw / context.portfolioMaxCapacityMw, 0, 1)
      : 0;
  const siteFactor = 1 + SITE_FACTOR_WEIGHT * capacityRatio;

  const base = severityWeight * categoryMultiplier * siteFactor;

  // The SLA is derived from the priority the alert had *at detection*, not from its escalated
  // priority. Otherwise the clock that escalates an alert would also tighten the deadline it is
  // being measured against, and everything old would be permanently in breach by construction.
  const basePriority = priorityForScore(base);
  const slaAckMinutes = SLA_ACK_MINUTES[basePriority];

  const escalating = input.status === 'new' || input.status === 'acknowledged';
  const ageUplift = escalating
    ? Math.min(AGE_UPLIFT_CAP, (ageMinutes / 60) * AGE_UPLIFT_PER_HOUR)
    : 0;

  const closed = isClosedStatus(input.status);
  const score = closed ? 0 : base * (1 + ageUplift) * STATUS_URGENCY_FACTOR[input.status];

  // A closed alert keeps the priority it was worked at. Showing "P4" beside a resolved
  // thermal-runaway alert would misrepresent the history for anyone reading it later.
  const priority = closed ? basePriority : priorityForScore(score);

  const { slaBreached, minutesToAcknowledge } = evaluateSla(input, ageMinutes, slaAckMinutes);

  const slaDueAt =
    input.status === 'new' && !Number.isNaN(detectedMs)
      ? new Date(detectedMs + slaAckMinutes * 60_000).toISOString()
      : null;

  // "Needs attention" is the act-now queue, so it means: nobody has started this, and it is
  // either urgent or overdue. A breached SLA counts — an alert nobody acknowledged for days is
  // a process failure worth surfacing on its own — except in P4, which is explicitly the
  // backlog band. Letting a month-old curtailment notice into this queue on an SLA technicality
  // is how a "needs attention" list becomes something operators learn to ignore. P4 breaches
  // still show a badge on the row and are counted in the SLA-breach statistic.
  const needsAttention =
    escalating && (priority === 'P1' || priority === 'P2' || (slaBreached && priority !== 'P4'));

  return {
    priority,
    basePriority,
    score: Math.round(score * 10) / 10,
    reasons: buildReasons({
      input,
      category,
      severityWeight,
      siteFactor,
      ageMinutes,
      ageUplift,
      slaBreached,
      slaAckMinutes,
      minutesToAcknowledge,
      closed,
    }),
    needsAttention,
    slaAckMinutes,
    slaBreached,
    slaDueAt,
    ageMinutes,
  };
}

function evaluateSla(
  input: TriageInput,
  ageMinutes: number,
  slaAckMinutes: number,
): { slaBreached: boolean; minutesToAcknowledge: number | null } {
  if (input.acknowledgedAt !== null) {
    const acknowledgedMs = Date.parse(input.acknowledgedAt);
    const detectedMs = Date.parse(input.detectedAt);
    if (Number.isNaN(acknowledgedMs) || Number.isNaN(detectedMs)) {
      return { slaBreached: false, minutesToAcknowledge: null };
    }
    const minutesToAcknowledge = Math.max(0, Math.round((acknowledgedMs - detectedMs) / 60_000));
    return { slaBreached: minutesToAcknowledge > slaAckMinutes, minutesToAcknowledge };
  }

  // Never acknowledged. While it is still open the clock is running; once it is closed
  // without an acknowledgement (a straight dismissal, say) there is nothing left to breach.
  if (isOpenStatus(input.status)) {
    return { slaBreached: ageMinutes > slaAckMinutes, minutesToAcknowledge: null };
  }
  return { slaBreached: false, minutesToAcknowledge: null };
}

interface ReasonInput {
  input: TriageInput;
  category: ReturnType<typeof alertTypeCategory>;
  severityWeight: number;
  siteFactor: number;
  ageMinutes: number;
  ageUplift: number;
  slaBreached: boolean;
  slaAckMinutes: number;
  minutesToAcknowledge: number | null;
  closed: boolean;
}

/**
 * Explains the score in the operator's own vocabulary. A ranking nobody can interrogate is a
 * ranking nobody trusts, so every factor that moved the number says so out loud.
 */
function buildReasons(context: ReasonInput): string[] {
  const { input, category, siteFactor, ageMinutes, ageUplift, slaBreached, closed } = context;
  const reasons: string[] = [];

  reasons.push(`${SEVERITY_LABEL[input.severity]} severity`);

  if (category === 'safety') {
    reasons.push(`Safety-related type (${ALERT_TYPE_META[input.type].label})`);
  } else if (category === 'informational') {
    reasons.push('Informational only — deprioritised');
  } else if (category === 'data_quality') {
    reasons.push('Data-quality issue — deprioritised');
  }

  if (siteFactor >= 1.2) {
    reasons.push(`High-capacity site (${input.siteCapacityMw} MW)`);
  }

  if (closed) {
    reasons.push(
      input.status === 'resolved'
        ? 'Resolved — no further action required'
        : 'Dismissed — no further action required',
    );
    return reasons;
  }

  // Below ~5% the uplift is not what put this alert where it is, and saying "+1% urgency"
  // adds a number to the explanation without adding any information.
  if (ageUplift >= 0.05) {
    reasons.push(
      `Open ${formatDuration(ageMinutes)} without resolution (+${Math.round(ageUplift * 100)}% urgency)`,
    );
  }

  if (input.status === 'in_progress') {
    reasons.push('Someone is working it — urgency damped');
  } else if (input.status === 'acknowledged') {
    reasons.push('Acknowledged but not yet started');
  }

  if (slaBreached) {
    const target = formatDuration(context.slaAckMinutes);
    reasons.push(
      context.minutesToAcknowledge === null
        ? `Acknowledgement SLA breached (target ${target})`
        : `Acknowledged late — ${formatDuration(context.minutesToAcknowledge)} against a ${target} target`,
    );
  }

  return reasons;
}
