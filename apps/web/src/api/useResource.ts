import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | null;
  error: Error | null;
  /** True only on the first load. Refreshes keep the previous data on screen. */
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
}

export interface ResourceOptions {
  enabled?: boolean;
  /** Poll interval. An operations board that silently goes stale is worse than no board. */
  pollMs?: number;
}

/**
 * A small data-fetching hook. No query library: the application has five endpoints and one
 * caching rule, and the rule is unusual enough that it would need configuring around anyway.
 *
 * The behaviour that matters is that a refresh keeps the previous data visible. Blanking the
 * table every thirty seconds to show a spinner would make the board unusable exactly when
 * someone is reading it.
 */
export function useResource<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: ResourceOptions = {},
): Resource<T> {
  const { enabled = true, pollMs } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Held in a ref so changing the loader identity every render does not restart the request.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const hasData = data !== null;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    if (hasData) setRefreshing(true);

    void (async () => {
      try {
        const result = await loaderRef.current(controller.signal);
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (caught) {
        if (cancelled || controller.signal.aborted) return;
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce, ...deps]);

  useEffect(() => {
    if (pollMs === undefined || !enabled) return;
    const timer = window.setInterval(() => {
      // Polling pauses in a hidden tab: nobody is reading it, and a laptop lid should not mean
      // a request every thirty seconds all night.
      if (document.visibilityState === 'visible') setNonce((value) => value + 1);
    }, pollMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [pollMs, enabled]);

  const refresh = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { data, error, loading, refreshing, refresh };
}
