import type { AlertSummary } from '@incident-board/shared';
import { formatDuration, formatRelativeTime } from '../lib/format';
import { PriorityBadge, SeverityBadge, SlaBreachBadge } from './Badges';
import styles from './AttentionQueue.module.css';

/**
 * The act-now queue.
 *
 * It is fetched independently of the board's filters on purpose. The whole point of this panel
 * is to answer "what am I ignoring?", and a panel that quietly narrows itself to match the
 * filter someone set twenty minutes ago cannot answer that.
 *
 * Membership is a deliberate product rule: unstarted, and either P1/P2 or past its
 * acknowledgement SLA — with P4 excluded even when breached. A month-old curtailment notice
 * technically breaches its target, and letting it in here is exactly how a "needs attention"
 * list becomes something operators learn to scroll past.
 */

interface AttentionQueueProps {
  alerts: AlertSummary[];
  total: number;
  loading: boolean;
  onSelect: (id: string) => void;
  onViewAll: () => void;
  now: Date;
}

export function AttentionQueue({
  alerts,
  total,
  loading,
  onSelect,
  onViewAll,
  now,
}: AttentionQueueProps): React.JSX.Element | null {
  if (loading) return null;

  if (alerts.length === 0) {
    return (
      <div className={styles.panel} style={{ borderLeftColor: 'var(--success)' }}>
        <div className={styles.clear}>
          <span aria-hidden="true">✓</span>
          <span>Nothing needs immediate attention. Everything urgent is being worked.</span>
        </div>
      </div>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="attention-heading">
      <div className={styles.head}>
        <h2 className={styles.title} id="attention-heading">
          Needs attention
        </h2>
        <span className={styles.subtitle}>
          Urgent or overdue, and nobody has started work
        </span>
        {total > alerts.length && (
          <button type="button" className={styles.viewAll} onClick={onViewAll}>
            View all {total}
          </button>
        )}
      </div>

      <ul className={styles.list}>
        {alerts.map((alert, index) => (
          <li key={alert.id}>
            <button
              type="button"
              className={styles.item}
              onClick={() => {
                onSelect(alert.id);
              }}
            >
              <span className={styles.rank}>{index + 1}</span>
              <span className={styles.main}>
                <span className={styles.itemTitle} title={alert.title}>
                  {alert.title}
                </span>
                <span className={styles.meta}>
                  <span>{alert.site.name}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatRelativeTime(alert.detectedAt, now)}</span>
                  {alert.assetId !== null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="mono truncate">{alert.assetId}</span>
                    </>
                  )}
                </span>
              </span>
              <span className={styles.badges}>
                {alert.triage.slaBreached && (
                  <SlaBreachBadge target={formatDuration(alert.triage.slaAckMinutes)} />
                )}
                <SeverityBadge severity={alert.severity} />
                <PriorityBadge
                  priority={alert.triage.priority}
                  title={alert.triage.reasons.join('; ')}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
