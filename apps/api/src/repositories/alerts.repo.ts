import { z } from 'zod';
import {
  AlertTypeSchema,
  IsoDateTimeSchema,
  MetricsSchema,
  SeveritySchema,
  StatusSchema,
  type Alert,
  type AlertStatus,
} from '@incident-board/shared';
import type { Db } from '../db/client.js';
import { hydrateRow, hydrateRows, jsonColumn, SqliteBooleanSchema } from '../db/hydrate.js';

/**
 * Alert persistence.
 *
 * Reads deliberately load the whole board in one query rather than pushing filters into SQL.
 * Priority, "needs attention" and SLA state are all functions of the current time, so they
 * cannot be indexed or filtered in SQL without first materialising a score — and a score
 * materialised at write time is stale by definition. Loading the set and deriving in one pure
 * pass keeps the ranking honest and the filtering logic unit-testable.
 *
 * The trade-off is explicit: this is O(alerts) per request. It is the right shape for a
 * portfolio-sized board (hundreds to low thousands of open alerts) and the wrong shape at
 * 100k+, where the answer is a materialised `triage_score` column refreshed by a background
 * job and filtered in SQL. See README → Trade-offs.
 */

/**
 * The raw column shape, kept untransformed so it can be extended with the board's aggregate
 * columns before a single transform maps everything into the domain object at once.
 */
const AlertRowShape = z.object({
  id: z.string(),
  site_id: z.string(),
  asset_id: z.string().nullable(),
  type: AlertTypeSchema,
  severity: SeveritySchema,
  status: StatusSchema,
  title: z.string(),
  description: z.string(),
  metrics: jsonColumn(MetricsSchema),
  detected_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
  acknowledged_at: IsoDateTimeSchema.nullable(),
  resolved_at: IsoDateTimeSchema.nullable(),
  assignee: z.string().nullable(),
  source: z.string(),
  version: z.number().int().nonnegative(),
});

function toAlert(row: z.output<typeof AlertRowShape>): Alert {
  return {
    id: row.id,
    siteId: row.site_id,
    assetId: row.asset_id,
    type: row.type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    metrics: row.metrics,
    detectedAt: row.detected_at,
    updatedAt: row.updated_at,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    assignee: row.assignee,
    source: row.source,
    version: row.version,
  };
}

/** An alert plus the two aggregates the board needs, fetched in the same pass. */
export interface BoardAlert {
  alert: Alert;
  noteCount: number;
  hasInsight: boolean;
}

const BoardRowSchema = AlertRowShape.extend({
  note_count: z.number().int().nonnegative(),
  has_insight: SqliteBooleanSchema,
}).transform(
  (row): BoardAlert => ({
    alert: toAlert(row),
    noteCount: row.note_count,
    hasInsight: row.has_insight,
  }),
);

const ALERT_COLUMNS = `
  a.id, a.site_id, a.asset_id, a.type, a.severity, a.status, a.title, a.description,
  a.metrics, a.detected_at, a.updated_at, a.acknowledged_at, a.resolved_at,
  a.assignee, a.source, a.version
`;

export interface AlertUpdate {
  status?: AlertStatus;
  assignee?: string | null;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
}

export type AlertsRepository = ReturnType<typeof createAlertsRepository>;

export function createAlertsRepository(db: Db) {
  const boardStmt = db.prepare(`
    SELECT ${ALERT_COLUMNS},
      (SELECT COUNT(*) FROM alert_notes n WHERE n.alert_id = a.id)          AS note_count,
      (SELECT EXISTS(SELECT 1 FROM ai_insights i WHERE i.alert_id = a.id))  AS has_insight
    FROM alerts a
    ORDER BY a.detected_at DESC, a.id ASC
  `);

  const byIdStmt = db.prepare(`
    SELECT ${ALERT_COLUMNS},
      (SELECT COUNT(*) FROM alert_notes n WHERE n.alert_id = a.id)          AS note_count,
      (SELECT EXISTS(SELECT 1 FROM ai_insights i WHERE i.alert_id = a.id))  AS has_insight
    FROM alerts a
    WHERE a.id = ?
  `);

  const versionStmt = db.prepare('SELECT version FROM alerts WHERE id = ?');

  const insertStmt = db.prepare(`
    INSERT INTO alerts (
      id, site_id, asset_id, type, severity, status, title, description, metrics,
      detected_at, updated_at, acknowledged_at, resolved_at, assignee, source, version
    ) VALUES (
      @id, @site_id, @asset_id, @type, @severity, @status, @title, @description, @metrics,
      @detected_at, @updated_at, @acknowledged_at, @resolved_at, @assignee, @source, @version
    )
  `);

  return {
    /** Every alert on the board, newest first. Ordering here is only a stable default. */
    findForBoard(): BoardAlert[] {
      return hydrateRows('alerts', BoardRowSchema, boardStmt.all());
    },

    findById(id: string): BoardAlert | null {
      const row = byIdStmt.get(id);
      if (row === undefined) return null;
      return hydrateRow('alerts', BoardRowSchema, row);
    },

    /** Current version, or null when the alert does not exist. */
    currentVersion(id: string): number | null {
      const row = versionStmt.get(id);
      if (row === undefined) return null;
      return z.object({ version: z.number().int() }).parse(row).version;
    },

    /**
     * Applies a patch guarded by `expectedVersion`, returning false when the guard did not
     * match. The version check lives in the `WHERE` clause so the read-compare-write is atomic
     * at the database rather than in application code, where two requests could interleave.
     */
    applyUpdate(
      id: string,
      update: AlertUpdate,
      expectedVersion: number,
      updatedAt: string,
    ): boolean {
      const assignments: string[] = [];
      const params: Record<string, unknown> = { id, expected_version: expectedVersion, updated_at: updatedAt };

      if (update.status !== undefined) {
        assignments.push('status = @status');
        params['status'] = update.status;
      }
      if (update.assignee !== undefined) {
        assignments.push('assignee = @assignee');
        params['assignee'] = update.assignee;
      }
      if (update.acknowledgedAt !== undefined) {
        assignments.push('acknowledged_at = @acknowledged_at');
        params['acknowledged_at'] = update.acknowledgedAt;
      }
      if (update.resolvedAt !== undefined) {
        assignments.push('resolved_at = @resolved_at');
        params['resolved_at'] = update.resolvedAt;
      }

      assignments.push('updated_at = @updated_at', 'version = version + 1');

      const result = db
        .prepare(
          `UPDATE alerts SET ${assignments.join(', ')}
           WHERE id = @id AND version = @expected_version`,
        )
        .run(params);

      return result.changes === 1;
    },

    /**
     * Records activity without consuming the concurrency token. Adding a note is additive and
     * cannot conflict with another operator's note, so bumping `version` here would only cause
     * spurious 409s on an unrelated status change the operator had already staged.
     */
    touch(id: string, updatedAt: string): void {
      db.prepare('UPDATE alerts SET updated_at = ? WHERE id = ?').run(updatedAt, id);
    },

    insert(alert: Alert): void {
      insertStmt.run({
        id: alert.id,
        site_id: alert.siteId,
        asset_id: alert.assetId,
        type: alert.type,
        severity: alert.severity,
        status: alert.status,
        title: alert.title,
        description: alert.description,
        metrics: JSON.stringify(alert.metrics),
        detected_at: alert.detectedAt,
        updated_at: alert.updatedAt,
        acknowledged_at: alert.acknowledgedAt,
        resolved_at: alert.resolvedAt,
        assignee: alert.assignee,
        source: alert.source,
        version: alert.version,
      });
    },

    count(): number {
      const row = db.prepare('SELECT COUNT(*) AS count FROM alerts').get();
      return z.object({ count: z.number().int() }).parse(row).count;
    },
  };
}
