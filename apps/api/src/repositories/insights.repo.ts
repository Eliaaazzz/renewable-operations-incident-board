import { z } from 'zod';
import {
  DisagreementLevelSchema,
  InsightPayloadSchema,
  InsightProviderNameSchema,
  InsightWarningSchema,
  IsoDateTimeSchema,
  PrioritySchema,
  type Insight,
} from '@incident-board/shared';
import type { Db } from '../db/client.js';
import { hydrateRow, jsonColumn, SqliteBooleanSchema, toSqliteBoolean } from '../db/hydrate.js';

/**
 * Generated insights, cached with the provenance needed to audit them later: which model, which
 * prompt, against which version of the alert's content.
 */

const RuleBaselineSchema = z.object({
  priority: PrioritySchema,
  score: z.number().nonnegative(),
  reasons: z.array(z.string()),
});

const DisagreementSchema = z.object({
  bands: z.number().int().nonnegative(),
  level: DisagreementLevelSchema,
});

const InsightRowSchema = z
  .object({
    id: z.number().int().positive(),
    alert_id: z.string(),
    provider: InsightProviderNameSchema,
    model: z.string(),
    payload: jsonColumn(InsightPayloadSchema),
    degraded: SqliteBooleanSchema,
    degraded_reason: z.string().nullable(),
    warnings: jsonColumn(z.array(InsightWarningSchema)),
    rule_baseline: jsonColumn(RuleBaselineSchema),
    disagreement: jsonColumn(DisagreementSchema),
    latency_ms: z.number().int().nonnegative(),
    generated_at: IsoDateTimeSchema,
    prompt_hash: z.string(),
    content_hash: z.string(),
    feedback_helpful: SqliteBooleanSchema.nullable(),
    feedback_comment: z.string().nullable(),
    feedback_created_at: IsoDateTimeSchema.nullable(),
  })
  .transform(
    (row): Insight => ({
      id: row.id,
      alertId: row.alert_id,
      provider: row.provider,
      model: row.model,
      payload: row.payload,
      degraded: row.degraded,
      degradedReason: row.degraded_reason,
      warnings: row.warnings,
      ruleBaseline: row.rule_baseline,
      disagreement: row.disagreement,
      latencyMs: row.latency_ms,
      generatedAt: row.generated_at,
      promptHash: row.prompt_hash,
      contentHash: row.content_hash,
      feedback:
        row.feedback_helpful === null || row.feedback_created_at === null
          ? null
          : {
              helpful: row.feedback_helpful,
              comment: row.feedback_comment,
              createdAt: row.feedback_created_at,
            },
    }),
  );

const SELECT_WITH_FEEDBACK = `
  SELECT i.id, i.alert_id, i.provider, i.model, i.payload, i.degraded, i.degraded_reason,
         i.warnings, i.rule_baseline, i.disagreement, i.latency_ms, i.generated_at,
         i.prompt_hash, i.content_hash,
         f.helpful    AS feedback_helpful,
         f.comment    AS feedback_comment,
         f.created_at AS feedback_created_at
  FROM ai_insights i
  LEFT JOIN insight_feedback f ON f.insight_id = i.id
`;

export interface NewInsight {
  alertId: string;
  provider: Insight['provider'];
  model: string;
  payload: Insight['payload'];
  degraded: boolean;
  degradedReason: string | null;
  warnings: Insight['warnings'];
  ruleBaseline: Insight['ruleBaseline'];
  disagreement: Insight['disagreement'];
  latencyMs: number;
  generatedAt: string;
  promptHash: string;
  contentHash: string;
}

export type InsightsRepository = ReturnType<typeof createInsightsRepository>;

export function createInsightsRepository(db: Db) {
  const latestStmt = db.prepare(`
    ${SELECT_WITH_FEEDBACK}
    WHERE i.alert_id = ?
    ORDER BY i.generated_at DESC, i.id DESC
    LIMIT 1
  `);

  const freshStmt = db.prepare(`
    ${SELECT_WITH_FEEDBACK}
    WHERE i.alert_id = ? AND i.prompt_hash = ? AND i.degraded = 0
    ORDER BY i.generated_at DESC, i.id DESC
    LIMIT 1
  `);

  const byIdStmt = db.prepare(`${SELECT_WITH_FEEDBACK} WHERE i.id = ?`);

  const insertStmt = db.prepare(`
    INSERT INTO ai_insights (
      alert_id, provider, model, payload, degraded, degraded_reason, warnings,
      rule_baseline, disagreement, latency_ms, generated_at, prompt_hash, content_hash
    ) VALUES (
      @alert_id, @provider, @model, @payload, @degraded, @degraded_reason, @warnings,
      @rule_baseline, @disagreement, @latency_ms, @generated_at, @prompt_hash, @content_hash
    )
  `);

  const feedbackStmt = db.prepare(`
    INSERT INTO insight_feedback (insight_id, helpful, comment, created_at)
    VALUES (@insight_id, @helpful, @comment, @created_at)
    ON CONFLICT(insight_id) DO UPDATE SET
      helpful    = excluded.helpful,
      comment    = excluded.comment,
      created_at = excluded.created_at
  `);

  return {
    /** Most recent insight for an alert, whatever its state — this is what the UI displays. */
    latestForAlert(alertId: string): Insight | null {
      const row = latestStmt.get(alertId);
      return row === undefined ? null : hydrateRow('ai_insights', InsightRowSchema, row);
    },

    /**
     * A cached answer that is still valid for reuse.
     *
     * `prompt_hash` covers both the alert's content and the prompt template, so an edited alert
     * or a changed template both miss the cache. Degraded answers are deliberately excluded:
     * they were produced because the model was unavailable, and serving one from cache after
     * the model comes back would pin the alert to the fallback forever.
     */
    findReusable(alertId: string, promptHash: string): Insight | null {
      const row = freshStmt.get(alertId, promptHash);
      return row === undefined ? null : hydrateRow('ai_insights', InsightRowSchema, row);
    },

    findById(id: number): Insight | null {
      const row = byIdStmt.get(id);
      return row === undefined ? null : hydrateRow('ai_insights', InsightRowSchema, row);
    },

    insert(insight: NewInsight): Insight {
      const result = insertStmt.run({
        alert_id: insight.alertId,
        provider: insight.provider,
        model: insight.model,
        payload: JSON.stringify(insight.payload),
        degraded: toSqliteBoolean(insight.degraded),
        degraded_reason: insight.degradedReason,
        warnings: JSON.stringify(insight.warnings),
        rule_baseline: JSON.stringify(insight.ruleBaseline),
        disagreement: JSON.stringify(insight.disagreement),
        latency_ms: insight.latencyMs,
        generated_at: insight.generatedAt,
        prompt_hash: insight.promptHash,
        content_hash: insight.contentHash,
      });
      return hydrateRow('ai_insights', InsightRowSchema, byIdStmt.get(result.lastInsertRowid));
    },

    saveFeedback(
      insightId: number,
      helpful: boolean,
      comment: string | null,
      createdAt: string,
    ): void {
      feedbackStmt.run({
        insight_id: insightId,
        helpful: toSqliteBoolean(helpful),
        comment,
        created_at: createdAt,
      });
    },
  };
}
