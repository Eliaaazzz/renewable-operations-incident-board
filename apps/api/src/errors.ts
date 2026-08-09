import type { ApiErrorCode, AlertStatus } from '@incident-board/shared';

/**
 * Every error the API deliberately produces carries the HTTP status and machine-readable code
 * it should surface as. The error middleware then has exactly one decision to make — "is this
 * an AppError?" — and anything else becomes a 500 without leaking internals to the client.
 */
export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly httpStatus: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super('bad_request', message, 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super('not_found', id ? `${resource} "${id}" was not found` : `${resource} was not found`, 404);
  }
}

/**
 * Raised when the client's `expectedVersion` no longer matches the stored row — someone else
 * changed the alert in between. The current version travels back so the UI can offer to reload
 * rather than silently discarding one operator's edit.
 */
export class VersionConflictError extends AppError {
  constructor(expected: number, actual: number) {
    super(
      'conflict',
      'This alert was changed by someone else since you loaded it. Reload to see the latest state.',
      409,
      { expectedVersion: expected, currentVersion: actual },
    );
  }
}

export class InvalidTransitionError extends AppError {
  constructor(from: AlertStatus, to: AlertStatus, allowed: readonly AlertStatus[]) {
    const message =
      from === to
        ? `Alert is already "${from}"`
        : `Cannot move an alert from "${from}" to "${to}"`;
    super('invalid_transition', message, 422, { from, to, allowed });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please wait a moment and try again.') {
    super('rate_limited', message, 429);
  }
}

/**
 * A database row failed its hydration schema. This is always a bug — a migration that changed
 * a column's shape, or a write path that bypassed validation — so it is loud and never
 * swallowed. It is deliberately not an `AppError`: the client gets a plain 500 while the
 * detail goes to the logs.
 */
export class DataIntegrityError extends Error {
  constructor(
    readonly table: string,
    readonly detail: string,
  ) {
    super(`Corrupt row in "${table}": ${detail}`);
    this.name = 'DataIntegrityError';
  }
}
