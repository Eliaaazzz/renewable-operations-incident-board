import { z } from 'zod';
import {
  PRIORITY_VALUES,
  PrioritySchema,
  SEVERITY_VALUES,
  SeveritySchema,
  STATUS_VALUES,
  StatusSchema,
  AlertTypeSchema,
} from './enums.js';
import {
  AlertEventSchema,
  AlertNoteSchema,
  AlertSummarySchema,
  IdSchema,
  IsoDateTimeSchema,
  NOTE_MAX_LENGTH,
  SiteSchema,
} from './domain.js';
import { InsightSchema } from './insight.js';

/**
 * The HTTP contract. The API validates inbound requests with these schemas and the web client
 * re-parses responses with the very same objects, so a backend change that breaks the contract
 * surfaces as one loud, located error instead of an `undefined` three components deep.
 */

/* --------------------------------------------------------------- error shape */

export const API_ERROR_CODES = [
  'bad_request',
  'not_found',
  'conflict',
  'invalid_transition',
  'rate_limited',
  'payload_too_large',
  'internal_error',
] as const;
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    /** Field-level validation problems, or the legal next statuses on a rejected transition. */
    details: z.unknown().optional(),
    requestId: z.string().min(1),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/* ------------------------------------------------------- query param helpers */

/**
 * Accepts `?status=new&status=acknowledged` and `?status=new,acknowledged` alike, because
 * both are things a person will type into a URL bar and neither should 400.
 */
function multiValue<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = Array.isArray(value) ? value : [value];
    const parts = raw
      .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : [entry]))
      .map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
      .filter((entry) => entry !== '');
    return parts.length > 0 ? parts : undefined;
  }, z.array(item).optional());
}

const BooleanFlagSchema = z.preprocess((value) => {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lowered)) return true;
    if (['false', '0', 'no', 'off'].includes(lowered)) return false;
  }
  return value; // fall through to the boolean check, which will reject it
}, z.boolean().optional());

/* ---------------------------------------------------------------- list query */

export const ALERT_SORT_VALUES = [
  'priority',
  'detectedAt',
  'updatedAt',
  'severity',
  'site',
  'status',
] as const;
export const AlertSortSchema = z.enum(ALERT_SORT_VALUES);
export type AlertSort = z.infer<typeof AlertSortSchema>;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const AlertListQuerySchema = z.object({
  status: multiValue(StatusSchema),
  severity: multiValue(SeveritySchema),
  siteId: multiValue(IdSchema),
  type: multiValue(AlertTypeSchema),
  priority: multiValue(PrioritySchema),
  /** Free-text search across title, description and asset id. */
  q: z.string().trim().max(200).optional(),
  needsAttention: BooleanFlagSchema,
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
  sort: AlertSortSchema.default('priority'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  /**
   * Asking for more than the cap is a reasonable intent ("give me everything"), so it is
   * clamped rather than rejected. Asking for zero or a negative page size is a bug, so it
   * fails validation.
   */
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .default(DEFAULT_PAGE_SIZE)
    .transform((value) => Math.min(value, MAX_PAGE_SIZE)),
});
export type AlertListQuery = z.infer<typeof AlertListQuerySchema>;

/* ------------------------------------------------------------- list response */

export const AlertFacetsSchema = z.object({
  status: z.record(StatusSchema, z.number().int().nonnegative()),
  severity: z.record(SeveritySchema, z.number().int().nonnegative()),
  priority: z.record(PrioritySchema, z.number().int().nonnegative()),
  /** Keyed by site id; arbitrary keys, so not an enum record. */
  site: z.record(z.string(), z.number().int().nonnegative()),
});
export type AlertFacets = z.infer<typeof AlertFacetsSchema>;

export const AlertListResponseSchema = z.object({
  items: z.array(AlertSummarySchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  /**
   * Counts across the whole filtered-except-this-dimension set, so the filter chips can show
   * "Critical (3)" without the user having to apply the filter to find out it is empty.
   */
  facets: AlertFacetsSchema,
});
export type AlertListResponse = z.infer<typeof AlertListResponseSchema>;

/* ----------------------------------------------------------- detail response */

export const AlertDetailResponseSchema = z.object({
  alert: AlertSummarySchema,
  notes: z.array(AlertNoteSchema),
  events: z.array(AlertEventSchema),
  insight: InsightSchema.nullable(),
  /** Legal next statuses, computed server-side so the UI cannot offer an illegal move. */
  allowedTransitions: z.array(StatusSchema),
});
export type AlertDetailResponse = z.infer<typeof AlertDetailResponseSchema>;

/* -------------------------------------------------------------- write bodies */

export const PatchAlertBodySchema = z
  .object({
    status: StatusSchema.optional(),
    assignee: z.string().trim().min(1).max(120).nullable().optional(),
    /** Optimistic-concurrency token; the version the client last read. */
    expectedVersion: z.number().int().nonnegative(),
    actor: z.string().trim().min(1).max(120).default('operator'),
    /** Optional note recorded alongside the change, so a status move can carry its reason. */
    note: z.string().trim().min(1).max(NOTE_MAX_LENGTH).optional(),
  })
  .refine((body) => body.status !== undefined || body.assignee !== undefined, {
    message: 'Provide at least one of "status" or "assignee"',
    path: ['status'],
  });
export type PatchAlertBody = z.infer<typeof PatchAlertBodySchema>;

export const CreateNoteBodySchema = z.object({
  /** `.trim()` runs before `.min(1)`, so a whitespace-only note is a 400, not an empty row. */
  body: z.string().trim().min(1).max(NOTE_MAX_LENGTH),
  author: z.string().trim().min(1).max(120).default('operator'),
});
export type CreateNoteBody = z.infer<typeof CreateNoteBodySchema>;

export const InsightQuerySchema = z.object({
  refresh: BooleanFlagSchema,
});
export type InsightQuery = z.infer<typeof InsightQuerySchema>;

export const InsightFeedbackBodySchema = z.object({
  helpful: z.boolean(),
  comment: z.string().trim().max(1000).nullable().default(null),
});
export type InsightFeedbackBody = z.infer<typeof InsightFeedbackBodySchema>;

export const InsightResponseSchema = z.object({
  insight: InsightSchema,
  /** True when this was served from cache rather than regenerated. */
  cached: z.boolean(),
});
export type InsightResponse = z.infer<typeof InsightResponseSchema>;

/* ---------------------------------------------------------- sites and stats */

export const SitesResponseSchema = z.object({
  sites: z.array(SiteSchema.extend({ openAlerts: z.number().int().nonnegative() })),
});
export type SitesResponse = z.infer<typeof SitesResponseSchema>;

export const StatsResponseSchema = z.object({
  generatedAt: IsoDateTimeSchema,
  totals: z.object({
    all: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    needsAttention: z.number().int().nonnegative(),
    slaBreached: z.number().int().nonnegative(),
    resolvedLast24h: z.number().int().nonnegative(),
    unassignedOpen: z.number().int().nonnegative(),
  }),
  /** Open alerts only — a resolved critical is not something to stare at on a wallboard. */
  openBySeverity: z.record(SeveritySchema, z.number().int().nonnegative()),
  openByPriority: z.record(PrioritySchema, z.number().int().nonnegative()),
  byStatus: z.record(StatusSchema, z.number().int().nonnegative()),
  bySite: z.array(
    z.object({
      siteId: IdSchema,
      siteName: z.string(),
      open: z.number().int().nonnegative(),
      needsAttention: z.number().int().nonnegative(),
    }),
  ),
  /** Null when nothing has been acknowledged yet, rather than a misleading zero. */
  meanTimeToAcknowledgeMinutes: z.number().nonnegative().nullable(),
});
export type StatsResponse = z.infer<typeof StatsResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  database: z.object({
    ok: z.boolean(),
    alerts: z.number().int().nonnegative(),
    schemaVersion: z.number().int().nonnegative(),
  }),
  ai: z.object({
    provider: z.string(),
    model: z.string(),
    baseUrl: z.string(),
    reachable: z.boolean(),
    latencyMs: z.number().int().nonnegative().nullable(),
    detail: z.string().nullable(),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Re-exported so consumers can build exhaustive UI without importing from two places. */
export const FILTER_DIMENSIONS = {
  status: STATUS_VALUES,
  severity: SEVERITY_VALUES,
  priority: PRIORITY_VALUES,
} as const;
