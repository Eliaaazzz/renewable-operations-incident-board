import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

const THEME_KEY = 'incident-board-theme';
const OPERATOR_KEY = 'incident-board-operator';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private browsing or a blocked storage partition — fall back to defaults rather than
    // taking the whole board down over a preference.
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* preferences are best-effort */
  }
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = readStorage(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  });

  useEffect(() => {
    if (theme === 'system') {
      delete document.documentElement.dataset['theme'];
      writeStorage(THEME_KEY, null);
    } else {
      document.documentElement.dataset['theme'] = theme;
      writeStorage(THEME_KEY, theme);
    }
  }, [theme]);

  return [theme, setTheme];
}

/**
 * Who is using the console. A shared operations terminal has no login, but an audit trail that
 * attributes every change to "operator" is not much of an audit trail — so the name is asked
 * for once and remembered.
 */
export function useOperator(): [string, (name: string) => void] {
  const [operator, setOperatorState] = useState<string>(
    () => readStorage(OPERATOR_KEY) ?? 'operator',
  );

  const setOperator = useCallback((name: string) => {
    const trimmed = name.trim();
    const value = trimmed.length === 0 ? 'operator' : trimmed.slice(0, 120);
    setOperatorState(value);
    writeStorage(OPERATOR_KEY, value);
  }, []);

  return [operator, setOperator];
}

/** A clock that ticks, so "3h ago" does not sit there saying "2h ago" for the whole shift. */
export function useTickingClock(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
