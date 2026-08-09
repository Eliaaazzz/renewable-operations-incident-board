import type { Metrics, MetricValue } from '@incident-board/shared';

/**
 * Telemetry keys arrive as snake_case with a unit suffix (`cell_temp_c`, `active_power_kw`).
 * Rendering them raw makes a summary read like a log line; expanding them makes it read like a
 * sentence an engineer would write. The mapping is deliberately small and explicit — guessing
 * units from arbitrary suffixes would eventually attach "°C" to something that is not a
 * temperature, and a confidently wrong unit is worse than no unit at all.
 */
const UNIT_SUFFIXES: readonly (readonly [suffix: string, unit: string])[] = [
  ['_wm2', ' W/m²'],
  ['_kwh', ' kWh'],
  ['_mwh', ' MWh'],
  ['_kva', ' kVA'],
  ['_pct', '%'],
  ['_deg', '°'],
  ['_kw', ' kW'],
  ['_mw', ' MW'],
  ['_hz', ' Hz'],
  ['_kv', ' kV'],
  ['_ms', ' ms'],
  ['_c', ' °C'],
  ['_v', ' V'],
  ['_a', ' A'],
  ['_h', ' h'],
];

const ABBREVIATIONS: Record<string, string> = {
  soc: 'state of charge',
  soh: 'state of health',
  dc: 'DC',
  ac: 'AC',
  hvac: 'HVAC',
  bms: 'BMS',
  temp: 'temperature',
  min: 'minimum',
  max: 'maximum',
  avg: 'average',
  id: 'ID',
};

interface FormattedMetric {
  label: string;
  value: string;
}

export function formatMetric(key: string, value: MetricValue): FormattedMetric {
  let stem = key;
  let unit = '';

  for (const [suffix, suffixUnit] of UNIT_SUFFIXES) {
    if (stem.length > suffix.length && stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length);
      unit = suffixUnit;
      break;
    }
  }

  const label = stem
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => ABBREVIATIONS[part] ?? part)
    .join(' ');

  // Units only make sense on numbers. A string value like `rack: "R04"` keeps its own text.
  const rendered =
    value === null
      ? 'not reported'
      : typeof value === 'number'
        ? `${trimNumber(value)}${unit}`
        : String(value);

  return { label: label.charAt(0).toUpperCase() + label.slice(1), value: rendered };
}

function trimNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

/** Renders up to `limit` metrics as a single readable clause. */
export function formatMetricsSentence(metrics: Metrics, limit = 4): string {
  const entries = Object.entries(metrics).slice(0, limit);
  if (entries.length === 0) return '';
  return entries
    .map(([key, value]) => {
      const { label, value: rendered } = formatMetric(key, value);
      return `${label.toLowerCase()} ${rendered}`;
    })
    .join(', ');
}
