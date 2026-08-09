import type {
  AlertDetailResponse,
  AlertListQuery,
  AlertListResponse,
  AlertNote,
  AlertStatus,
  CreateNoteBody,
  PatchAlertBody,
} from '@incident-board/shared';
import { assertTransitionAllowed, allowedTransitions } from '../domain/transitions.js';
import { NotFoundError, VersionConflictError } from '../errors.js';
import type { Db } from '../db/client.js';
import type { AlertsRepository, AlertUpdate } from '../repositories/alerts.repo.js';
import type { EventsRepository } from '../repositories/events.repo.js';
import type { InsightsRepository } from '../repositories/insights.repo.js';
import type { NotesRepository } from '../repositories/notes.repo.js';
import type { SitesRepository } from '../repositories/sites.repo.js';
import {
  buildBoard,
  computeFacets,
  filterEntries,
  paginate,
  sortEntries,
  toSummary,
  type BoardEntry,
} from './board.js';

export type Clock = () => Date;

export interface AlertsServiceDeps {
  db: Db;
  alerts: AlertsRepository;
  sites: SitesRepository;
  notes: NotesRepository;
  events: EventsRepository;
  insights: InsightsRepository;
  clock: Clock;
}

export type AlertsService = ReturnType<typeof createAlertsService>;

export function createAlertsService(deps: AlertsServiceDeps) {
  const { db, alerts, sites, notes, events, insights, clock } = deps;

  function loadBoard(): BoardEntry[] {
    return buildBoard(alerts.findForBoard(), sites.list(), clock());
  }

  function loadEntry(id: string): BoardEntry {
    const row = alerts.findById(id);
    if (row === null) throw new NotFoundError('Alert', id);
    const [entry] = buildBoard([row], sites.list(), clock());
    if (entry === undefined) throw new NotFoundError('Alert', id);
    return entry;
  }

  function detailFor(entry: BoardEntry): AlertDetailResponse {
    return {
      alert: toSummary(entry),
      notes: notes.listByAlert(entry.alert.id),
      events: events.listByAlert(entry.alert.id),
      insight: insights.latestForAlert(entry.alert.id),
      // The server decides what moves are legal so the UI cannot offer an illegal one and then
      // have it rejected — the affordance and the rule come from the same place.
      allowedTransitions: [...allowedTransitions(entry.alert.status)],
    };
  }

  return {
    list(query: AlertListQuery): AlertListResponse {
      const board = loadBoard();
      const matching = filterEntries(board, query);
      const sorted = sortEntries(matching, query.sort, query.order);
      const page = paginate(sorted, query.page, query.pageSize);

      return {
        items: page.items.map(toSummary),
        page: page.page,
        pageSize: page.pageSize,
        total: page.total,
        totalPages: page.totalPages,
        facets: computeFacets(board, query),
      };
    },

    detail(id: string): AlertDetailResponse {
      return detailFor(loadEntry(id));
    },

    /**
     * Applies a status and/or assignee change.
     *
     * Ordering matters: validate the transition before touching anything, then let the database
     * enforce the version guard inside the same statement that performs the write. A
     * read-compare-write in application code would leave a window where two operators both read
     * version 3 and both write version 4.
     */
    patch(id: string, body: PatchAlertBody): AlertDetailResponse {
      const existing = alerts.findById(id);
      if (existing === null) throw new NotFoundError('Alert', id);

      const current = existing.alert;
      const now = clock().toISOString();
      const update: AlertUpdate = {};

      if (body.status !== undefined) {
        assertTransitionAllowed(current.status, body.status);
        update.status = body.status;
        Object.assign(update, lifecycleTimestamps(current.status, body.status, current, now));
      }

      if (body.assignee !== undefined) {
        update.assignee = body.assignee;
      }

      db.transaction(() => {
        const applied = alerts.applyUpdate(id, update, body.expectedVersion, now);
        if (!applied) {
          const actual = alerts.currentVersion(id);
          if (actual === null) throw new NotFoundError('Alert', id);
          throw new VersionConflictError(body.expectedVersion, actual);
        }

        if (body.status !== undefined && body.status !== current.status) {
          events.append({
            alertId: id,
            kind: 'status_changed',
            fromStatus: current.status,
            toStatus: body.status,
            actor: body.actor,
            detail: null,
            createdAt: now,
          });
        }

        if (body.assignee !== undefined && body.assignee !== current.assignee) {
          events.append({
            alertId: id,
            kind: 'assignee_changed',
            actor: body.actor,
            detail: body.assignee === null ? 'Unassigned' : `Assigned to ${body.assignee}`,
            createdAt: now,
          });
        }

        // A note supplied with the change records *why* it happened, in the same transaction
        // as the change itself — so the audit trail can never contain one without the other.
        if (body.note !== undefined) {
          notes.create({ alertId: id, author: body.actor, body: body.note, createdAt: now });
          events.append({
            alertId: id,
            kind: 'note_added',
            actor: body.actor,
            detail: 'Note recorded with status change',
            createdAt: now,
          });
        }
      })();

      return detailFor(loadEntry(id));
    },

    addNote(id: string, body: CreateNoteBody): AlertNote {
      const existing = alerts.findById(id);
      if (existing === null) throw new NotFoundError('Alert', id);

      const now = clock().toISOString();

      return db.transaction(() => {
        const note = notes.create({
          alertId: id,
          author: body.author,
          body: body.body,
          createdAt: now,
        });
        events.append({
          alertId: id,
          kind: 'note_added',
          actor: body.author,
          detail: null,
          createdAt: now,
        });
        alerts.touch(id, now);
        return note;
      })();
    },

    /** Shared by the stats and insight services so triage is computed one way only. */
    board: loadBoard,
    entry: loadEntry,
    detailFor,
  };
}

/**
 * Keeps the lifecycle timestamps consistent with the status.
 *
 * Starting work implies acknowledgement even if nobody pressed "acknowledge" first — otherwise
 * an alert someone picked up immediately would be recorded as never acknowledged and would
 * report an SLA breach it did not have.
 */
function lifecycleTimestamps(
  from: AlertStatus,
  to: AlertStatus,
  current: { acknowledgedAt: string | null },
  now: string,
): Pick<AlertUpdate, 'acknowledgedAt' | 'resolvedAt'> {
  const patch: Pick<AlertUpdate, 'acknowledgedAt' | 'resolvedAt'> = {};

  if ((to === 'acknowledged' || to === 'in_progress') && current.acknowledgedAt === null) {
    patch.acknowledgedAt = now;
  }

  if (to === 'resolved' || to === 'dismissed') {
    patch.resolvedAt = now;
  }

  // Reopening clears the closure timestamp: the incident is live again, and leaving a
  // resolution time on an open alert would corrupt any later "time to resolve" reporting.
  if ((from === 'resolved' || from === 'dismissed') && to === 'in_progress') {
    patch.resolvedAt = null;
  }

  return patch;
}
