import {
  PRIORITY_VALUES,
  SEVERITY_VALUES,
  STATUS_VALUES,
  isOpenStatus,
  type Priority,
  type Severity,
  type AlertStatus,
  type SitesResponse,
  type StatsResponse,
} from '@incident-board/shared';
import type { SitesRepository } from '../repositories/sites.repo.js';
import type { BoardEntry } from './board.js';
import type { Clock } from './alerts.service.js';

/**
 * Portfolio-level numbers for the header strip. Everything is derived from the same board
 * entries the list endpoint uses, so a count can never disagree with the rows behind it.
 */

export interface StatsServiceDeps {
  board: () => BoardEntry[];
  sites: SitesRepository;
  clock: Clock;
}

export type StatsService = ReturnType<typeof createStatsService>;

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

export function createStatsService(deps: StatsServiceDeps) {
  const { board, sites, clock } = deps;

  return {
    summary(): StatsResponse {
      const now = clock();
      const entries = board();
      const open = entries.filter((entry) => isOpenStatus(entry.alert.status));

      const openBySeverity = zeroed<Severity>(SEVERITY_VALUES);
      for (const entry of open) openBySeverity[entry.alert.severity] += 1;

      const openByPriority = zeroed<Priority>(PRIORITY_VALUES);
      for (const entry of open) openByPriority[entry.triage.priority] += 1;

      const byStatus = zeroed<AlertStatus>(STATUS_VALUES);
      for (const entry of entries) byStatus[entry.alert.status] += 1;

      const cutoff = now.getTime() - 24 * 3_600_000;
      const resolvedLast24h = entries.filter(
        (entry) =>
          entry.alert.status === 'resolved' &&
          entry.alert.resolvedAt !== null &&
          Date.parse(entry.alert.resolvedAt) >= cutoff,
      ).length;

      const acknowledgementDelays = entries
        .filter((entry) => entry.alert.acknowledgedAt !== null)
        .map(
          (entry) =>
            (Date.parse(entry.alert.acknowledgedAt as string) -
              Date.parse(entry.alert.detectedAt)) /
            60_000,
        )
        .filter((minutes) => Number.isFinite(minutes) && minutes >= 0);

      const bySite = sites.list().map((site) => {
        const forSite = entries.filter((entry) => entry.alert.siteId === site.id);
        return {
          siteId: site.id,
          siteName: site.name,
          open: forSite.filter((entry) => isOpenStatus(entry.alert.status)).length,
          needsAttention: forSite.filter((entry) => entry.triage.needsAttention).length,
        };
      });

      return {
        generatedAt: now.toISOString(),
        totals: {
          all: entries.length,
          open: open.length,
          needsAttention: entries.filter((entry) => entry.triage.needsAttention).length,
          slaBreached: open.filter((entry) => entry.triage.slaBreached).length,
          resolvedLast24h,
          unassignedOpen: open.filter((entry) => entry.alert.assignee === null).length,
        },
        openBySeverity,
        openByPriority,
        byStatus,
        bySite,
        // Null rather than zero when nothing has been acknowledged: "no data" and "acknowledged
        // instantly" are very different things to show an operations manager.
        meanTimeToAcknowledgeMinutes:
          acknowledgementDelays.length === 0
            ? null
            : Math.round(
                (acknowledgementDelays.reduce((sum, minutes) => sum + minutes, 0) /
                  acknowledgementDelays.length) *
                  10,
              ) / 10,
      };
    },

    sites(): SitesResponse {
      const entries = board();
      return {
        sites: sites.list().map((site) => ({
          ...site,
          openAlerts: entries.filter(
            (entry) => entry.alert.siteId === site.id && isOpenStatus(entry.alert.status),
          ).length,
        })),
      };
    },
  };
}
