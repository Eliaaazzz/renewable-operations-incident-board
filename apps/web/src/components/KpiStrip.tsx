import type { StatsResponse } from '@incident-board/shared';
import { formatDuration } from '../lib/format';
import styles from './KpiStrip.module.css';

/**
 * The answer to "what is the state of the portfolio right now", above everything else.
 *
 * The two tiles that represent work — needs attention, and open criticals — are buttons that
 * apply the matching filter. A number on a dashboard that you cannot click through to the rows
 * behind it just makes the reader go and rebuild the filter by hand.
 */

interface KpiStripProps {
  stats: StatsResponse | null;
  attentionActive: boolean;
  criticalActive: boolean;
  onToggleAttention: () => void;
  onToggleCritical: () => void;
}

interface TileProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'urgent' | 'warn' | 'calm' | 'neutral';
  onClick?: () => void;
  pressed?: boolean;
}

function Tile({ label, value, hint, tone, onClick, pressed }: TileProps): React.JSX.Element {
  const className = `${styles.tile} ${tone === undefined ? '' : styles[tone]}`;
  const content = (
    <>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {hint !== undefined && <span className={styles.hint}>{hint}</span>}
    </>
  );

  if (onClick === undefined) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button type="button" className={className} onClick={onClick} aria-pressed={pressed ?? false}>
      {content}
    </button>
  );
}

export function KpiStrip({
  stats,
  attentionActive,
  criticalActive,
  onToggleAttention,
  onToggleCritical,
}: KpiStripProps): React.JSX.Element {
  if (stats === null) {
    return (
      <div className={styles.strip} aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className={styles.tile}>
            <span className={styles.label}>&nbsp;</span>
            <span className={styles.value}>—</span>
          </div>
        ))}
      </div>
    );
  }

  const criticalOpen = stats.openBySeverity.critical;

  return (
    <div className={styles.strip}>
      <Tile
        label="Needs attention"
        value={stats.totals.needsAttention}
        hint={stats.totals.needsAttention === 0 ? 'Nothing waiting on you' : 'Urgent and unstarted'}
        tone={stats.totals.needsAttention > 0 ? 'urgent' : 'calm'}
        onClick={onToggleAttention}
        pressed={attentionActive}
      />
      <Tile
        label="Open critical"
        value={criticalOpen}
        hint="Severity critical, not closed"
        tone={criticalOpen > 0 ? 'urgent' : 'calm'}
        onClick={onToggleCritical}
        pressed={criticalActive}
      />
      <Tile
        label="SLA breached"
        value={stats.totals.slaBreached}
        hint="Past the acknowledgement target"
        tone={stats.totals.slaBreached > 0 ? 'warn' : 'calm'}
      />
      <Tile label="Open total" value={stats.totals.open} hint={`${stats.totals.all} on the board`} tone="neutral" />
      <Tile
        label="Mean time to ack"
        value={
          stats.meanTimeToAcknowledgeMinutes === null
            ? '—'
            : formatDuration(Math.round(stats.meanTimeToAcknowledgeMinutes))
        }
        // "No acknowledgements yet" and "acknowledged instantly" are very different states and
        // must not both render as zero.
        hint={
          stats.meanTimeToAcknowledgeMinutes === null
            ? 'Nothing acknowledged yet'
            : `${stats.totals.resolvedLast24h} resolved in 24h`
        }
        tone="neutral"
      />
    </div>
  );
}
