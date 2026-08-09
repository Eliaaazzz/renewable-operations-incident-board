import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  AlertListQuerySchema,
  CreateNoteBodySchema,
  IdSchema,
  InsightFeedbackBodySchema,
  InsightQuerySchema,
  PatchAlertBodySchema,
} from '@incident-board/shared';
import type { AppConfig } from '../config.js';
import { RateLimitError } from '../errors.js';
import { parseInput } from '../http/validate.js';
import type { InsightService } from '../ai/insight.service.js';
import type { AlertsService } from '../services/alerts.service.js';

export interface AlertRoutesDeps {
  alerts: AlertsService;
  insights: InsightService;
  config: AppConfig;
}

export function createAlertRoutes(deps: AlertRoutesDeps): Router {
  const { alerts, insights, config } = deps;
  const router = Router();

  /**
   * Local inference is expensive and serialised by the GPU, so an unbounded generate endpoint
   * is a self-inflicted denial of service. The limiter defers to the shared error handler so
   * a 429 looks like every other error the client has to handle.
   */
  const insightLimiter = rateLimit({
    windowMs: 60_000,
    limit: config.AI_RATE_LIMIT_PER_MINUTE,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new RateLimitError('Too many AI generations. Please wait a moment before retrying.'));
    },
  });

  router.get('/', (req, res) => {
    const query = parseInput(AlertListQuerySchema, req.query, 'query');
    res.json(alerts.list(query));
  });

  router.get('/:id', (req, res) => {
    const id = parseInput(IdSchema, req.params.id, 'path parameter');
    res.json(alerts.detail(id));
  });

  router.patch('/:id', (req, res) => {
    const id = parseInput(IdSchema, req.params.id, 'path parameter');
    const body = parseInput(PatchAlertBodySchema, req.body, 'body');
    res.json(alerts.patch(id, body));
  });

  router.post('/:id/notes', (req, res) => {
    const id = parseInput(IdSchema, req.params.id, 'path parameter');
    const body = parseInput(CreateNoteBodySchema, req.body, 'body');
    res.status(201).json({ note: alerts.addNote(id, body) });
  });

  router.post('/:id/insight', insightLimiter, async (req, res) => {
    const id = parseInput(IdSchema, req.params.id, 'path parameter');
    const query = parseInput(InsightQuerySchema, req.query, 'query');
    res.json(await insights.generate(id, query.refresh ?? false));
  });

  router.post('/:id/insight/feedback', (req, res) => {
    const id = parseInput(IdSchema, req.params.id, 'path parameter');
    const body = parseInput(InsightFeedbackBodySchema, req.body, 'body');
    res.json({ insight: insights.recordFeedback(id, body), cached: true });
  });

  return router;
}
