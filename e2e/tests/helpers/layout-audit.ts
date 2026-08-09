import type { Page } from '@playwright/test';

/**
 * Layout auditing that measures where text is actually painted.
 *
 * Two properties are checked, and both are deliberately about *text rectangles* rather than
 * element boxes:
 *
 *  - **Escape**: every run of text must stay inside the nearest ancestor that would clip it.
 *    Where nothing clips, the bound is the viewport. A `.truncate` element legitimately has
 *    `scrollWidth > clientWidth`; what would be a bug is the text being painted outside the box
 *    that is supposed to hide it. Measuring the range, not the element, is what tells those two
 *    situations apart.
 *
 *  - **Collision**: no two runs of text may share pixels. This is the literal reading of "no
 *    overlap between containers of text", and measuring it directly beats inspecting
 *    screenshots by hand at five widths.
 */

export interface LayoutViolation {
  kind: 'escape' | 'collision';
  detail: string;
}

const AUDIT_SCRIPT = (rootSelector: string): LayoutViolation[] => {
  const root =
    rootSelector === 'body'
      ? document.body
      : (document.querySelector(rootSelector) as HTMLElement | null);
  if (root === null) return [{ kind: 'escape', detail: `root "${rootSelector}" not found` }];

  const violations: LayoutViolation[] = [];

  const CLIPPING = new Set(['hidden', 'clip', 'auto', 'scroll']);

  const clips = (element: Element): boolean => {
    const style = getComputedStyle(element);
    return CLIPPING.has(style.overflowX) || CLIPPING.has(style.overflowY);
  };

  const isHiddenForLayout = (element: Element): boolean => {
    let current: Element | null = element;
    while (current !== null && current !== document.documentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return true;
      }
      // Screen-reader-only text is clipped to a 1px box; it has coordinates but is never
      // painted, so including it would produce collisions that do not exist visually.
      if (style.clipPath !== 'none' && style.position === 'absolute') return true;
      if (current.classList.contains('visually-hidden')) return true;
      current = current.parentElement;
    }
    return false;
  };

  const describe = (node: Text): string => {
    const parent = node.parentElement;
    if (parent === null) return '(detached text)';
    const classes =
      typeof parent.className === 'string' && parent.className.length > 0
        ? `.${parent.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
    const text = (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 48);
    return `<${parent.tagName.toLowerCase()}${classes}> "${text}"`;
  };

  interface Measured {
    node: Text;
    rect: DOMRectLike;
  }

  interface DOMRectLike {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  }

  const toRect = (rect: DOMRect): DOMRectLike => ({
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  });

  const intersect = (a: DOMRectLike, b: DOMRectLike): DOMRectLike | null => {
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    const width = right - left;
    const height = bottom - top;
    if (width <= 1 || height <= 1) return null;
    return { left, right, top, bottom, width, height };
  };

  const rootBound =
    rootSelector === 'body'
      ? {
          left: 0,
          top: 0,
          right: document.documentElement.clientWidth,
          bottom: document.documentElement.clientHeight,
          width: document.documentElement.clientWidth,
          height: document.documentElement.clientHeight,
        }
      : toRect(root.getBoundingClientRect());

  const measured: Measured[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    if ((text.textContent ?? '').trim().length === 0) continue;

    const parent = text.parentElement;
    if (parent === null || isHiddenForLayout(parent)) continue;

    const range = document.createRange();
    range.selectNodeContents(text);
    const rawRect = toRect(range.getBoundingClientRect());
    if (rawRect.width <= 1 || rawRect.height <= 1) continue;

    let visibleRect: DOMRectLike | null = intersect(rawRect, rootBound);
    if (visibleRect === null) continue;

    let clipper: Element | null = parent;
    let hasHorizontalClip = false;
    while (clipper !== null && clipper !== root.parentElement) {
      if (clips(clipper)) {
        hasHorizontalClip = true;
        visibleRect = intersect(visibleRect, toRect(clipper.getBoundingClientRect()));
        if (visibleRect === null) break;
      }
      if (clipper === root) break;
      clipper = clipper.parentElement;
    }
    if (visibleRect === null) continue;

    measured.push({ node: text, rect: visibleRect });

    const TOLERANCE = 2;
    if (
      !hasHorizontalClip &&
      (rawRect.right > rootBound.right + TOLERANCE || rawRect.left < rootBound.left - TOLERANCE)
    ) {
      violations.push({
        kind: 'escape',
        detail: `${describe(text)} paints from ${Math.round(rawRect.left)}→${Math.round(
          rawRect.right,
        )} but its clipping box is ${Math.round(rootBound.left)}→${Math.round(rootBound.right)}`,
      });
    }
  }

  // --- collision check ------------------------------------------------------
  const MIN_OVERLAP_AREA = 6;
  for (let i = 0; i < measured.length; i += 1) {
    for (let j = i + 1; j < measured.length; j += 1) {
      const a = measured[i]!;
      const b = measured[j]!;

      // Text nodes are leaves, so a containment relationship between their rects means one
      // parent wraps the other — legitimate nesting rather than a collision.
      if (a.node.parentElement?.contains(b.node.parentElement) === true) continue;
      if (b.node.parentElement?.contains(a.node.parentElement) === true) continue;

      const overlapWidth = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const overlapHeight =
        Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);

      if (overlapWidth > 0 && overlapHeight > 0 && overlapWidth * overlapHeight > MIN_OVERLAP_AREA) {
        violations.push({
          kind: 'collision',
          detail: `${describe(a.node)} overlaps ${describe(b.node)} by ${Math.round(
            overlapWidth,
          )}×${Math.round(overlapHeight)}px`,
        });
      }
    }
  }

  return violations;
};

export async function auditLayout(page: Page, rootSelector = 'body'): Promise<LayoutViolation[]> {
  return page.evaluate(AUDIT_SCRIPT, rootSelector);
}

/** True when the page itself scrolls sideways — a dashboard should never do this. */
export async function hasHorizontalPageScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}
