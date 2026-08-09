import { z } from 'zod';
import {
  AlertTypeSchema,
  EventKindSchema,
  PrioritySchema,
  SeveritySchema,
  SiteKindSchema,
  StatusSchema,
} from './enums.js';

/* ---------------------------------------------------------------- primitives */

/**
 * All timestamps cross the wire as UTC ISO-8601 with a `Z` suffix. Storing and transporting a
 * single canonical form means the only place a timezone exists is the render layer, which is
 * where daylight-saving bugs stop being possible.
 */
export const IsoDateTimeSchema = z.iso.datetime({ offset: false });

export const IdSchema = z.string().min(1).max(64);

/** A telemetry value attached to an alert. Deliberately narrow: no nested objects. */
export const MetricValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type MetricValue = z.infer<typeof MetricValueSchema>;

export const MetricsSchema = z.record(z.string().min(1).max(64), MetricValueSchema);
export type Metrics = z.infer<typeof MetricsSchema>;

/* --------------------------------------------------------------------- site */

export const SiteSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(120),
  kind: SiteKindSchema,
  /** AC nameplate capacity. Drives the portfolio-relative weighting in the triage score. */
  capacityMw: z.number().positive(),
  /** Storage energy capacity; null for sites without a battery. */
  energyMwh: z.number().positive().nullable(),
  region: z.string().min(1).max(80),
  /** IANA zone, used to render timestamps in site-local time. */
  timezone: z.string().min(1).max(64),
  gridOperator: z.string().min(1).max(80),
});
export type Site = z.infer<typeof SiteSchema>;

/* -------------------------------------------------------------------- alert */

export const AlertSchema = z.object({
  id: IdSchema,
  siteId: IdSchema,
  /** Equipment identifier, e.g. `INV-07`. Null when the alert is site-wide. */
  assetId: z.string().max(120).nullable(),
  type: AlertTypeSchema,
  severity: SeveritySchema,
  status: StatusSchema,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  metrics: MetricsSchema,
  detectedAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  acknowledgedAt: IsoDateTimeSchema.nullable(),
  resolvedAt: IsoDateTimeSchema.nullable(),
  assignee: z.string().max(120).nullable(),
  /** Originating system, e.g. `scada`, `bms`, `pvsyst-compare`. */
  source: z.string().min(1).max(60),
  /**
   * Optimistic-concurrency token. Every write increments it; a client must send back the
   * version it read, so two operators editing the same alert cannot silently clobber
   * each other — the second write gets a 409 instead.
   */
  version: z.number().int().nonnegative(),
});
export type Alert = z.infer<typeof AlertSchema>;

/* --------------------------------------------------------------------- note */

export const NOTE_MAX_LENGTH = 2000;

export const AlertNoteSchema = z.object({
  id: z.number().int().positive(),
  alertId: IdSchema,
  author: z.string().min(1).max(120),
  body: z.string().min(1).max(NOTE_MAX_LENGTH),
  createdAt: IsoDateTimeSchema,
});
export type AlertNote = z.infer<typeof AlertNoteSchema>;

/* -------------------------------------------------------------------- event */

export const AlertEventSchema = z.object({
  id: z.number().int().positive(),
  alertId: IdSchema,
  kind: EventKindSchema,
  fromStatus: StatusSchema.nullable(),
  toStatus: StatusSchema.nullable(),
  actor: z.string().min(1).max(120),
  /** Free-form context for the event; shape varies by `kind`. */
  detail: z.string().max(1000).nullable(),
  createdAt: IsoDateTimeSchema,
});
export type AlertEvent = z.infer<typeof AlertEventSchema>;

/* ------------------------------------------------------------------- triage */

/**
 * The computed answer to "does this need attention, and how badly?". Recalculated on every
 * read rather than stored, because it is a function of the current time — an alert that was
 * P3 an hour ago may be P2 now purely because nobody has acknowledged it.
 */
export const TriageSchema = z.object({
  priority: PrioritySchema,
  /** Priority the alert had at detection, before any age escalation. Drives the SLA target. */
  basePriority: PrioritySchema,
  score: z.number().nonnegative(),
  /** Human-readable justification, rendered in the UI so the ranking can be audited. */
  reasons: z.array(z.string().min(1).max(200)),
  needsAttention: z.boolean(),
  slaAckMinutes: z.number().int().positive(),
  slaBreached: z.boolean(),
  /** Deadline to acknowledge; null once the alert has been acknowledged or closed. */
  slaDueAt: IsoDateTimeSchema.nullable(),
  ageMinutes: z.number().int().nonnegative(),
});
export type Triage = z.infer<typeof TriageSchema>;

/* ------------------------------------------------- composed API projections */

/** A row in the alert list: the alert plus everything needed to render it without a join. */
export const AlertSummarySchema = AlertSchema.extend({
  site: SiteSchema,
  triage: TriageSchema,
  noteCount: z.number().int().nonnegative(),
  hasInsight: z.boolean(),
});
export type AlertSummary = z.infer<typeof AlertSummarySchema>;
