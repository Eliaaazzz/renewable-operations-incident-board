import { Router } from 'express';
import type { HealthResponse } from '@incident-board/shared';
import type { AppConfig } from '../config.js';
import type { InsightService } from '../ai/insight.service.js';
import type { Db } from '../db/client.js';
import { schemaVersion } from '../db/migrate.js';
import type { AlertsRepository } from '../repositories/alerts.repo.js';
import type { StatsService } from '../services/stats.service.js';

export interface MetaRoutesDeps {
  config: AppConfig;
  db: Db;
  alertsRepo: AlertsRepository;
  stats: StatsService;
  insights: InsightService;
  startedAt: number;
}

export function createMetaRoutes(deps: MetaRoutesDeps): Router {
  const router = Router();

  router.get('/sites', (_req, res) => {
    res.json(deps.stats.sites());
  });

  router.get('/stats', (_req, res) => {
    res.json(deps.stats.summary());
  });

  /**
   * Health deliberately reports the AI provider's real state rather than hiding it. "The board
   * is fine, the assistant is not" is the most common state this system will be in, and the UI
   * uses this to say so plainly instead of letting the operator discover it mid-incident.
   *
   * An unreachable model is *not* an unhealthy service: the status stays `degraded`, never
   * `error`, because every endpoint still works.
   */
  router.get('/health', async (_req, res) => {
    let database: HealthResponse['database'];
    try {
      database = {
        ok: true,
        alerts: deps.alertsRepo.count(),
        schemaVersion: schemaVersion(deps.db),
      };
    } catch {
      database = { ok: false, alerts: 0, schemaVersion: 0 };
    }

    const ai = await deps.insights.availability();

    const body: HealthResponse = {
      status: database.ok ? (ai.ok ? 'ok' : 'degraded') : 'degraded',
      version: deps.config.version,
      uptimeSeconds: Math.round((Date.now() - deps.startedAt) / 1000),
      database,
      ai: {
        provider: ai.provider,
        model: ai.model,
        baseUrl: ai.baseUrl,
        reachable: ai.ok,
        latencyMs: ai.latencyMs,
        detail: ai.detail,
      },
    };

    // A failed database is the only condition that should make an orchestrator restart us.
    res.status(database.ok ? 200 : 503).json(body);
  });

  return router;
}
