import { useCallback, useMemo } from 'react';
import {
  OPEN_STATUSES,
  type AlertListResponse,
  type AlertStatus,
  type HealthResponse,
  type SitesResponse,
  type StatsResponse,
} from '@incident-board/shared';
import { api } from './api/client';
import { useResource } from './api/useResource';
import { AlertDrawer } from './components/AlertDrawer';
import { AlertList, Pagination } from './components/AlertList';
import { AppHeader } from './components/AppHeader';
import { AttentionQueue } from './components/AttentionQueue';
import { FilterBar } from './components/FilterBar';
import { KpiStrip } from './components/KpiStrip';
import { useOperator, useTheme, useTickingClock } from './lib/usePreferences';
import { countActiveFilters, DEFAULT_FILTERS, type BoardFilters } from './state/filters';
import { useUrlState } from './state/useUrlState';
import styles from './App.module.css';

/** Live enough for an operations board, quiet enough not to fight someone reading it. */
const POLL_MS = 30_000;
const ATTENTION_PREVIEW = 5;
const OPEN_STATUS_FILTER = [...OPEN_STATUSES] as AlertStatus[];

function sameValues<T extends string>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function hasSecondaryFilters(filters: BoardFilters): boolean {
  return (
    filters.priority.length > 0 ||
    filters.siteId.length > 0 ||
    filters.q.trim().length > 0
  );
}

export function App(): React.JSX.Element {
  const [urlState, setUrlState] = useUrlState();
  const [operator, setOperator] = useOperator();
  const [theme, setTheme] = useTheme();
  const now = useTickingClock();

  const { filters, selectedAlertId } = urlState;

  const alerts = useResource<AlertListResponse>(
    (signal) => api.alerts(filters, signal),
    [JSON.stringify(filters)],
    { pollMs: POLL_MS },
  );

  const stats = useResource<StatsResponse>((signal) => api.stats(signal), [], {
    pollMs: POLL_MS,
  });

  const sites = useResource<SitesResponse>((signal) => api.sites(signal), []);

  const health = useResource<HealthResponse>((signal) => api.health(signal), [], {
    pollMs: 60_000,
  });

  /**
   * Fetched separately from the board, and deliberately not narrowed by the user's filters:
   * the panel answers "what am I ignoring?", which a filtered view cannot.
   */
  const attention = useResource<AlertListResponse>(
    (signal) =>
      api.alerts(
        {
          ...DEFAULT_FILTERS,
          needsAttention: true,
          sort: 'priority',
          order: 'desc',
          pageSize: ATTENTION_PREVIEW,
        },
        signal,
      ),
    [],
    { pollMs: POLL_MS },
  );

  const setFilters = useCallback(
    (next: BoardFilters) => {
      setUrlState((current) => ({ ...current, filters: next }));
    },
    [setUrlState],
  );

  const selectAlert = useCallback(
    (id: string | null) => {
      // Opening a drawer replaces rather than pushes: a Back press that only closes a panel is
      // a nuisance, whereas Back undoing a filter change is genuinely useful.
      setUrlState((current) => ({ ...current, selectedAlertId: id }), 'replace');
    },
    [setUrlState],
  );

  const refreshBoard = useCallback(() => {
    alerts.refresh();
    stats.refresh();
    attention.refresh();
  }, [alerts, stats, attention]);

  const attentionActive =
    filters.needsAttention &&
    filters.status.length === 0 &&
    filters.severity.length === 0 &&
    !hasSecondaryFilters(filters);

  const criticalActive =
    !filters.needsAttention &&
    filters.severity.length === 1 &&
    filters.severity[0] === 'critical' &&
    sameValues(filters.status, OPEN_STATUS_FILTER) &&
    !hasSecondaryFilters(filters);

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

  const listError = alerts.error;

  return (
    <div className={styles.app}>
      <a className="skip-link" href="#board">
        Skip to the alert list
      </a>

      <AppHeader
        health={health.data}
        refreshing={alerts.refreshing || stats.refreshing}
        operator={operator}
        theme={theme}
        onOperatorChange={setOperator}
        onThemeToggle={() => {
          setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark');
        }}
      />

      <main className={styles.main}>
        {listError !== null && (
          <div className={styles.banner} role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{listError.message}</span>
            <button type="button" className={`btn ${styles.bannerAction}`} onClick={alerts.refresh}>
              Retry
            </button>
          </div>
        )}

        <KpiStrip
          stats={stats.data}
          attentionActive={attentionActive}
          criticalActive={criticalActive}
          onToggleAttention={() => {
            setFilters(attentionActive ? DEFAULT_FILTERS : { ...DEFAULT_FILTERS, needsAttention: true });
          }}
          onToggleCritical={() => {
            setFilters(
              criticalActive
                ? DEFAULT_FILTERS
                : {
                    ...DEFAULT_FILTERS,
                    severity: ['critical'],
                    status: OPEN_STATUS_FILTER,
                  },
            );
          }}
        />

        <AttentionQueue
          alerts={attention.data?.items ?? []}
          total={attention.data?.total ?? 0}
          loading={attention.loading}
          onSelect={selectAlert}
          onViewAll={() => {
            setFilters({ ...DEFAULT_FILTERS, needsAttention: true });
          }}
          now={now}
        />

        <section className={styles.board} id="board" aria-label="All alerts">
          <FilterBar
            filters={filters}
            facets={alerts.data?.facets ?? null}
            sites={sites.data?.sites ?? []}
            onChange={setFilters}
            onClear={() => {
              setFilters(DEFAULT_FILTERS);
            }}
          />
          <AlertList
            alerts={alerts.data?.items ?? []}
            loading={alerts.loading}
            selectedId={selectedAlertId}
            hasFilters={activeFilterCount > 0}
            onSelect={selectAlert}
            onClearFilters={() => {
              setFilters(DEFAULT_FILTERS);
            }}
            now={now}
          />
          {alerts.data !== null && (
            <Pagination
              page={alerts.data.page}
              pageSize={alerts.data.pageSize}
              total={alerts.data.total}
              totalPages={alerts.data.totalPages}
              onPage={(page) => {
                setFilters({ ...filters, page });
              }}
            />
          )}
        </section>
      </main>

      {selectedAlertId !== null && (
        <AlertDrawer
          key={selectedAlertId}
          alertId={selectedAlertId}
          operator={operator}
          now={now}
          onClose={() => {
            selectAlert(null);
          }}
          onChanged={refreshBoard}
        />
      )}
    </div>
  );
}
