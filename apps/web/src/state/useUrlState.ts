import { useCallback, useEffect, useState } from 'react';
import { parseUrlState, serialiseUrlState, type BoardUrlState } from './filters';

/**
 * Keeps board state and the address bar in step, in both directions: changing a filter pushes
 * a history entry, and Back/Forward restores the previous board. Filter changes `push` so they
 * are undoable; opening and closing the drawer `replace`s, because a browser Back that only
 * closes a panel is a nuisance rather than a feature.
 */
export function useUrlState(): [BoardUrlState, (next: BoardUrlState, mode?: 'push' | 'replace') => void] {
  const [state, setState] = useState<BoardUrlState>(() => parseUrlState(window.location.search));

  useEffect(() => {
    const onPopState = (): void => {
      setState(parseUrlState(window.location.search));
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const update = useCallback((next: BoardUrlState, mode: 'push' | 'replace' = 'push') => {
    const url = `${window.location.pathname}${serialiseUrlState(next)}`;
    if (mode === 'push') {
      window.history.pushState(null, '', url);
    } else {
      window.history.replaceState(null, '', url);
    }
    setState(next);
  }, []);

  return [state, update];
}
