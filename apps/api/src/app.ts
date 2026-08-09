import express, { type Express } from 'express';
import { createInsightService, type InsightService } from './ai/insight.service.js';
import { createOllamaClient } from './ai/ollama.client.js';
import type { ModelClient } from './ai/types.js';
import { corsOrigins, type AppConfig } from './config.js';
import type { Db } from './db/client.js';
import { cors, errorHandler, notFoundHandler, requestContext, requestLogging } from './http/middleware.js';
import { createLogger, type Logger } from './lib/logger.js';
import { createAlertsRepository } from './repositories/alerts.repo.js';
import { createEventsRepository } from './repositories/events.repo.js';
import { createInsightsRepository } from './repositories/insights.repo.js';
import { createNotesRepository } from './repositories/notes.repo.js';
import { createSitesRepository } from './repositories/sites.repo.js';
import { createAlertRoutes } from './routes/alerts.js';
import { createMetaRoutes } from './routes/meta.js';
import { createAlertsService, type AlertsService, type Clock } from './services/alerts.service.js';
import { createStatsService, type StatsService } from './services/stats.service.js';

/**
 * Builds the Express application without starting a listener, so tests drive the real app
 * through supertest rather than a parallel implementation of it. Every collaborator that is
 * awkward in a test — the clock, the model backend — is injectable here and nowhere else.
 */

export interface CreateAppOptions {
  db: Db;
  config: AppConfig;
  logger?: Logger;
  /** Injected in tests so time-dependent output is deterministic. */
  clock?: Clock;
  /**
   * Explicit model backend. `undefined` builds the real Ollama client from config; `null`
   * means "no model", which is how CI exercises the degraded path without a 2 GB download.
   */
  modelClient?: ModelClient | null;
}

export interface AppBundle {
  app: Express;
  logger: Logger;
  services: {
    alerts: AlertsService;
    stats: StatsService;
    insights: InsightService;
  };
}

export function createApp(options: CreateAppOptions): AppBundle {
  const { db, config } = options;
  const logger = options.logger ?? createLogger(config.LOG_LEVEL);
  const clock: Clock = options.clock ?? (() => new Date());
  const startedAt = Date.now();

  const repositories = {
    alerts: createAlertsRepository(db),
    sites: createSitesRepository(db),
    notes: createNotesRepository(db),
    events: createEventsRepository(db),
    insights: createInsightsRepository(db),
  };

  const alerts = createAlertsService({ db, clock, ...repositories });

  const stats = createStatsService({
    board: alerts.board,
    sites: repositories.sites,
    clock,
  });

  const modelClient =
    options.modelClient !== undefined
      ? options.modelClient
      : createOllamaClient({ baseUrl: config.OLLAMA_BASE_URL, model: config.OLLAMA_MODEL });

  const insights = createInsightService({
    config,
    client: modelClient,
    insights: repositories.insights,
    notes: repositories.notes,
    sites: repositories.sites,
    events: repositories.events,
    entry: alerts.entry,
    clock,
    logger,
  });

  const app = express();

  // Behind nginx in the container build; needed for correct client addresses in rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext());
  app.use(requestLogging(logger));
  app.use(cors(corsOrigins(config)));
  // Notes are capped at 2000 characters, so anything approaching this limit is not a note.
  app.use(express.json({ limit: '64kb' }));

  app.use('/api/alerts', createAlertRoutes({ alerts, insights, config }));
  app.use(
    '/api',
    createMetaRoutes({
      config,
      db,
      alertsRepo: repositories.alerts,
      stats,
      insights,
      startedAt,
    }),
  );

  if (config.WEB_DIST_PATH !== undefined) {
    app.use(express.static(config.WEB_DIST_PATH));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.sendFile('index.html', { root: config.WEB_DIST_PATH });
    });
  }

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return { app, logger, services: { alerts, stats, insights } };
}
