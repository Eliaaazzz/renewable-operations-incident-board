import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import type { ApiError } from '@incident-board/shared';
import { AppError, DataIntegrityError } from '../errors.js';
import type { Logger } from '../lib/logger.js';

/**
 * Attaches a request id used in logs and echoed in every error body, so a screenshot of a
 * failure is enough to find the corresponding server-side log line.
 */
export function requestContext(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-request-id');
    const requestId = incoming !== undefined && incoming.length <= 120 ? incoming : randomUUID();
    res.locals['requestId'] = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  };
}

export function requestLogging(logger: Logger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.debug('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        requestId: res.locals['requestId'],
      });
    });
    next();
  };
}

/**
 * Minimal same-origin policy for the dev server and the containerised web tier. Written by hand
 * rather than pulled in as a dependency: the entire policy is an origin allowlist, and having
 * it visible in the repository is worth more than the fifteen lines it saves.
 */
export function cors(allowed: '*' | string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.header('origin');

    if (allowed === '*') {
      res.setHeader('access-control-allow-origin', '*');
    } else if (origin !== undefined && allowed.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      // Caches must not serve one origin's response to another.
      res.setHeader('vary', 'Origin');
    }

    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type,x-request-id');
    res.setHeader('access-control-max-age', '600');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

export function notFoundHandler(): RequestHandler {
  return (req: Request, res: Response) => {
    const body: ApiError = {
      error: {
        code: 'not_found',
        message: `No route matches ${req.method} ${req.path}`,
        requestId: String(res.locals['requestId'] ?? 'unknown'),
      },
    };
    res.status(404).json(body);
  };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = String(res.locals['requestId'] ?? 'unknown');

    if (error instanceof AppError) {
      // Deliberate, client-facing failures. Logged at info because they are the API working as
      // designed, not an incident.
      logger.info('request rejected', {
        requestId,
        code: error.code,
        status: error.httpStatus,
        path: req.path,
      });
      const body: ApiError = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId,
        },
      };
      res.status(error.httpStatus).json(body);
      return;
    }

    // Body-parser failures arrive as plain errors with a `type` tag. They are client mistakes,
    // not server faults, and reporting them as 500s would send people hunting for a bug that
    // is in their request.
    const parserType = (error as { type?: unknown } | null)?.type;
    if (parserType === 'entity.parse.failed' || parserType === 'entity.too.large') {
      const tooLarge = parserType === 'entity.too.large';
      const body: ApiError = {
        error: {
          code: tooLarge ? 'payload_too_large' : 'bad_request',
          message: tooLarge
            ? 'Request body is larger than this endpoint accepts.'
            : 'Request body is not valid JSON.',
          requestId,
        },
      };
      res.status(tooLarge ? 413 : 400).json(body);
      return;
    }

    if (error instanceof DataIntegrityError) {
      logger.error('data integrity failure', {
        requestId,
        table: error.table,
        detail: error.detail,
      });
    } else {
      logger.error('unhandled error', {
        requestId,
        path: req.path,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    // Nothing internal crosses the boundary — the request id is the handle for correlating
    // this response with the detail that was just logged.
    const body: ApiError = {
      error: {
        code: 'internal_error',
        message: 'Something went wrong handling this request.',
        requestId,
      },
    };
    res.status(500).json(body);
  };
}
