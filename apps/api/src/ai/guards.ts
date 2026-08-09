import {
  priorityDistance,
  SUMMARY_MAX,
  type Confidence,
  type DisagreementLevel,
  type InsightPayload,
  type InsightWarning,
  type ModelInsight,
  type Priority,
} from '@incident-board/shared';
import { buildPromptPayload } from './prompt.js';
import type { AlertContext } from './types.js';

/**
 * Guardrails.
 *
 * A 3B model running locally will sometimes produce something fluent, well-formed and wrong.
 * Schema validation catches malformed answers; it cannot catch a confident sentence citing a
 * temperature that was never measured. These checks exist for that second category.
 *
 * They are graded rather than binary. Most problems attach a visible warning and force
 * confidence down, because a flagged answer an operator can still read beats no answer at all.
 * Only a reference to a *different site* is fatal — that means the model has lost track of
 * which asset it is discussing, and nothing else it says can be trusted either.
 */

export const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|above|the)\s+\w*\s*instructions/i,
  /you\s+are\s+now\s+(?:a|an|the)\b/i,
  /system\s+(?:prompt|message)\s*[:=]/i,
  /reply\s+only\s+with/i,
  /respond\s+only\s+with/i,
  /new\s+instructions\s*[:=]/i,
  /\byour\s+(?:real|true|actual)\s+task\b/i,
];

/**
 * Numbers small enough to be ordinary English rather than a claimed measurement — counts,
 * hours, percentages. Without this, "check again within 24 hours" reads as a fabricated
 * figure. The trade is deliberate: an invented small integer can slip through, while an
 * invented measurement (61.8, 1850) still cannot.
 */
const COMMON_NUMBERS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 24, 30, 48, 60, 72, 100]);

const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/g;

export function extractNumbers(text: string): number[] {
  const found = text.match(NUMBER_PATTERN);
  if (found === null) return [];
  return found.map(Number).filter((value) => Number.isFinite(value));
}

/** True when the alert's own text contains something shaped like an instruction to a model. */
export function detectInjection(context: AlertContext): boolean {
  const surfaces = [
    context.alert.title,
    context.alert.description,
    ...context.recentNotes.map((note) => note.body),
  ];
  return surfaces.some((surface) => INJECTION_PATTERNS.some((pattern) => pattern.test(surface)));
}

function modelText(payload: InsightPayload): string {
  return [
    payload.summary,
    payload.priorityRationale,
    ...payload.likelyCauses,
    ...payload.nextActions.map((action) => action.action),
  ].join(' \n ');
}

function isGrounded(value: number, sourceText: string, sourceNumbers: readonly number[]): boolean {
  if (COMMON_NUMBERS.has(value)) return true;
  // Digit strings that appear verbatim cover identifiers such as `R04`, `E-2214` or `CB-11`,
  // where the number is part of a name rather than a measurement.
  if (sourceText.includes(String(value))) return true;

  return sourceNumbers.some((source) => {
    if (source === value) return true;
    if (Math.round(source) === value || Math.round(value) === Math.round(source)) return true;
    return Math.abs(value - source) <= Math.abs(source) * 0.01;
  });
}

/**
 * Every number the model states must be traceable to something it was given. The source is the
 * prompt payload itself, so "grounded" means precisely "derivable from what the model saw"
 * rather than the looser "exists somewhere in the database".
 */
export function checkGroundedness(payload: InsightPayload, context: AlertContext): InsightWarning[] {
  const sourceText = JSON.stringify(buildPromptPayload(context));
  const sourceNumbers = extractNumbers(sourceText);

  // Priority labels are the model's own vocabulary, not claims about the plant.
  const claimText = modelText(payload).replace(/\bP[1-4]\b/g, ' ');
  const ungrounded = [...new Set(extractNumbers(claimText))].filter(
    (value) => !isGrounded(value, sourceText, sourceNumbers),
  );

  if (ungrounded.length === 0) return [];

  return [
    {
      code: 'ungrounded_number',
      severity: 'warning',
      message: `Cites ${ungrounded.length === 1 ? 'a figure' : 'figures'} not present in the alert record: ${ungrounded
        .slice(0, 5)
        .join(', ')}. Verify against the source data before acting.`,
    },
  ];
}

/**
 * Catches the model discussing a different asset. Fatal rather than advisory: if it has
 * confused two sites, its causes and its actions belong to the wrong plant.
 */
export function checkSiteReferences(
  payload: InsightPayload,
  context: AlertContext,
  portfolioSiteNames: readonly string[],
): { warnings: InsightWarning[]; fatal: string | null } {
  const text = modelText(payload).toLowerCase();
  const foreign = portfolioSiteNames.filter(
    (name) => name !== context.site.name && text.includes(name.toLowerCase()),
  );

  if (foreign.length === 0) return { warnings: [], fatal: null };

  return {
    warnings: [
      {
        code: 'foreign_site_reference',
        severity: 'warning',
        message: `Referred to ${foreign.join(', ')}, which is not the site this alert belongs to.`,
      },
    ],
    fatal: `model referenced an unrelated site (${foreign.join(', ')})`,
  };
}

export function assessDisagreement(
  modelPriority: Priority,
  rulePriority: Priority,
): { bands: number; level: DisagreementLevel } {
  const bands = priorityDistance(modelPriority, rulePriority);
  const level: DisagreementLevel = bands === 0 ? 'none' : bands === 1 ? 'minor' : 'major';
  return { bands, level };
}

/** Detects that `normaliseInsight` had to cut the answer down to the display contract. */
export function checkTruncation(raw: ModelInsight): InsightWarning[] {
  const trimmed =
    raw.summary.trim().length > SUMMARY_MAX ||
    raw.likelyCauses.length > 3 ||
    raw.nextActions.length > 4;

  return trimmed
    ? [
        {
          code: 'output_truncated',
          severity: 'info',
          message: 'The model returned more than the display allows; the answer was shortened.',
        },
      ]
    : [];
}

export interface GuardOutcome {
  warnings: InsightWarning[];
  /** Non-null means the answer must be discarded in favour of the deterministic engine. */
  fatal: string | null;
  confidence: Confidence;
  disagreement: { bands: number; level: DisagreementLevel };
}

export function runGuards(args: {
  payload: InsightPayload;
  raw: ModelInsight;
  context: AlertContext;
  portfolioSiteNames: readonly string[];
  rulePriority: Priority;
  injectionDetected: boolean;
  repaired: boolean;
}): GuardOutcome {
  const warnings: InsightWarning[] = [];

  if (args.repaired) {
    warnings.push({
      code: 'schema_repair',
      severity: 'info',
      message: 'The first response did not match the required shape and had to be corrected.',
    });
  }

  if (args.injectionDetected) {
    warnings.push({
      code: 'injection_suspected',
      severity: 'warning',
      message:
        'This alert contains text shaped like an instruction to an AI system. It was passed to the model strictly as data — treat the alert itself with suspicion.',
    });
  }

  warnings.push(...checkTruncation(args.raw));
  warnings.push(...checkGroundedness(args.payload, args.context));

  const siteCheck = checkSiteReferences(args.payload, args.context, args.portfolioSiteNames);
  warnings.push(...siteCheck.warnings);

  const disagreement = assessDisagreement(args.payload.suggestedPriority, args.rulePriority);
  if (disagreement.level === 'major') {
    warnings.push({
      code: 'priority_disagreement',
      severity: 'warning',
      message: `The model suggests ${args.payload.suggestedPriority} where the scoring rules give ${args.rulePriority}. Both are shown — decide for yourself.`,
    });
  }

  // Any substantive warning caps the reported confidence. A model that has just cited an
  // invented figure has not earned the right to call itself "high confidence".
  const hasWarning = warnings.some((warning) => warning.severity === 'warning');
  const confidence: Confidence = hasWarning
    ? 'low'
    : args.payload.confidence === 'high' && disagreement.level === 'minor'
      ? 'medium'
      : args.payload.confidence;

  return { warnings, fatal: siteCheck.fatal, confidence, disagreement };
}
