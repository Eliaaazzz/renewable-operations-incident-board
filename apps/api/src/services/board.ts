import {
  PRIORITY_VALUES,
  SEVERITY_RANK,
  SEVERITY_VALUES,
  STATUS_RANK,
  STATUS_VALUES,
  type Alert,
  type AlertFacets,
  type AlertListQuery,
  type AlertSort,
  type AlertSummary,
  type Priority,
  type Severity,
  type Site,
  type AlertStatus,
  type Triage,
} from '@incident-board/shared';
import { computeTriage } from '../domain/triage.js';
import type { BoardAlert } from '../repositories/alerts.repo.js';

/**
 * Filtering, ranking, faceting and pagination — all pure functions over an already-loaded set.
 *
 * Keeping this out of SQL is a deliberate trade. Priority, "needs attention" and SLA state are
 * derived from the current time, so they cannot be indexed without materialising a score that
 * is stale the moment it is written. Deriving them in one pass means the ranking is always
 * truthful and every rule in this file is directly unit-testable without a database.
 */

export interface BoardEntry {
  alert: Alert;
  site: Site;
  triage: Triage;
  noteCount: number;
  hasInsight: boolean;
}

export function buildBoard(rows: readonly BoardAlert[], sites: readonly Site[], now: Date): BoardEntry[] {
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const portfolioMaxCapacityMw = sites.reduce((max, site) => Math.max(max, site.capacityMw), 0);

  const entries: BoardEntry[] = [];
  for (const row of rows) {
    const site = siteById.get(row.alert.siteId);
    // A foreign key guarantees the site exists; skipping rather than throwing means a partially
    // migrated database still renders a board instead of a blank error page.
    if (site === undefined) continue;

    entries.push({
      alert: row.alert,
      site,
      triage: computeTriage(
        {
          severity: row.alert.severity,
          type: row.alert.type,
          status: row.alert.status,
          detectedAt: row.alert.detectedAt,
          acknowledgedAt: row.alert.acknowledgedAt,
          siteCapacityMw: site.capacityMw,
        },
        { now, portfolioMaxCapacityMw },
      ),
      noteCount: row.noteCount,
      hasInsight: row.hasInsight,
    });
  }
  return entries;
}

export function toSummary(entry: BoardEntry): AlertSummary {
  return {
    ...entry.alert,
    site: entry.site,
    triage: entry.triage,
    noteCount: entry.noteCount,
    hasInsight: entry.hasInsight,
  };
}

/* ------------------------------------------------------------------ filtering */

/** Which filter dimensions to apply. Omitting one is how per-dimension facets are computed. */
type FilterDimension = 'status' | 'severity' | 'siteId' | 'type' | 'priority' | 'text' | 'range' | 'attention';

const ALL_DIMENSIONS: readonly FilterDimension[] = [
  'status',
  'severity',
  'siteId',
  'type',
  'priority',
  'text',
  'range',
  'attention',
];

function matchesText(entry: BoardEntry, needle: string): boolean {
  const haystack = [
    entry.alert.id,
    entry.alert.title,
    entry.alert.description,
    entry.alert.assetId ?? '',
    entry.site.name,
    entry.alert.assignee ?? '',
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(needle);
}

export function filterEntries(
  entries: readonly BoardEntry[],
  query: AlertListQuery,
  dimensions: readonly FilterDimension[] = ALL_DIMENSIONS,
): BoardEntry[] {
  const active = new Set(dimensions);
  const needle = query.q?.trim().toLowerCase();
  const fromMs = query.from === undefined ? null : Date.parse(query.from);
  const toMs = query.to === undefined ? null : Date.parse(query.to);

  return entries.filter((entry) => {
    if (active.has('status') && query.status && !query.status.includes(entry.alert.status)) {
      return false;
    }
    if (active.has('severity') && query.severity && !query.severity.includes(entry.alert.severity)) {
      return false;
    }
    if (active.has('siteId') && query.siteId && !query.siteId.includes(entry.alert.siteId)) {
      return false;
    }
    if (active.has('type') && query.type && !query.type.includes(entry.alert.type)) {
      return false;
    }
    if (active.has('priority') && query.priority && !query.priority.includes(entry.triage.priority)) {
      return false;
    }
    if (active.has('attention') && query.needsAttention !== undefined) {
      if (entry.triage.needsAttention !== query.needsAttention) return false;
    }
    if (active.has('text') && needle !== undefined && needle.length > 0) {
      if (!matchesText(entry, needle)) return false;
    }
    if (active.has('range')) {
      const detectedMs = Date.parse(entry.alert.detectedAt);
      if (fromMs !== null && detectedMs < fromMs) return false;
      if (toMs !== null && detectedMs > toMs) return false;
    }
    return true;
  });
}

/* -------------------------------------------------------------------- sorting */

function primaryComparator(sort: AlertSort): (a: BoardEntry, b: BoardEntry) => number {
  switch (sort) {
    case 'priority':
      return (a, b) => a.triage.score - b.triage.score;
    case 'detectedAt':
      return (a, b) => Date.parse(a.alert.detectedAt) - Date.parse(b.alert.detectedAt);
    case 'updatedAt':
      return (a, b) => Date.parse(a.alert.updatedAt) - Date.parse(b.alert.updatedAt);
    case 'severity':
      return (a, b) => SEVERITY_RANK[a.alert.severity] - SEVERITY_RANK[b.alert.severity];
    case 'status':
      return (a, b) => STATUS_RANK[b.alert.status] - STATUS_RANK[a.alert.status];
    case 'site':
      return (a, b) => b.site.name.localeCompare(a.site.name);
  }
}

export function sortEntries(
  entries: readonly BoardEntry[],
  sort: AlertSort,
  order: 'asc' | 'desc',
): BoardEntry[] {
  const compare = primaryComparator(sort);
  const direction = order === 'desc' ? -1 : 1;

  return [...entries].sort((a, b) => {
    const primary = compare(a, b) * direction;
    if (primary !== 0) return primary;
    // Always break ties the same way, in the same direction, regardless of sort order. Without
    // a stable tie-break, two alerts with equal scores can swap between requests and a row can
    // appear on both page 1 and page 2, or on neither.
    return a.alert.id.localeCompare(b.alert.id);
  });
}

/* -------------------------------------------------------------------- facets */

function zeroed<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

/**
 * Counts per dimension, each computed with every *other* filter applied but that dimension's
 * own filter removed. That is what makes a filter chip able to say "Critical (3)" while you
 * are already filtered to something else — the number tells you what selecting it would give
 * you, rather than restating what you have already selected.
 */
export function computeFacets(entries: readonly BoardEntry[], query: AlertListQuery): AlertFacets {
  const without = (dimension: FilterDimension): BoardEntry[] =>
    filterEntries(
      entries,
      query,
      ALL_DIMENSIONS.filter((candidate) => candidate !== dimension),
    );

  const status = zeroed<AlertStatus>(STATUS_VALUES);
  for (const entry of without('status')) status[entry.alert.status] += 1;

  const severity = zeroed<Severity>(SEVERITY_VALUES);
  for (const entry of without('severity')) severity[entry.alert.severity] += 1;

  const priority = zeroed<Priority>(PRIORITY_VALUES);
  for (const entry of without('priority')) priority[entry.triage.priority] += 1;

  const site: Record<string, number> = {};
  for (const entry of without('siteId')) {
    site[entry.alert.siteId] = (site[entry.alert.siteId] ?? 0) + 1;
  }

  return { status, severity, priority, site };
}

/* ---------------------------------------------------------------- pagination */

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): Page<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Asking for page 9 of a 2-page result returns an empty page rather than an error: the
  // filters may simply have narrowed since the link was shared, and an empty list with an
  // accurate `totalPages` is more useful than a 404.
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    totalPages,
  };
}
