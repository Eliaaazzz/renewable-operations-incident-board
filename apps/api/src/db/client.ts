import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * Opens the SQLite database with the pragmas this application actually depends on.
 *
 * - `journal_mode = WAL` lets a reader (the alert list) run while a writer (a status change)
 *   commits, which matters because the board polls while operators are typing.
 * - `busy_timeout` turns the "database is locked" race into a short wait instead of an error.
 * - `foreign_keys = ON` is off by default in SQLite; without it the `ON DELETE CASCADE`
 *   declarations in the schema are decorative.
 */
export function openDatabase(databasePath: string): Db {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  const db = new Database(databasePath);

  // WAL is a no-op for in-memory databases; SQLite reports `memory` and carries on.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  // NORMAL is the right durability trade for an operations dashboard: a crash can lose the
  // last commit, which is recoverable, in exchange for not fsyncing on every note.
  db.pragma('synchronous = NORMAL');

  return db;
}

/** Wraps a function in a transaction. Rolls back on throw, which is what callers assume. */
export function transact<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)();
}
