import {
  PRIORITY_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  type AlertStatus,
  type Priority,
  type Severity,
} from '@incident-board/shared';
import styles from './Badges.module.css';

/**
 * Status indicators.
 *
 * Each badge carries a glyph, a word and a colour. Colour alone would fail for the ~4% of men
 * with a red/green deficiency, and on the projector in a site office it fails for everyone.
 * The glyph is `aria-hidden` because the word beside it already says the same thing.
 */

const SEVERITY_GLYPH: Record<Severity, string> = {
  critical: '▲',
  high: '◆',
  medium: '●',
  low: '○',
};

const STATUS_GLYPH: Record<AlertStatus, string> = {
  new: '✳',
  acknowledged: '◔',
  in_progress: '◑',
  resolved: '✓',
  dismissed: '⊘',
};

export function SeverityBadge({ severity }: { severity: Severity }): React.JSX.Element {
  return (
    <span className={`${styles.badge} ${styles[severity]}`}>
      <span className={styles.glyph} aria-hidden="true">
        {SEVERITY_GLYPH[severity]}
      </span>
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function StatusBadge({ status }: { status: AlertStatus }): React.JSX.Element {
  return (
    <span className={`${styles.badge} ${styles[status]}`}>
      <span className={styles.glyph} aria-hidden="true">
        {STATUS_GLYPH[status]}
      </span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityBadge({
  priority,
  title,
}: {
  priority: Priority;
  title?: string;
}): React.JSX.Element {
  return (
    <span
      className={`${styles.priority} ${styles[priority]}`}
      title={title ?? PRIORITY_LABEL[priority]}
    >
      {priority}
      <span className="visually-hidden"> — {PRIORITY_LABEL[priority]}</span>
    </span>
  );
}

export function SlaBreachBadge({ target }: { target: string }): React.JSX.Element {
  return (
    <span className={styles.breach} title={`Should have been acknowledged within ${target}`}>
      <span aria-hidden="true">⏱</span> SLA breached
    </span>
  );
}

export function AttentionBadge(): React.JSX.Element {
  return <span className={styles.attention}>Needs attention</span>;
}
