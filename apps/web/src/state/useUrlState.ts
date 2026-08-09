import { useCallback, useEffect, useRef, useState } from 'react';
import { parseUrlState, serialiseUrlState, type BoardUrlState } from './filters';

/**
 * Keeps board state and the address bar in step, in both directions: changing a filter pushes
 * a history entry, and Back/Forward restores the previous board. Filter changes `push` so they
 * are undoable; opening and closing the drawer `replace`s, because a browser Back that only
 * closes a panel is a nuisance rather than a feature.
 */
type UrlStateUpdate = BoardUrlState | ((current: BoardUrlState) => BoardUrlState);

export function useUrlState(): [BoardUrlState, (next: UrlStateUpdate, mode?: 'push' | 'replace') => void] {
  const [state, setState] = useState<BoardUrlState>(() => parseUrlState(window.location.search));
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const onPopState = (): void => {
      const next = parseUrlState(window.location.search);
      stateRef.current = next;
      setState(next);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const update = useCallback((next: UrlStateUpdate, mode: 'push' | 'replace' = 'push') => {
    const resolved = typeof next === 'function' ? next(stateRef.current) : next;
    stateRef.current = resolved;
    const url = `${window.location.pathname}${serialiseUrlState(resolved)}`;
    if (mode === 'push') {
      window.history.pushState(null, '', url);
    } else {
      window.history.replaceState(null, '', url);
    }
    setState(resolved);
  }, []);

  return [state, update];
}
