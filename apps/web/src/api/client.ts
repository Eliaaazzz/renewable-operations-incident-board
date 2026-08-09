import { z } from 'zod';
import {
  AlertDetailResponseSchema,
  AlertListResponseSchema,
  AlertNoteSchema,
  ApiErrorSchema,
  HealthResponseSchema,
  InsightResponseSchema,
  SitesResponseSchema,
  StatsResponseSchema,
  type AlertListResponse,
  type AlertDetailResponse,
  type AlertNote,
  type CreateNoteBody,
  type HealthResponse,
  type InsightFeedbackBody,
  type InsightResponse,
  type PatchAlertBody,
  type SitesResponse,
  type StatsResponse,
} from '@incident-board/shared';
import type { BoardFilters } from '../state/filters';

/**
 * The API client, and the second half of the Zod contract.
 *
 * Every response is re-parsed here with the same schema the server validated it against. It
 * costs microseconds and it converts the worst class of frontend bug — a backend field that
 * quietly changed shape — from an `undefined` deep inside a component into one error naming
 * the endpoint and the field.
 */

const BASE_URL = import.meta.env['VITE_API_BASE_URL'] ?? '/api';

/** `POST /notes` wraps the created note; declared here rather than in the shared contract
 * because it is the only response shape the server builds inline. */
const CreatedNoteSchema = z.object({ note: AlertNoteSchema });

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  /** True when another operator changed the alert first and the UI must reload. */
  get isConflict(): boolean {
    return this.status === 409;
  }
}

async function request<S extends z.ZodType>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...init?.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiRequestError(0, 'network_error', 'Cannot reach the incident board API.');
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiRequestError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.details,
        parsed.data.error.requestId,
      );
    }
    throw new ApiRequestError(response.status, 'unknown', `Request failed (${response.status}).`);
  }

  const result = schema.safeParse(payload);
  if (!result.success) {
    const summary = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ApiRequestError(
      response.status,
      'contract_mismatch',
      `The API returned a shape this client does not understand (${path}) — ${summary}`,
    );
  }
  return result.data;
}

export function buildAlertQuery(filters: BoardFilters): string {
  const params = new URLSearchParams();
  const addAll = (key: string, values: readonly string[]): void => {
    if (values.length > 0) params.set(key, values.join(','));
  };

  addAll('status', filters.status);
  addAll('severity', filters.severity);
  addAll('siteId', filters.siteId);
  addAll('priority', filters.priority);
  if (filters.q.trim().length > 0) params.set('q', filters.q.trim());
  if (filters.needsAttention) params.set('needsAttention', 'true');
  params.set('sort', filters.sort);
  params.set('order', filters.order);
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));

  return params.toString();
}

export const api = {
  alerts(filters: BoardFilters, signal?: AbortSignal): Promise<AlertListResponse> {
    return request(`/alerts?${buildAlertQuery(filters)}`, AlertListResponseSchema, { signal });
  },

  alert(id: string, signal?: AbortSignal): Promise<AlertDetailResponse> {
    return request(`/alerts/${encodeURIComponent(id)}`, AlertDetailResponseSchema, { signal });
  },

  stats(signal?: AbortSignal): Promise<StatsResponse> {
    return request('/stats', StatsResponseSchema, { signal });
  },

  sites(signal?: AbortSignal): Promise<SitesResponse> {
    return request('/sites', SitesResponseSchema, { signal });
  },

  health(signal?: AbortSignal): Promise<HealthResponse> {
    return request('/health', HealthResponseSchema, { signal });
  },

  patchAlert(id: string, body: PatchAlertBody): Promise<AlertDetailResponse> {
    return request(`/alerts/${encodeURIComponent(id)}`, AlertDetailResponseSchema, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  addNote(id: string, body: CreateNoteBody): Promise<{ note: AlertNote }> {
    return request(`/alerts/${encodeURIComponent(id)}/notes`, CreatedNoteSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  insight(id: string, refresh: boolean): Promise<InsightResponse> {
    const suffix = refresh ? '?refresh=true' : '';
    return request(`/alerts/${encodeURIComponent(id)}/insight${suffix}`, InsightResponseSchema, {
      method: 'POST',
    });
  },

  insightFeedback(id: string, body: InsightFeedbackBody): Promise<InsightResponse> {
    return request(`/alerts/${encodeURIComponent(id)}/insight/feedback`, InsightResponseSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};
