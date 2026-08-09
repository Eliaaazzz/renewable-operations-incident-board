import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal keyboard behaviour: focus moves into the panel on open, Tab cycles inside it, Escape
 * closes, and focus returns to whatever opened it.
 *
 * The last part is the one that is usually missed. Without it a keyboard user who closes the
 * drawer is dumped back at the top of the document and has to tab through the entire board to
 * get back to the row they were reading.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!active) return;

    const container = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      container === null ? [] : [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];

    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || container === null) return;

      const items = focusables();
      const first = items[0];
      const last = items.at(-1);
      if (first === undefined || last === undefined) return;

      // Wrap in both directions rather than letting focus escape to the page behind.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [ref, active, onClose]);
}
