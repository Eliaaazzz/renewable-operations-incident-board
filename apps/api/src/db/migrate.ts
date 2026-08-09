import { z } from 'zod';
import { loadConfig } from '../config.js';
import { isMainModule } from '../lib/is-main.js';
import { openDatabase, type Db } from './client.js';
import { MIGRATIONS } from './migrations/index.js';

/**
 * A deliberately small migration runner: apply anything not yet recorded, in id order, each in
 * its own transaction. Running it twice is a no-op, which is what lets the server migrate on
 * boot without a separate deployment step.
 */

const AppliedIdSchema = z.object({ id: z.number().int() });

export function runMigrations(db: Db): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare('SELECT id FROM schema_migrations')
      .all()
      .map((row) => AppliedIdSchema.parse(row).id),
  );

  const insert = db.prepare(
    'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)',
  );

  const pending = [...MIGRATIONS].sort((a, b) => a.id - b.id).filter((m) => !applied.has(m.id));

  for (const migration of pending) {
    // A migration that fails halfway leaves no partial schema and no bookkeeping row, so the
    // next run retries it from a clean state rather than skipping it.
    db.transaction(() => {
      db.exec(migration.sql);
      insert.run(migration.id, migration.name, new Date().toISOString());
    })();
  }

  return schemaVersion(db);
}

export function schemaVersion(db: Db): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(id), 0) AS version FROM schema_migrations')
    .get();
  return z.object({ version: z.number().int() }).parse(row).version;
}

if (isMainModule(import.meta.url)) {
  const config = loadConfig();
  const db = openDatabase(config.DATABASE_PATH);
  const version = runMigrations(db);
  db.close();
  process.stdout.write(`Migrations applied. Schema version: ${version}\n`);
}
