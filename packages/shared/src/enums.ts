import { z } from 'zod';

/**
 * Domain vocabulary for the incident board.
 *
 * Every enum is declared once here as a `const` tuple, turned into a Zod schema, and the
 * TypeScript type is derived with `z.infer`. That ordering matters: the runtime validator is
 * the source of truth and the static type follows it, so a value that type-checks is by
 * construction a value that also passes validation at the HTTP and database boundaries.
 */

/* ------------------------------------------------------------------ severity */

export const SEVERITY_VALUES = ['critical', 'high', 'medium', 'low'] as const;
export const SeveritySchema = z.enum(SEVERITY_VALUES);
export type Severity = z.infer<typeof SeveritySchema>;

/** Base contribution of each severity to the triage score. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 100,
  high: 60,
  medium: 30,
  low: 10,
};

/** Sort ordering only — higher means "show me first" when sorting by severity. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/* -------------------------------------------------------------------- status */

export const STATUS_VALUES = [
  'new',
  'acknowledged',
  'in_progress',
  'resolved',
  'dismissed',
] as const;
export const StatusSchema = z.enum(STATUS_VALUES);
export type AlertStatus = z.infer<typeof StatusSchema>;

export const STATUS_LABEL: Record<AlertStatus, string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  in_progress: 'In progress',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

/** Statuses that still represent live work. */
export const OPEN_STATUSES = ['new', 'acknowledged', 'in_progress'] as const satisfies readonly AlertStatus[];

/** Statuses that represent a closed incident. */
export const CLOSED_STATUSES = ['resolved', 'dismissed'] as const satisfies readonly AlertStatus[];

export function isOpenStatus(status: AlertStatus): boolean {
  return (OPEN_STATUSES as readonly AlertStatus[]).includes(status);
}

export function isClosedStatus(status: AlertStatus): boolean {
  return (CLOSED_STATUSES as readonly AlertStatus[]).includes(status);
}

/**
 * How much of the raw score survives in each status. An incident someone is already working
 * is genuinely less urgent than an identical one nobody has looked at.
 */
export const STATUS_URGENCY_FACTOR: Record<AlertStatus, number> = {
  new: 1,
  acknowledged: 0.85,
  in_progress: 0.6,
  resolved: 0,
  dismissed: 0,
};

/** Sort ordering only. */
export const STATUS_RANK: Record<AlertStatus, number> = {
  new: 1,
  acknowledged: 2,
  in_progress: 3,
  resolved: 4,
  dismissed: 5,
};

/* ------------------------------------------------------------------ priority */

export const PRIORITY_VALUES = ['P1', 'P2', 'P3', 'P4'] as const;
export const PrioritySchema = z.enum(PRIORITY_VALUES);
export type Priority = z.infer<typeof PrioritySchema>;

/** Lower bound of each band, evaluated highest-first. */
export const PRIORITY_BANDS: readonly { priority: Priority; minScore: number }[] = [
  { priority: 'P1', minScore: 120 },
  { priority: 'P2', minScore: 70 },
  { priority: 'P3', minScore: 35 },
  { priority: 'P4', minScore: Number.NEGATIVE_INFINITY },
];

/** Target time-to-acknowledge, in minutes, per priority band. */
export const SLA_ACK_MINUTES: Record<Priority, number> = {
  P1: 15,
  P2: 60,
  P3: 8 * 60,
  P4: 72 * 60,
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  P1: 'P1 — Immediate',
  P2: 'P2 — Same shift',
  P3: 'P3 — Same day',
  P4: 'P4 — Backlog',
};

/** Distance between two bands, used to detect model/rule disagreement. */
export function priorityDistance(a: Priority, b: Priority): number {
  return Math.abs(PRIORITY_VALUES.indexOf(a) - PRIORITY_VALUES.indexOf(b));
}

/* ----------------------------------------------------------------- site kind */

export const SITE_KIND_VALUES = ['solar', 'battery', 'hybrid'] as const;
export const SiteKindSchema = z.enum(SITE_KIND_VALUES);
export type SiteKind = z.infer<typeof SiteKindSchema>;

export const SITE_KIND_LABEL: Record<SiteKind, string> = {
  solar: 'Solar PV',
  battery: 'Battery storage',
  hybrid: 'Solar + storage',
};

/* ------------------------------------------------------------ alert category */

export const ALERT_CATEGORY_VALUES = ['safety', 'production', 'data_quality', 'informational'] as const;
export const AlertCategorySchema = z.enum(ALERT_CATEGORY_VALUES);
export type AlertCategory = z.infer<typeof AlertCategorySchema>;

/**
 * Category multiplier. A safety-related fault outranks a production loss of the same
 * severity, and a stale sensor reading outranks neither.
 */
export const CATEGORY_MULTIPLIER: Record<AlertCategory, number> = {
  safety: 1.5,
  production: 1.2,
  data_quality: 0.8,
  informational: 0.6,
};

export const ALERT_CATEGORY_LABEL: Record<AlertCategory, string> = {
  safety: 'Safety',
  production: 'Production',
  data_quality: 'Data quality',
  informational: 'Informational',
};

/* --------------------------------------------------------------- alert types */

export const ALERT_TYPE_VALUES = [
  'thermal_runaway_risk',
  'battery_cell_temp_high',
  'dc_arc_fault',
  'ground_fault',
  'hvac_failure',
  'transformer_temp_high',
  'tracker_stow_failure',
  'bms_fault',
  'inverter_fault',
  'inverter_offline',
  'ac_breaker_trip',
  'grid_voltage_excursion',
  'string_underperformance',
  'soiling_loss',
  'soc_deviation',
  'aux_power_loss',
  'comms_loss',
  'irradiance_sensor_fault',
  'meter_data_gap',
  'curtailment',
] as const;
export const AlertTypeSchema = z.enum(ALERT_TYPE_VALUES);
export type AlertType = z.infer<typeof AlertTypeSchema>;

/**
 * Static metadata per alert type. Declaring it as `Record<AlertType, …>` makes the compiler
 * reject a new member of `ALERT_TYPE_VALUES` that forgets to add metadata here.
 */
export const ALERT_TYPE_META: Record<AlertType, { label: string; category: AlertCategory }> = {
  thermal_runaway_risk: { label: 'Thermal runaway risk', category: 'safety' },
  battery_cell_temp_high: { label: 'Battery cell temperature high', category: 'safety' },
  dc_arc_fault: { label: 'DC arc fault', category: 'safety' },
  ground_fault: { label: 'Ground fault', category: 'safety' },
  hvac_failure: { label: 'Enclosure HVAC failure', category: 'safety' },
  transformer_temp_high: { label: 'Transformer temperature high', category: 'safety' },
  tracker_stow_failure: { label: 'Tracker stow failure', category: 'safety' },
  bms_fault: { label: 'Battery management system fault', category: 'production' },
  inverter_fault: { label: 'Inverter fault', category: 'production' },
  inverter_offline: { label: 'Inverter offline', category: 'production' },
  ac_breaker_trip: { label: 'AC breaker trip', category: 'production' },
  grid_voltage_excursion: { label: 'Grid voltage excursion', category: 'production' },
  string_underperformance: { label: 'String underperformance', category: 'production' },
  soiling_loss: { label: 'Soiling loss', category: 'production' },
  soc_deviation: { label: 'State-of-charge deviation', category: 'production' },
  aux_power_loss: { label: 'Auxiliary power loss', category: 'production' },
  comms_loss: { label: 'Communications loss', category: 'data_quality' },
  irradiance_sensor_fault: { label: 'Irradiance sensor fault', category: 'data_quality' },
  meter_data_gap: { label: 'Revenue meter data gap', category: 'data_quality' },
  curtailment: { label: 'Grid curtailment', category: 'informational' },
};

export function alertTypeLabel(type: AlertType): string {
  return ALERT_TYPE_META[type].label;
}

export function alertTypeCategory(type: AlertType): AlertCategory {
  return ALERT_TYPE_META[type].category;
}

/* ------------------------------------------------------- follow-up ownership */

export const ACTION_OWNER_VALUES = ['field_tech', 'remote_ops', 'asset_manager', 'oem_vendor'] as const;
export const ActionOwnerSchema = z.enum(ACTION_OWNER_VALUES);
export type ActionOwner = z.infer<typeof ActionOwnerSchema>;

export const ACTION_OWNER_LABEL: Record<ActionOwner, string> = {
  field_tech: 'Field technician',
  remote_ops: 'Remote operations',
  asset_manager: 'Asset manager',
  oem_vendor: 'OEM / vendor',
};

export const ACTION_URGENCY_VALUES = ['now', 'today', 'this_week'] as const;
export const ActionUrgencySchema = z.enum(ACTION_URGENCY_VALUES);
export type ActionUrgency = z.infer<typeof ActionUrgencySchema>;

export const ACTION_URGENCY_LABEL: Record<ActionUrgency, string> = {
  now: 'Now',
  today: 'Today',
  this_week: 'This week',
};

export const CONFIDENCE_VALUES = ['low', 'medium', 'high'] as const;
export const ConfidenceSchema = z.enum(CONFIDENCE_VALUES);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/* ------------------------------------------------------------- audit events */

export const EVENT_KIND_VALUES = [
  'alert_created',
  'status_changed',
  'note_added',
  'assignee_changed',
  'insight_generated',
  'insight_feedback',
] as const;
export const EventKindSchema = z.enum(EVENT_KIND_VALUES);
export type EventKind = z.infer<typeof EventKindSchema>;
