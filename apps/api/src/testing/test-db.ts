import { openDatabase, type Db } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';

/**
 * A migrated, optionally seeded in-memory database for tests.
 *
 * In-memory keeps the suite fast and needs no cleanup. It exercises the same SQL, constraints
 * and hydration path as the file-backed database; the one thing it cannot exercise is WAL
 * behaviour under concurrent processes, which is covered by the optimistic-concurrency tests
 * at the service level instead.
 */

/** Fixed clock so seeded ages, priorities and SLA states are identical on every run. */
export const TEST_NOW = new Date('2026-08-09T12:00:00.000Z');

export interface TestDbOptions {
  seed?: boolean;
  now?: Date;
}

export function createTestDb(options: TestDbOptions = {}): Db {
  const db = openDatabase(':memory:');
  runMigrations(db);
  if (options.seed !== false) {
    seedDatabase(db, { now: options.now ?? TEST_NOW });
  }
  return db;
}
