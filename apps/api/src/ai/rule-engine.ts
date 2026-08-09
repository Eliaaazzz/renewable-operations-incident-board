import {
  ALERT_TYPE_META,
  CAUSE_MAX,
  RATIONALE_MAX,
  SEVERITY_LABEL,
  SUMMARY_MAX,
  alertTypeCategory,
  clampText,
  type AlertStatus,
  type InsightPayload,
} from '@incident-board/shared';

/** Status read as a clause, so the summary is a sentence rather than a field dump. */
const STATUS_PHRASE: Record<AlertStatus, string> = {
  new: 'not yet acknowledged',
  acknowledged: 'acknowledged but not yet started',
  in_progress: 'currently being worked',
  resolved: 'since resolved',
  dismissed: 'since dismissed as a false positive',
};
import { formatMetricsSentence } from '../domain/metrics-format.js';
import { playbookFor } from '../domain/playbooks.js';
import type { AlertContext } from './types.js';

/**
 * The deterministic engine.
 *
 * It serves three jobs, and it is worth being precise about which:
 *
 *  1. **Fallback.** When the model is unreachable, slow, or returns something unusable, the
 *     operator still gets a useful answer instead of an error. The feature degrades; it does
 *     not disappear.
 *  2. **Baseline.** Its priority is compared against the model's on every generation. That
 *     comparison is only meaningful because this engine never sees the model's output and the
 *     model never sees these playbooks.
 *  3. **Test substrate.** It is pure and total, so the API's behaviour can be asserted without
 *     a 2 GB model in CI.
 *
 * What it is not is a *replacement* for the model. It cannot read the description, weigh an
 * unusual combination of facts, or notice that an operator note contradicts the alert. It
 * recites a playbook, accurately.
 */
export function ruleBasedInsight(context: AlertContext): InsightPayload {
  const { alert, site, triage } = context;
  const playbook = playbookFor(alert.type);
  const typeLabel = ALERT_TYPE_META[alert.type].label.toLowerCase();

  const location = alert.assetId === null ? site.name : `${site.name} (${alert.assetId})`;
  const measurements = formatMetricsSentence(alert.metrics, 3);

  const sentences = [
    `${SEVERITY_LABEL[alert.severity]}-severity ${typeLabel} at ${location}, raised ${formatAge(triage.ageMinutes)} ago and ${STATUS_PHRASE[alert.status]}.`,
    measurements.length > 0 ? `Reported ${measurements}.` : '',
    triage.reasons.length > 0 ? `Ranked ${triage.priority} because: ${triage.reasons.join('; ')}.` : '',
    context.recentNotes.length > 0
      ? `${context.recentNotes.length} follow-up ${context.recentNotes.length === 1 ? 'note' : 'notes'} recorded — read the timeline before acting.`
      : '',
  ].filter((sentence) => sentence.length > 0);

  return {
    summary: clampText(sentences.join(' '), SUMMARY_MAX),
    likelyCauses: playbook.likelyCauses.slice(0, 3).map((cause) => clampText(cause, CAUSE_MAX)),
    suggestedPriority: triage.priority,
    priorityRationale: clampText(
      `Scored ${triage.score} from severity, alert category and site capacity${triage.slaBreached ? ', with the acknowledgement SLA already breached' : ''}.`,
      RATIONALE_MAX,
    ),
    nextActions: playbook.actions.slice(0, 4).map((action) => ({ ...action })),
    safetyFlag: alertTypeCategory(alert.type) === 'safety',
    // Never "high": this is an accurate recitation of a playbook, not an assessment of this
    // particular situation, and the confidence badge should not imply otherwise.
    confidence: 'medium',
  };
}

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${Math.round(hours / 24)} days`;
}
