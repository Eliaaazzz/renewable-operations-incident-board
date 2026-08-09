import { describe, expect, it } from 'vitest';
import {
  countActiveFilters,
  DEFAULT_FILTERS,
  parseUrlState,
  serialiseUrlState,
  toggleFilterValue,
} from './filters';

/**
 * The URL is the board's shareable state. These tests pin down that a link survives a round
 * trip, that a stale bookmark degrades gracefully instead of producing a 400, and that
 * narrowing the filters never strands the operator on a page that no longer exists.
 */

describe('parseUrlState', () => {
  it('round-trips a full board state', () => {
    const state = {
      filters: {
        ...DEFAULT_FILTERS,
        status: ['new' as const, 'acknowledged' as const],
        severity: ['critical' as const],
        siteId: ['site-kestrel'],
        q: 'inverter',
        needsAttention: true,
        sort: 'detectedAt' as const,
        order: 'asc' as const,
        page: 3,
      },
      selectedAlertId: 'ALT-1042',
    };

    expect(parseUrlState(serialiseUrlState(state))).toEqual(state);
  });

  it('omits defaults so a plain board has a clean URL', () => {
    expect(serialiseUrlState({ filters: DEFAULT_FILTERS, selectedAlertId: null })).toBe('');
  });

  it('drops values the application no longer understands', () => {
    // A bookmark from an older version should show a slightly wider board, not fail the
    // request with a 400 the operator cannot act on.
    const state = parseUrlState('?status=new,teleported&severity=chartreuse');
    expect(state.filters.status).toEqual(['new']);
    expect(state.filters.severity).toEqual([]);
  });

  it.each([
    ['?page=0', 1],
    ['?page=-4', 1],
    ['?page=abc', 1],
    ['?page=7', 7],
  ])('normalises %s to page %s', (search, expected) => {
    expect(parseUrlState(search).filters.page).toBe(expected);
  });

  it('caps an oversized page size the same way the API does', () => {
    expect(parseUrlState('?pageSize=5000').filters.pageSize).toBe(100);
  });

  it('reads a deep link to a single alert', () => {
    expect(parseUrlState('?alert=ALT-1039').selectedAlertId).toBe('ALT-1039');
  });
});

describe('toggleFilterValue', () => {
  it('adds and removes a value', () => {
    const added = toggleFilterValue(DEFAULT_FILTERS, 'severity', 'critical');
    expect(added.severity).toEqual(['critical']);
    expect(toggleFilterValue(added, 'severity', 'critical').severity).toEqual([]);
  });

  it('returns to the first page whenever the filters narrow', () => {
    // Staying on page 4 after filtering down to six results shows an empty screen, which reads
    // as a bug rather than as a filter.
    const onPageFour = { ...DEFAULT_FILTERS, page: 4 };
    expect(toggleFilterValue(onPageFour, 'status', 'new').page).toBe(1);
  });
});

describe('countActiveFilters', () => {
  it('counts every dimension including search and the attention toggle', () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(
      countActiveFilters({
        ...DEFAULT_FILTERS,
        status: ['new', 'acknowledged'],
        q: '  inverter  ',
        needsAttention: true,
      }),
    ).toBe(4);
  });

  it('ignores a search box containing only whitespace', () => {
    expect(countActiveFilters({ ...DEFAULT_FILTERS, q: '   ' })).toBe(0);
  });
});
