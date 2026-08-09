import { useEffect, useState } from 'react';

/**
 * Drives the table/card switch from a media query rather than rendering both and hiding one.
 * Two copies of every row in the DOM would double the work for a screen reader and give the
 * accessibility audit duplicate content to complain about.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => {
      list.removeEventListener('change', onChange);
    };
  }, [query]);

  return matches;
}
