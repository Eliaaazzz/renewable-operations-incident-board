import { useEffect, useState } from 'react';
import {
  ALERT_SORT_VALUES,
  PRIORITY_VALUES,
  SEVERITY_LABEL,
  SEVERITY_VALUES,
  STATUS_LABEL,
  STATUS_VALUES,
  type AlertFacets,
  type AlertSort,
  type Site,
} from '@incident-board/shared';
import { countActiveFilters, toggleFilterValue, type BoardFilters } from '../state/filters';
import styles from './FilterBar.module.css';

/**
 * Filtering, with the counts visible before you commit to a click.
 *
 * Each chip shows how many alerts selecting it would give — computed by the API with that
 * dimension's own filter removed. A chip reading `(0)` is disabled rather than hidden: an
 * operator who expects three critical alerts needs to see that there are none, not to wonder
 * where the button went.
 */

const SORT_LABEL: Record<AlertSort, string> = {
  priority: 'Priority',
  detectedAt: 'Detected',
  updatedAt: 'Last updated',
  severity: 'Severity',
  site: 'Site',
  status: 'Status',
};

interface FilterBarProps {
  filters: BoardFilters;
  facets: AlertFacets | null;
  sites: Site[];
  onChange: (next: BoardFilters) => void;
  onClear: () => void;
}

export function FilterBar({
  filters,
  facets,
  sites,
  onChange,
  onClear,
}: FilterBarProps): React.JSX.Element {
  // The input is controlled locally and pushed upward on a delay: re-querying on every
  // keystroke would make the board flicker while someone types an asset id.
  const [searchDraft, setSearchDraft] = useState(filters.q);

  useEffect(() => {
    setSearchDraft(filters.q);
  }, [filters.q]);

  useEffect(() => {
    if (searchDraft === filters.q) return;
    const timer = window.setTimeout(() => {
      onChange({ ...filters, q: searchDraft, page: 1 });
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const activeCount = countActiveFilters(filters);

  return (
    <div className={styles.bar}>
      <div className={styles.controls}>
        <div className={styles.search}>
          <span className={styles.searchIcon} aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search title, description, asset or site…"
            aria-label="Search alerts"
            value={searchDraft}
            onChange={(event) => {
              setSearchDraft(event.target.value);
            }}
          />
        </div>

        <button
          type="button"
          className={styles.toggle}
          aria-pressed={filters.needsAttention}
          onClick={() => {
            onChange({ ...filters, needsAttention: !filters.needsAttention, page: 1 });
          }}
        >
          Needs attention only
        </button>

        <div className={styles.spacer} />

        <div className={styles.sort}>
          <label className={styles.sortLabel} htmlFor="sort-field">
            Sort
          </label>
          <select
            id="sort-field"
            className={styles.select}
            value={filters.sort}
            onChange={(event) => {
              onChange({ ...filters, sort: event.target.value as AlertSort, page: 1 });
            }}
          >
            {ALERT_SORT_VALUES.map((value) => (
              <option key={value} value={value}>
                {SORT_LABEL[value]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.filterChip}
            onClick={() => {
              onChange({ ...filters, order: filters.order === 'desc' ? 'asc' : 'desc', page: 1 });
            }}
            title={filters.order === 'desc' ? 'Highest first' : 'Lowest first'}
          >
            <span aria-hidden="true">{filters.order === 'desc' ? '↓' : '↑'}</span>
            {filters.order === 'desc' ? 'Desc' : 'Asc'}
          </button>
        </div>
      </div>

      <div className={styles.groups}>
        <fieldset className={styles.group}>
          <legend className={styles.groupLabel}>Priority</legend>
          {PRIORITY_VALUES.map((priority) => (
            <ChipToggle
              key={priority}
              label={priority}
              count={facets?.priority[priority]}
              pressed={filters.priority.includes(priority)}
              onClick={() => {
                onChange(toggleFilterValue(filters, 'priority', priority));
              }}
            />
          ))}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.groupLabel}>Severity</legend>
          {SEVERITY_VALUES.map((severity) => (
            <ChipToggle
              key={severity}
              label={SEVERITY_LABEL[severity]}
              count={facets?.severity[severity]}
              pressed={filters.severity.includes(severity)}
              onClick={() => {
                onChange(toggleFilterValue(filters, 'severity', severity));
              }}
            />
          ))}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.groupLabel}>Status</legend>
          {STATUS_VALUES.map((status) => (
            <ChipToggle
              key={status}
              label={STATUS_LABEL[status]}
              count={facets?.status[status]}
              pressed={filters.status.includes(status)}
              onClick={() => {
                onChange(toggleFilterValue(filters, 'status', status));
              }}
            />
          ))}
        </fieldset>

        {sites.length > 0 && (
          <fieldset className={styles.group}>
            <legend className={styles.groupLabel}>Site</legend>
            {sites.map((site) => (
              <ChipToggle
                key={site.id}
                label={site.name}
                count={facets?.site[site.id] ?? 0}
                pressed={filters.siteId.includes(site.id)}
                onClick={() => {
                  onChange(toggleFilterValue(filters, 'siteId', site.id));
                }}
              />
            ))}
          </fieldset>
        )}
      </div>

      {activeCount > 0 && (
        <div className={styles.summary}>
          <span>
            {activeCount} filter{activeCount === 1 ? '' : 's'} active
          </span>
          <button type="button" className={styles.clear} onClick={onClear}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

interface ChipToggleProps {
  label: string;
  count: number | undefined;
  pressed: boolean;
  onClick: () => void;
}

function ChipToggle({ label, count, pressed, onClick }: ChipToggleProps): React.JSX.Element {
  const matchText =
    count === undefined ? undefined : `${count} alert${count === 1 ? '' : 's'} match current filters`;
  return (
    <button
      type="button"
      className={styles.filterChip}
      aria-pressed={pressed}
      aria-label={matchText === undefined ? label : `${label}, ${matchText}`}
      title={matchText}
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}
