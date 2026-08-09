import { z } from 'zod';
import { IsoDateTimeSchema, type AlertNote } from '@incident-board/shared';
import type { Db } from '../db/client.js';
import { hydrateRow, hydrateRows } from '../db/hydrate.js';

const NoteRowSchema = z
  .object({
    id: z.number().int().positive(),
    alert_id: z.string(),
    author: z.string(),
    body: z.string(),
    created_at: IsoDateTimeSchema,
  })
  .transform(
    (row): AlertNote => ({
      id: row.id,
      alertId: row.alert_id,
      author: row.author,
      body: row.body,
      createdAt: row.created_at,
    }),
  );

const COLUMNS = 'id, alert_id, author, body, created_at';

export interface NewNote {
  alertId: string;
  author: string;
  body: string;
  createdAt: string;
}

export type NotesRepository = ReturnType<typeof createNotesRepository>;

export function createNotesRepository(db: Db) {
  const listStmt = db.prepare(
    `SELECT ${COLUMNS} FROM alert_notes WHERE alert_id = ? ORDER BY created_at ASC, id ASC`,
  );
  const insertStmt = db.prepare(`
    INSERT INTO alert_notes (alert_id, author, body, created_at)
    VALUES (@alert_id, @author, @body, @created_at)
  `);
  const byIdStmt = db.prepare(`SELECT ${COLUMNS} FROM alert_notes WHERE id = ?`);

  return {
    listByAlert(alertId: string): AlertNote[] {
      return hydrateRows('alert_notes', NoteRowSchema, listStmt.all(alertId));
    },

    create(note: NewNote): AlertNote {
      const result = insertStmt.run({
        alert_id: note.alertId,
        author: note.author,
        body: note.body,
        created_at: note.createdAt,
      });
      // Reading the row back rather than reconstructing it means the returned object reflects
      // exactly what was stored, including anything the schema defaulted or a trigger changed.
      return hydrateRow('alert_notes', NoteRowSchema, byIdStmt.get(result.lastInsertRowid));
    },
  };
}
