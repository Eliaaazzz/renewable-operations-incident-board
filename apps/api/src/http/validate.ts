import type { z } from 'zod';
import { BadRequestError } from '../errors.js';

/**
 * Request validation.
 *
 * These are helpers the handlers call rather than middleware that mutates the request, for two
 * reasons: in Express 5 `req.query` is a getter and cannot be reassigned, and calling the parse
 * explicitly keeps the handler's types honest — the parsed value is the only thing in scope, so
 * there is no route in which unvalidated input is still reachable.
 */

export type RequestSource = 'query' | 'body' | 'path parameter';

function describe(error: z.ZodError): { path: string; message: string; code: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

export function parseInput<S extends z.ZodType>(
  schema: S,
  value: unknown,
  source: RequestSource,
): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestError(`Invalid ${source}`, { issues: describe(result.error) });
  }
  return result.data;
}
