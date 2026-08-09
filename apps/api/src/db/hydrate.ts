import { z } from 'zod';
import { DataIntegrityError } from '../errors.js';

/**
 * The database → domain boundary.
 *
 * SQLite is untyped enough that a column can quietly hold the wrong shape: a migration that
 * changes a format, a JSON blob written by an older version, a status string that is no longer
 * in the enum. Parsing every row through Zod on the way out turns those into one loud error
 * naming the table and column, instead of an `undefined` that surfaces three layers away in
 * the UI.
 */

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(row)'}: ${issue.message}`)
    .join('; ');
}

export function hydrateRow<S extends z.ZodType>(
  table: string,
  schema: S,
  row: unknown,
): z.infer<S> {
  const result = schema.safeParse(row);
  if (!result.success) {
    throw new DataIntegrityError(table, describeIssues(result.error));
  }
  return result.data;
}

export function hydrateRows<S extends z.ZodType>(
  table: string,
  schema: S,
  rows: readonly unknown[],
): z.infer<S>[] {
  return rows.map((row) => hydrateRow(table, schema, row));
}

/**
 * Parses a TEXT column holding JSON. The `json_valid` CHECK constraint in the schema stops
 * malformed JSON being written in the first place; this catches the case where the JSON is
 * syntactically fine but no longer matches the shape the application expects.
 */
export function jsonColumn<S extends z.ZodType>(schema: S) {
  return z
    .string()
    .transform((raw, ctx): unknown => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'column does not contain valid JSON' });
        return z.NEVER;
      }
    })
    .pipe(schema);
}

/** SQLite has no boolean type; it stores 0 and 1. */
export const SqliteBooleanSchema = z
  .union([z.literal(0), z.literal(1)])
  .transform((value) => value === 1);

export function toSqliteBoolean(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}
