import type { AlertStatus } from '@incident-board/shared';
import { loadConfig } from '../config.js';
import { isMainModule } from '../lib/is-main.js';
import { createAlertsRepository } from '../repositories/alerts.repo.js';
import { createEventsRepository, type NewEvent } from '../repositories/events.repo.js';
import { createNotesRepository } from '../repositories/notes.repo.js';
import { createSitesRepository } from '../repositories/sites.repo.js';
import { openDatabase, type Db } from './client.js';
import { runMigrations } from './migrate.js';
import { ALERT_LIFECYCLE, buildSeedData } from './seed-data.js';

/**
 * Seeding is idempotent: it does nothing when alerts already exist, so the server can call it
 * on every boot without ever overwriting an operator's work. `--force` clears first, which is
 * what the demo reset and the E2E fixtures use.
 */

export interface SeedOptions {
  /** Injected clock, so seeded timestamps are deterministic in tests. */
  now?: Date;
  /** Delete existing data first. Destructive by design and never the default. */
  force?: boolean;
}

export interface SeedResult {
  seeded: boolean;
  sites: number;
  alerts: number;
  notes: number;
}

export function seedDatabase(db: Db, options: SeedOptions = {}): SeedResult {
  const now = options.now ?? new Date();
  const force = options.force ?? false;

  const sites = createSitesRepository(db);
  const alerts = createAlertsRepository(db);
  const notes = createNotesRepository(db);
  const events = createEventsRepository(db);

  if (force) {
    // `alerts` cascades to notes, events and insights; sites cascade to alerts.
    db.exec('DELETE FROM alerts; DELETE FROM sites;');
  } else if (alerts.count() > 0) {
    return { seeded: false, sites: sites.count(), alerts: alerts.count(), notes: 0 };
  }

  const data = buildSeedData(now);
  const at = (hoursAgo: number): string =>
    new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();

  let noteCount = 0;

  db.transaction(() => {
    for (const site of data.sites) {
      sites.insert(site);
    }

    for (const alert of data.alerts) {
      alerts.insert(alert);
    }

    // Rebuild a plausible audit trail so the timeline in the detail view is not empty on a
    // fresh install. The transitions mirror what the lifecycle timestamps imply.
    for (const lifecycle of ALERT_LIFECYCLE) {
      const actor = lifecycle.assignee ?? 'operator';
      const trail: NewEvent[] = [
        {
          alertId: lifecycle.id,
          kind: 'alert_created',
          fromStatus: null,
          toStatus: 'new',
          actor: 'system',
          detail: 'Alert raised by monitoring',
          createdAt: at(lifecycle.detectedHoursAgo),
        },
      ];

      if (lifecycle.acknowledgedHoursAgo !== null) {
        trail.push(
          statusEvent(lifecycle.id, 'new', 'acknowledged', actor, at(lifecycle.acknowledgedHoursAgo)),
        );

        const startedHoursAgo = lifecycle.acknowledgedHoursAgo - 0.25;

        if (lifecycle.status === 'in_progress' || lifecycle.status === 'resolved') {
          trail.push(
            statusEvent(lifecycle.id, 'acknowledged', 'in_progress', actor, at(startedHoursAgo)),
          );
        }

        if (lifecycle.status === 'resolved' && lifecycle.resolvedHoursAgo !== null) {
          trail.push(
            statusEvent(lifecycle.id, 'in_progress', 'resolved', actor, at(lifecycle.resolvedHoursAgo)),
          );
        }

        if (lifecycle.status === 'dismissed' && lifecycle.resolvedHoursAgo !== null) {
          trail.push(
            statusEvent(lifecycle.id, 'acknowledged', 'dismissed', actor, at(lifecycle.resolvedHoursAgo)),
          );
        }
      }

      for (const event of trail) {
        events.append(event);
      }
    }

    const detectionByAlert = new Map(
      ALERT_LIFECYCLE.map((lifecycle) => [lifecycle.id, lifecycle.detectedHoursAgo]),
    );

    for (const note of data.notes) {
      const detectedHoursAgo = detectionByAlert.get(note.alertId);
      if (detectedHoursAgo === undefined) continue;

      const createdAt = at(detectedHoursAgo - note.minutesAfterDetection / 60);
      notes.create({
        alertId: note.alertId,
        author: note.author,
        body: note.body,
        createdAt,
      });
      events.append({
        alertId: note.alertId,
        kind: 'note_added',
        actor: note.author,
        detail: 'Follow-up note recorded',
        createdAt,
      });
      noteCount += 1;
    }
  })();

  return { seeded: true, sites: data.sites.length, alerts: data.alerts.length, notes: noteCount };
}

function statusEvent(
  alertId: string,
  from: AlertStatus,
  to: AlertStatus,
  actor: string,
  createdAt: string,
): NewEvent {
  return {
    alertId,
    kind: 'status_changed',
    fromStatus: from,
    toStatus: to,
    actor,
    detail: null,
    createdAt,
  };
}

if (isMainModule(import.meta.url)) {
  const config = loadConfig();
  const force = process.argv.includes('--force');
  const db = openDatabase(config.DATABASE_PATH);
  runMigrations(db);
  const result = seedDatabase(db, { force });
  db.close();

  process.stdout.write(
    result.seeded
      ? `Seeded ${result.sites} sites, ${result.alerts} alerts and ${result.notes} notes.\n`
      : `Database already contains ${result.alerts} alerts — nothing to do. Use "npm run seed -- --force" to reset.\n`,
  );
}
