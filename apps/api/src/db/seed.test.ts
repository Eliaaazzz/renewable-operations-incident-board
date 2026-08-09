import { afterEach, describe, expect, it } from 'vitest';
import { DataIntegrityError } from '../errors.js';
import { createAlertsRepository } from '../repositories/alerts.repo.js';
import { createNotesRepository } from '../repositories/notes.repo.js';
import { createSitesRepository } from '../repositories/sites.repo.js';
import { createTestDb, TEST_NOW } from '../testing/test-db.js';
import { openDatabase, type Db } from './client.js';
import { runMigrations, schemaVersion } from './migrate.js';
import { seedDatabase } from './seed.js';

let db: Db | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe('migrations', () => {
  it('are idempotent', () => {
    db = openDatabase(':memory:');
    const first = runMigrations(db);
    const second = runMigrations(db);
    expect(first).toBe(second);
    expect(second).toBeGreaterThan(0);
    expect(schemaVersion(db)).toBe(second);
  });

  it('enable foreign keys so cascades actually happen', () => {
    db = createTestDb();
    const notes = createNotesRepository(db);
    expect(notes.listByAlert('ALT-1039').length).toBeGreaterThan(0);

    db.prepare('DELETE FROM alerts WHERE id = ?').run('ALT-1039');

    // Without `PRAGMA foreign_keys = ON` these rows would be orphaned rather than removed.
    expect(notes.listByAlert('ALT-1039')).toHaveLength(0);
    const events = db
      .prepare('SELECT COUNT(*) AS count FROM alert_events WHERE alert_id = ?')
      .get('ALT-1039') as { count: number };
    expect(events.count).toBe(0);
  });

  it('rejects a metrics column that is not valid JSON', () => {
    db = createTestDb({ seed: false });
    createSitesRepository(db).insert({
      id: 'site-x',
      name: 'Site X',
      kind: 'solar',
      capacityMw: 10,
      energyMwh: null,
      region: 'Nowhere',
      timezone: 'UTC',
      gridOperator: 'None',
    });

    expect(() =>
      db!
        .prepare(
          `INSERT INTO alerts (id, site_id, type, severity, status, title, description, metrics,
                               detected_at, updated_at, source, version)
           VALUES ('X', 'site-x', 'comms_loss', 'low', 'new', 't', 'd', 'not json',
                   '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'test', 0)`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });
});

describe('seeding', () => {
  it('populates a realistic portfolio', () => {
    db = createTestDb();
    const sites = createSitesRepository(db);
    const alerts = createAlertsRepository(db);

    expect(sites.count()).toBe(6);
    expect(alerts.count()).toBe(18);
    expect(sites.maxCapacityMw()).toBe(50);

    const board = alerts.findForBoard();
    expect(board).toHaveLength(18);
    // Closed states must be represented, otherwise the board never exercises them.
    expect(board.some(({ alert }) => alert.status === 'resolved')).toBe(true);
    expect(board.some(({ alert }) => alert.status === 'dismissed')).toBe(true);
    expect(board.some(({ alert }) => alert.severity === 'critical')).toBe(true);
  });

  it('does nothing when alerts already exist', () => {
    db = createTestDb();
    const alerts = createAlertsRepository(db);
    const before = alerts.findForBoard();

    const result = seedDatabase(db, { now: TEST_NOW });

    expect(result.seeded).toBe(false);
    expect(alerts.findForBoard()).toEqual(before);
  });

  it('replaces everything when forced', () => {
    db = createTestDb();
    const alerts = createAlertsRepository(db);
    createNotesRepository(db).create({
      alertId: 'ALT-1042',
      author: 'tester',
      body: 'operator work that a reseed must not silently keep',
      createdAt: TEST_NOW.toISOString(),
    });

    const result = seedDatabase(db, { now: TEST_NOW, force: true });

    expect(result.seeded).toBe(true);
    expect(alerts.count()).toBe(18);
    expect(createNotesRepository(db).listByAlert('ALT-1042')).toHaveLength(0);
  });

  it('is deterministic for a fixed clock', () => {
    db = createTestDb();
    const first = createAlertsRepository(db).findForBoard();

    const second = openDatabase(':memory:');
    runMigrations(second);
    seedDatabase(second, { now: TEST_NOW });
    const secondBoard = createAlertsRepository(second).findForBoard();
    second.close();

    expect(secondBoard).toEqual(first);
  });

  it('keeps lifecycle timestamps in a coherent order', () => {
    db = createTestDb();
    for (const { alert } of createAlertsRepository(db).findForBoard()) {
      const detected = Date.parse(alert.detectedAt);
      expect(Date.parse(alert.updatedAt)).toBeGreaterThanOrEqual(detected);
      if (alert.acknowledgedAt !== null) {
        expect(Date.parse(alert.acknowledgedAt)).toBeGreaterThanOrEqual(detected);
      }
      if (alert.resolvedAt !== null) {
        expect(Date.parse(alert.resolvedAt)).toBeGreaterThanOrEqual(detected);
      }
      // A closed alert must record when it closed, or the audit trail lies.
      if (alert.status === 'resolved' || alert.status === 'dismissed') {
        expect(alert.resolvedAt).not.toBeNull();
      }
    }
  });

  it('includes the awkward cases the UI and the AI guards need', () => {
    db = createTestDb();
    const board = createAlertsRepository(db).findForBoard();
    const byId = new Map(board.map((entry) => [entry.alert.id, entry.alert]));

    // A long unbroken token, to prove the table truncates rather than overflowing.
    expect(byId.get('ALT-1032')?.assetId?.length).toBeGreaterThan(40);
    // A prompt-injection payload, so the guardrail path is exercised by real seeded data.
    expect(byId.get('ALT-1035')?.description).toMatch(/IGNORE ALL PREVIOUS INSTRUCTIONS/i);
    // A multi-note history, so the timeline is not always empty.
    expect(createNotesRepository(db).listByAlert('ALT-1039').length).toBeGreaterThanOrEqual(4);
  });
});

describe('row hydration', () => {
  it('rejects a JSON column that is valid JSON but the wrong shape', () => {
    db = createTestDb();
    // The `json_valid` CHECK is happy with this — it is syntactically fine. Only the read-side
    // schema knows that metric values are flat scalars, which is exactly the class of drift
    // that a blob written by an older version of the application would introduce.
    db.prepare('UPDATE alerts SET metrics = ? WHERE id = ?').run(
      '{"nested":{"unexpected":"object"}}',
      'ALT-1042',
    );

    expect(() => createAlertsRepository(db!).findById('ALT-1042')).toThrow(DataIntegrityError);
    expect(() => createAlertsRepository(db!).findById('ALT-1042')).toThrow(/metrics/);
  });

  it('rejects an enum value the application no longer understands', () => {
    db = createTestDb();
    // Simulates a value written before the enum was narrowed. The CHECK constraint blocks the
    // normal route in, so disable it to prove the read path guards independently.
    db.exec('PRAGMA ignore_check_constraints = ON');
    db.prepare("UPDATE alerts SET severity = 'catastrophic' WHERE id = 'ALT-1042'").run();

    expect(() => createAlertsRepository(db!).findById('ALT-1042')).toThrow(DataIntegrityError);
  });
});
