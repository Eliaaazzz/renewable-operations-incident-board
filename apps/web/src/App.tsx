import { useCallback, useMemo } from 'react';
import type { AlertListResponse, HealthResponse, SitesResponse, StatsResponse } from '@incident-board/shared';
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
      setUrlState({ ...urlState, filters: next });
    },
    [setUrlState, urlState],
  );

  const selectAlert = useCallback(
    (id: string | null) => {
      // Opening a drawer replaces rather than pushes: a Back press that only closes a panel is
      // a nuisance, whereas Back undoing a filter change is genuinely useful.
      setUrlState({ ...urlState, selectedAlertId: id }, 'replace');
    },
    [setUrlState, urlState],
  );

  const refreshBoard = useCallback(() => {
    alerts.refresh();
    stats.refresh();
    attention.refresh();
  }, [alerts, stats, attention]);

  const criticalActive =
    filters.severity.length === 1 && filters.severity[0] === 'critical';

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
          attentionActive={filters.needsAttention}
          criticalActive={criticalActive}
          onToggleAttention={() => {
            setFilters({ ...filters, needsAttention: !filters.needsAttention, page: 1 });
          }}
          onToggleCritical={() => {
            setFilters({
              ...filters,
              severity: criticalActive ? [] : ['critical'],
              status: criticalActive ? [] : ['new', 'acknowledged', 'in_progress'],
              page: 1,
            });
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
