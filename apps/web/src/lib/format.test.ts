import { describe, expect, it } from 'vitest';
import { formatDuration, formatRelativeTime, formatSiteTime, humaniseKey } from './format';

const NOW = new Date('2026-08-09T12:00:00.000Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

describe('formatRelativeTime', () => {
  it.each([
    [0, 'just now'],
    [1, '1m ago'],
    [59, '59m ago'],
    [60, '1h ago'],
    [95, '1h 35m ago'],
    [60 * 24, '1d ago'],
    [60 * 24 * 45, '1mo ago'],
  ])('renders %s minutes ago as "%s"', (minutes, expected) => {
    expect(formatRelativeTime(minutesAgo(minutes), NOW)).toBe(expected);
  });

  it('shows a future timestamp as "just now" rather than a negative age', () => {
    // Site controllers drift. A clock a few minutes ahead of the server should not render as
    // "-3m ago", which reads as a bug in the board rather than in the clock.
    expect(formatRelativeTime(minutesAgo(-5), NOW)).toBe('just now');
  });

  it('degrades gracefully on an unparseable value', () => {
    expect(formatRelativeTime('not a date', NOW)).toBe('unknown');
  });
});

describe('formatDuration', () => {
  it.each([
    [15, '15m'],
    [60, '1h'],
    [90, '1h 30m'],
    [1440, '1d'],
    [4320, '3d'],
  ])('formats %s minutes as "%s"', (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });
});

describe('formatSiteTime', () => {
  it('renders in the site timezone, not the viewer’s', () => {
    // 12:00 UTC is 22:00 in Sydney: an operator reading a handover note needs the time the
    // equipment saw, not the time their own laptop saw.
    expect(formatSiteTime('2026-08-09T12:00:00.000Z', 'Australia/Sydney')).toContain('22:00');
    expect(formatSiteTime('2026-08-09T12:00:00.000Z', 'Europe/London')).toContain('13:00');
  });

  it('falls back to UTC for an unknown zone instead of blanking the field', () => {
    expect(formatSiteTime('2026-08-09T12:00:00.000Z', 'Mars/Olympus')).toContain('UTC');
  });
});

describe('humaniseKey', () => {
  it.each([
    ['cell_temp_c', 'Cell temp c'],
    ['ups_runtime_min', 'Ups runtime min'],
    ['rack', 'Rack'],
  ])('renders %s as "%s"', (key, expected) => {
    expect(humaniseKey(key)).toBe(expected);
  });
});
