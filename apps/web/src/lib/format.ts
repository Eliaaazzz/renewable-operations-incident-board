/**
 * Time formatting.
 *
 * Two representations are shown together throughout the UI: a relative age ("3h ago"), which is
 * what an operator actually reasons about, and an absolute site-local timestamp, which is what
 * goes in a handover note. Timestamps arrive as UTC and are converted at render time only, so
 * there is exactly one place where a timezone exists.
 */

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';

  const diffMs = now.getTime() - then;
  // Clock skew between a site controller and the server should read as "just now", not as a
  // timestamp in the future.
  if (diffMs < 0) return 'just now';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h ago` : `${hours}h ${remainder}m ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours === 0 ? `${days}d` : `${days}d ${remainingHours}h`;
}

/** Absolute time in the site's own timezone, which is where the equipment actually is. */
export function formatSiteTime(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(date);
  } catch {
    // An unrecognised IANA zone should degrade to UTC, not blank the cell.
    return `${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date)} UTC`;
  }
}

export function formatCapacity(capacityMw: number, energyMwh: number | null): string {
  const power = `${capacityMw} MW`;
  return energyMwh === null ? power : `${power} / ${energyMwh} MWh`;
}

/** Converts a snake_case metric key into something readable, without guessing units. */
export function humaniseKey(key: string): string {
  const words = key.split('_').filter((part) => part.length > 0);
  const joined = words.join(' ');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

export function formatMetricValue(value: string | number | boolean | null): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  }
  return value;
}
