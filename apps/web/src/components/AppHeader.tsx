import type { HealthResponse } from '@incident-board/shared';
import styles from './AppHeader.module.css';

/**
 * The header exists mostly to answer one question honestly: is the AI assistant actually
 * available right now? A tool that silently swaps a language model for a template engine and
 * says nothing is a tool that will eventually be trusted for something it did not do.
 */

interface AppHeaderProps {
  health: HealthResponse | null;
  refreshing: boolean;
  operator: string;
  theme: 'light' | 'dark' | 'system';
  onOperatorChange: (name: string) => void;
  onThemeToggle: () => void;
}

export function AppHeader({
  health,
  refreshing,
  operator,
  theme,
  onOperatorChange,
  onThemeToggle,
}: AppHeaderProps): React.JSX.Element {
  const aiReachable = health?.ai.reachable ?? false;
  const aiLabel =
    health === null
      ? 'Checking assistant…'
      : aiReachable
        ? `AI ready · ${health.ai.model}`
        : 'AI unavailable — rules engine';

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <span className={styles.mark}>Incident Board</span>
        <span className={styles.tagline}>Renewable operations</span>
      </div>

      <div className={styles.spacer} />

      <div className={styles.cluster}>
        {refreshing && <span className={styles.refreshing}>Refreshing…</span>}

        <span
          className={styles.status}
          // The full reason — "not installed", "not running", which model — lives in the
          // tooltip so the header stays one line but the detail is one hover away.
          title={health?.ai.detail ?? (aiReachable ? 'Local model reachable' : undefined)}
        >
          <span
            className={`${styles.dot} ${aiReachable ? styles.dotOk : styles.dotOff}`}
            aria-hidden="true"
          />
          <span className={styles.statusText}>{aiLabel}</span>
        </span>

        <label className={styles.operator}>
          <span className="visually-hidden">Your name, recorded against changes you make</span>
          <input
            className={styles.operatorInput}
            value={operator === 'operator' ? '' : operator}
            placeholder="Your name"
            onChange={(event) => {
              onOperatorChange(event.target.value);
            }}
          />
        </label>

        <button
          type="button"
          className={styles.iconButton}
          onClick={onThemeToggle}
          aria-label={`Switch colour theme (currently ${theme})`}
          title={`Theme: ${theme}`}
        >
          <span aria-hidden="true">{theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}</span>
        </button>
      </div>
    </header>
  );
}
