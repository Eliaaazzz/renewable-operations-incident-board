import { z } from 'zod';
import {
  ActionOwnerSchema,
  ActionUrgencySchema,
  ConfidenceSchema,
  PrioritySchema,
} from './enums.js';
import { IdSchema, IsoDateTimeSchema } from './domain.js';

/**
 * Contract for the AI-assisted feature.
 *
 * Two schemas describe the model's answer on purpose:
 *
 *  - `ModelInsightSchema` is what we accept *from* the language model. Its bounds are
 *    generous, because rejecting an otherwise good answer for being 30 characters too long
 *    would trade a useful result for a useless one.
 *  - `InsightPayloadSchema` is what we store and serve. `normaliseInsight` truncates the
 *    lenient shape into the strict one, so the display contract is guaranteed regardless of
 *    how verbose the model was.
 */

export const NextActionSchema = z.object({
  action: z.string().min(1).max(200),
  owner: ActionOwnerSchema,
  urgency: ActionUrgencySchema,
});
export type NextAction = z.infer<typeof NextActionSchema>;

export const SUMMARY_MAX = 600;
export const CAUSE_MAX = 200;
export const RATIONALE_MAX = 300;

export const InsightPayloadSchema = z.object({
  summary: z.string().min(1).max(SUMMARY_MAX),
  likelyCauses: z.array(z.string().min(1).max(CAUSE_MAX)).min(1).max(3),
  suggestedPriority: PrioritySchema,
  priorityRationale: z.string().min(1).max(RATIONALE_MAX),
  nextActions: z.array(NextActionSchema).min(1).max(4),
  /** True when the alert plausibly involves a risk to people or equipment. */
  safetyFlag: z.boolean(),
  confidence: ConfidenceSchema,
});
export type InsightPayload = z.infer<typeof InsightPayloadSchema>;

/** Lenient counterpart used only to parse raw model output before normalisation. */
export const ModelInsightSchema = z.object({
  summary: z.string().min(1).max(4000),
  likelyCauses: z.array(z.string().min(1).max(1000)).min(1).max(8),
  suggestedPriority: PrioritySchema,
  priorityRationale: z.string().min(1).max(2000),
  nextActions: z.array(NextActionSchema.extend({ action: z.string().min(1).max(1000) }))
    .min(1)
    .max(8),
  safetyFlag: z.boolean(),
  confidence: ConfidenceSchema,
});
export type ModelInsight = z.infer<typeof ModelInsightSchema>;

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  // Cut on a word boundary where possible so the truncation does not read as corruption.
  const slice = trimmed.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}

/** Narrow a model answer to the strict display contract. Never throws for valid input. */
export function normaliseInsight(raw: ModelInsight): InsightPayload {
  return {
    summary: clamp(raw.summary, SUMMARY_MAX),
    likelyCauses: raw.likelyCauses.slice(0, 3).map((c) => clamp(c, CAUSE_MAX)),
    suggestedPriority: raw.suggestedPriority,
    priorityRationale: clamp(raw.priorityRationale, RATIONALE_MAX),
    nextActions: raw.nextActions.slice(0, 4).map((a) => ({
      action: clamp(a.action, 200),
      owner: a.owner,
      urgency: a.urgency,
    })),
    safetyFlag: raw.safetyFlag,
    confidence: raw.confidence,
  };
}

/* ----------------------------------------------------------------- guardrails */

export const INSIGHT_WARNING_CODES = [
  /** The model cited a number that does not appear anywhere in the alert record. */
  'ungrounded_number',
  /** The model referred to a site that is not this alert's site. */
  'foreign_site_reference',
  /** Model priority differs from the deterministic rules by two bands or more. */
  'priority_disagreement',
  /** First response failed schema validation; a repair round-trip was needed. */
  'schema_repair',
  /** Alert text contains instruction-like content; treated strictly as data. */
  'injection_suspected',
  /** The model was unreachable, timed out, or never returned usable JSON. */
  'provider_unavailable',
  /** Output was long enough that it had to be truncated for display. */
  'output_truncated',
] as const;
export const InsightWarningCodeSchema = z.enum(INSIGHT_WARNING_CODES);
export type InsightWarningCode = z.infer<typeof InsightWarningCodeSchema>;

export const InsightWarningSchema = z.object({
  code: InsightWarningCodeSchema,
  message: z.string().min(1).max(400),
  severity: z.enum(['info', 'warning']),
});
export type InsightWarning = z.infer<typeof InsightWarningSchema>;

export const INSIGHT_PROVIDERS = ['ollama', 'rule-based'] as const;
export const InsightProviderNameSchema = z.enum(INSIGHT_PROVIDERS);
export type InsightProviderName = z.infer<typeof InsightProviderNameSchema>;

export const DISAGREEMENT_LEVELS = ['none', 'minor', 'major'] as const;
export const DisagreementLevelSchema = z.enum(DISAGREEMENT_LEVELS);
export type DisagreementLevel = z.infer<typeof DisagreementLevelSchema>;

/**
 * What the API returns for an insight: the model's answer *plus* the provenance and
 * cross-checks needed to decide how much to trust it. The deterministic baseline travels
 * alongside the model answer rather than being hidden, so the UI can show both when they
 * disagree instead of silently picking a winner.
 */
export const InsightSchema = z.object({
  id: z.number().int().positive(),
  alertId: IdSchema,
  provider: InsightProviderNameSchema,
  model: z.string().min(1).max(120),
  payload: InsightPayloadSchema,
  /** True when the answer came from the deterministic fallback rather than the model. */
  degraded: z.boolean(),
  degradedReason: z.string().max(400).nullable(),
  warnings: z.array(InsightWarningSchema),
  ruleBaseline: z.object({
    priority: PrioritySchema,
    score: z.number().nonnegative(),
    reasons: z.array(z.string()),
  }),
  disagreement: z.object({
    bands: z.number().int().nonnegative(),
    level: DisagreementLevelSchema,
  }),
  latencyMs: z.number().int().nonnegative(),
  generatedAt: IsoDateTimeSchema,
  /** Hash of the exact prompt sent, so a given answer can be reproduced and audited. */
  promptHash: z.string().length(16),
  /** Hash of the alert content the answer describes; changes invalidate the cache. */
  contentHash: z.string().length(16),
  /** Operator verdict, once given. Persisted to build an evaluation set over time. */
  feedback: z
    .object({
      helpful: z.boolean(),
      comment: z.string().max(1000).nullable(),
      createdAt: IsoDateTimeSchema,
    })
    .nullable(),
});
export type Insight = z.infer<typeof InsightSchema>;
