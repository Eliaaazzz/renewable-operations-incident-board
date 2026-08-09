import {
  ALERT_SORT_VALUES,
  PRIORITY_VALUES,
  SEVERITY_VALUES,
  STATUS_VALUES,
  type AlertSort,
  type AlertStatus,
  type Priority,
  type Severity,
} from '@incident-board/shared';

/**
 * Board state, and its serialisation to and from the URL.
 *
 * Putting filters in the query string is not decoration. A shift handover is somebody pasting
 * a link into chat and expecting the other person to see the same board; the browser Back
 * button should undo a filter, not leave the application; and a bug report is far easier to act
 * on when the URL already contains the state that produced it.
 */

export interface BoardFilters {
  status: AlertStatus[];
  severity: Severity[];
  priority: Priority[];
  siteId: string[];
  q: string;
  needsAttention: boolean;
  sort: AlertSort;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export const DEFAULT_FILTERS: BoardFilters = {
  status: [],
  severity: [],
  priority: [],
  siteId: [],
  q: '',
  needsAttention: false,
  sort: 'priority',
  order: 'desc',
  page: 1,
  pageSize: 25,
};

export interface BoardUrlState {
  filters: BoardFilters;
  /** The alert whose drawer is open, so a deep link opens straight to it. */
  selectedAlertId: string | null;
}

function readList<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T[] {
  const raw = params.get(key);
  if (raw === null) return [];
  // Unknown values are dropped rather than sent to the API: a stale bookmark should show a
  // slightly wider board, not a 400.
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is T => (allowed as readonly string[]).includes(value));
}

export function parseUrlState(search: string): BoardUrlState {
  const params = new URLSearchParams(search);
  const sortParam = params.get('sort');
  const orderParam = params.get('order');
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  const pageSize = Number.parseInt(params.get('pageSize') ?? '25', 10);

  return {
    filters: {
      status: readList(params, 'status', STATUS_VALUES),
      severity: readList(params, 'severity', SEVERITY_VALUES),
      priority: readList(params, 'priority', PRIORITY_VALUES),
      siteId: (params.get('siteId') ?? '').split(',').filter((value) => value.length > 0),
      q: params.get('q') ?? '',
      needsAttention: params.get('needsAttention') === 'true',
      sort:
        sortParam !== null && (ALERT_SORT_VALUES as readonly string[]).includes(sortParam)
          ? (sortParam as AlertSort)
          : DEFAULT_FILTERS.sort,
      order: orderParam === 'asc' ? 'asc' : 'desc',
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 25,
    },
    selectedAlertId: params.get('alert'),
  };
}

export function serialiseUrlState(state: BoardUrlState): string {
  const params = new URLSearchParams();
  const { filters } = state;

  // Only non-default values are written, so the common case is a clean, readable URL.
  if (filters.status.length > 0) params.set('status', filters.status.join(','));
  if (filters.severity.length > 0) params.set('severity', filters.severity.join(','));
  if (filters.priority.length > 0) params.set('priority', filters.priority.join(','));
  if (filters.siteId.length > 0) params.set('siteId', filters.siteId.join(','));
  if (filters.q.trim().length > 0) params.set('q', filters.q.trim());
  if (filters.needsAttention) params.set('needsAttention', 'true');
  if (filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.order !== DEFAULT_FILTERS.order) params.set('order', filters.order);
  if (filters.page !== 1) params.set('page', String(filters.page));
  if (filters.pageSize !== DEFAULT_FILTERS.pageSize) params.set('pageSize', String(filters.pageSize));
  if (state.selectedAlertId !== null) params.set('alert', state.selectedAlertId);

  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

export function countActiveFilters(filters: BoardFilters): number {
  return (
    filters.status.length +
    filters.severity.length +
    filters.priority.length +
    filters.siteId.length +
    (filters.q.trim().length > 0 ? 1 : 0) +
    (filters.needsAttention ? 1 : 0)
  );
}

/** Adds or removes one value from a multi-select dimension, resetting to the first page. */
export function toggleFilterValue<K extends 'status' | 'severity' | 'priority' | 'siteId'>(
  filters: BoardFilters,
  key: K,
  value: BoardFilters[K][number],
): BoardFilters {
  const current = filters[key] as string[];
  const next = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];
  // Staying on page 4 after narrowing to six results shows an empty screen and reads as a bug.
  return { ...filters, [key]: next, page: 1 } as BoardFilters;
}
