import { z } from 'zod';
import {
  EventKindSchema,
  IsoDateTimeSchema,
  StatusSchema,
  type AlertEvent,
  type AlertStatus,
  type EventKind,
} from '@incident-board/shared';
import type { Db } from '../db/client.js';
import { hydrateRows } from '../db/hydrate.js';

/**
 * The audit trail. Append-only by convention — nothing in the application updates or deletes
 * an event — which is what makes "who changed this, and when" answerable after the fact rather
 * than merely plausible.
 */

const EventRowSchema = z
  .object({
    id: z.number().int().positive(),
    alert_id: z.string(),
    kind: EventKindSchema,
    from_status: StatusSchema.nullable(),
    to_status: StatusSchema.nullable(),
    actor: z.string(),
    detail: z.string().nullable(),
    created_at: IsoDateTimeSchema,
  })
  .transform(
    (row): AlertEvent => ({
      id: row.id,
      alertId: row.alert_id,
      kind: row.kind,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      actor: row.actor,
      detail: row.detail,
      createdAt: row.created_at,
    }),
  );

const COLUMNS = 'id, alert_id, kind, from_status, to_status, actor, detail, created_at';

export interface NewEvent {
  alertId: string;
  kind: EventKind;
  fromStatus?: AlertStatus | null;
  toStatus?: AlertStatus | null;
  actor: string;
  detail?: string | null;
  createdAt: string;
}

export type EventsRepository = ReturnType<typeof createEventsRepository>;

export function createEventsRepository(db: Db) {
  const listStmt = db.prepare(
    `SELECT ${COLUMNS} FROM alert_events WHERE alert_id = ? ORDER BY created_at ASC, id ASC`,
  );
  const insertStmt = db.prepare(`
    INSERT INTO alert_events (alert_id, kind, from_status, to_status, actor, detail, created_at)
    VALUES (@alert_id, @kind, @from_status, @to_status, @actor, @detail, @created_at)
  `);

  return {
    listByAlert(alertId: string): AlertEvent[] {
      return hydrateRows('alert_events', EventRowSchema, listStmt.all(alertId));
    },

    append(event: NewEvent): void {
      insertStmt.run({
        alert_id: event.alertId,
        kind: event.kind,
        from_status: event.fromStatus ?? null,
        to_status: event.toStatus ?? null,
        actor: event.actor,
        detail: event.detail ?? null,
        created_at: event.createdAt,
      });
    },
  };
}
