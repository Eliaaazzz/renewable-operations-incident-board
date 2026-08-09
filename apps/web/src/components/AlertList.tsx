import { ALERT_TYPE_META, type AlertSummary } from '@incident-board/shared';
import { formatCapacity, formatDuration, formatRelativeTime } from '../lib/format';
import { useMediaQuery } from '../lib/useMediaQuery';
import { PriorityBadge, SeverityBadge, SlaBreachBadge, StatusBadge } from './Badges';
import styles from './AlertList.module.css';

/**
 * The alert list.
 *
 * A real `<table>` at desktop width — this is tabular data and a screen reader should be able
 * to announce the column when it reads a cell — and a stacked card list below 900px, chosen by
 * media query rather than by rendering both and hiding one.
 *
 * `table-layout: fixed` with declared column widths is what stops a long asset id or a verbose
 * title from stretching a column into its neighbour. Every cell then truncates or wraps within
 * the width it was given, which is asserted by the Playwright layout audit at four viewports.
 */

interface AlertListProps {
  alerts: AlertSummary[];
  loading: boolean;
  selectedId: string | null;
  hasFilters: boolean;
  onSelect: (id: string) => void;
  onClearFilters: () => void;
  now: Date;
}

export function AlertList(props: AlertListProps): React.JSX.Element {
  const isWide = useMediaQuery('(min-width: 900px)');

  if (props.loading) {
    return (
      <div className={styles.panel}>
        <div role="status" aria-live="polite" className="visually-hidden">
          Loading alerts
        </div>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className={styles.skeletonRow} aria-hidden="true" />
        ))}
      </div>
    );
  }

  if (props.alerts.length === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No alerts match these filters</p>
          <p>
            {props.hasFilters
              ? 'Nothing on the board fits the current combination.'
              : 'The board is empty. Alerts will appear here as monitoring raises them.'}
          </p>
          {props.hasFilters && (
            <button type="button" className="btn" onClick={props.onClearFilters}>
              Clear all filters
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {isWide ? <AlertTable {...props} /> : <AlertCards {...props} />}
    </div>
  );
}

function AlertTable({ alerts, selectedId, onSelect, now }: AlertListProps): React.JSX.Element {
  return (
    <div className={styles.scroller}>
      <table className={styles.table}>
        <caption className="visually-hidden">
          Alerts, ranked by triage priority. Select a row to open its detail panel.
        </caption>
        <thead>
          <tr>
            <th scope="col" className={styles.colPriority}>
              Priority
            </th>
            <th scope="col" className={styles.colAlert}>
              Alert
            </th>
            <th scope="col" className={styles.colSite}>
              Site
            </th>
            <th scope="col" className={styles.colSeverity}>
              Severity
            </th>
            <th scope="col" className={styles.colStatus}>
              Status
            </th>
            <th scope="col" className={styles.colAge}>
              Age
            </th>
            <th scope="col" className={styles.colMeta}>
              Activity
            </th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr
              key={alert.id}
              className={styles.row}
              aria-selected={alert.id === selectedId}
              onClick={() => {
                onSelect(alert.id);
              }}
            >
              <td>
                <PriorityBadge
                  priority={alert.triage.priority}
                  title={`Score ${alert.triage.score} — ${alert.triage.reasons.join('; ')}`}
                />
              </td>
              <td>
                {/* The row is clickable for the mouse; this button is what the keyboard and a
                    screen reader use, so the interaction is not mouse-only. */}
                <button
                  type="button"
                  className={`${styles.titleButton} clamp-2`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(alert.id);
                  }}
                >
                  {alert.title}
                </button>
                <div className={styles.subline}>
                  <span className="mono">{alert.id}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{ALERT_TYPE_META[alert.type].label}</span>
                  {alert.assetId !== null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`mono truncate ${styles.assetId}`}
                        title={alert.assetId}
                      >
                        {alert.assetId}
                      </span>
                    </>
                  )}
                </div>
              </td>
              <td>
                <div className={`${styles.siteName} truncate`} title={alert.site.name}>
                  {alert.site.name}
                </div>
                <div className={`${styles.siteMeta} truncate`}>
                  {formatCapacity(alert.site.capacityMw, alert.site.energyMwh)}
                </div>
              </td>
              <td>
                <SeverityBadge severity={alert.severity} />
              </td>
              <td>
                <StatusBadge status={alert.status} />
              </td>
              <td>
                <div className={styles.age}>
                  <span className={styles.ageValue}>{formatRelativeTime(alert.detectedAt, now)}</span>
                  {alert.triage.slaBreached && (
                    <SlaBreachBadge target={formatDuration(alert.triage.slaAckMinutes)} />
                  )}
                </div>
              </td>
              <td>
                <div className={styles.metaCell}>
                  {alert.noteCount > 0 && (
                    <span title={`${alert.noteCount} follow-up notes`}>
                      <span aria-hidden="true">✎</span> {alert.noteCount}
                    </span>
                  )}
                  {alert.hasInsight && (
                    <span className={styles.aiDot} title="An AI assessment has been generated">
                      <span aria-hidden="true">✦</span>
                      <span className="visually-hidden">AI assessment available</span>
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertCards({ alerts, selectedId, onSelect, now }: AlertListProps): React.JSX.Element {
  return (
    <ul className={styles.cards} aria-label="Alerts">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <button
            type="button"
            className={styles.card}
            aria-current={alert.id === selectedId}
            onClick={() => {
              onSelect(alert.id);
            }}
          >
            <span className={styles.cardTop}>
              <PriorityBadge priority={alert.triage.priority} />
              <SeverityBadge severity={alert.severity} />
              <StatusBadge status={alert.status} />
            </span>
            <span className={`${styles.cardTitle} wrap-anywhere`}>{alert.title}</span>
            <span className={styles.cardMeta}>
              <span className="mono">{alert.id}</span>
              <span className="wrap-anywhere">{alert.site.name}</span>
              <span>{formatRelativeTime(alert.detectedAt, now)}</span>
              {alert.noteCount > 0 && <span>{alert.noteCount} notes</span>}
            </span>
            {alert.triage.slaBreached && (
              <span>
                <SlaBreachBadge target={formatDuration(alert.triage.slaAckMinutes)} />
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
}

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPage,
}: PaginationProps): React.JSX.Element {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className={styles.footer}>
      <span>
        {total === 0 ? 'No alerts' : `Showing ${first}–${last} of ${total}`}
      </span>
      {totalPages > 1 && (
        <div className={styles.pager}>
          <button
            type="button"
            className="btn"
            disabled={page <= 1}
            onClick={() => {
              onPage(page - 1);
            }}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn"
            disabled={page >= totalPages}
            onClick={() => {
              onPage(page + 1);
            }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
