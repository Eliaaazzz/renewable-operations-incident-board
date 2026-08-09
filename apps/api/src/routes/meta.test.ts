import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AlertListResponseSchema,
  HealthResponseSchema,
  SitesResponseSchema,
  StatsResponseSchema,
} from '@incident-board/shared';
import { createStubModelClient, createTestApp, type TestApp } from '../testing/test-app.js';

let harness: TestApp;

beforeEach(() => {
  harness = createTestApp();
});

afterEach(() => {
  harness.db.close();
});

describe('GET /api/health', () => {
  it('reports the service healthy and the assistant unavailable, separately', async () => {
    // This is the state the system spends most of its life in, and conflating the two would
    // make an orchestrator restart a perfectly working API because a model was not installed.
    const { body } = await request(harness.app).get('/api/health').expect(200);
    const health = HealthResponseSchema.parse(body);

    expect(health.status).toBe('degraded');
    expect(health.database.ok).toBe(true);
    expect(health.database.alerts).toBe(18);
    expect(health.ai.reachable).toBe(false);
  });

  it('reports ok when the model is reachable', async () => {
    harness.db.close();
    harness = createTestApp({ modelClient: createStubModelClient({ available: true }) });

    const { body } = await request(harness.app).get('/api/health').expect(200);
    expect(HealthResponseSchema.parse(body).status).toBe('ok');
  });
});

describe('GET /api/stats', () => {
  it('agrees with the alert list it is derived from', async () => {
    const stats = StatsResponseSchema.parse(
      (await request(harness.app).get('/api/stats').expect(200)).body,
    );
    const attention = AlertListResponseSchema.parse(
      (await request(harness.app).get('/api/alerts?needsAttention=true').expect(200)).body,
    );

    expect(stats.totals.all).toBe(18);
    expect(stats.totals.needsAttention).toBe(attention.total);
    expect(Object.values(stats.byStatus).reduce((sum, n) => sum + n, 0)).toBe(18);
    expect(stats.totals.open + stats.byStatus.resolved + stats.byStatus.dismissed).toBe(18);
  });

  it('counts only open alerts in the severity and priority breakdowns', async () => {
    const { body } = await request(harness.app).get('/api/stats').expect(200);
    const stats = StatsResponseSchema.parse(body);

    const openBySeverity = Object.values(stats.openBySeverity).reduce((sum, n) => sum + n, 0);
    expect(openBySeverity).toBe(stats.totals.open);
    expect(Object.values(stats.openByPriority).reduce((sum, n) => sum + n, 0)).toBe(stats.totals.open);
  });

  it('reports mean time to acknowledge from real acknowledgements', async () => {
    const { body } = await request(harness.app).get('/api/stats').expect(200);
    const stats = StatsResponseSchema.parse(body);
    expect(stats.meanTimeToAcknowledgeMinutes).toBeGreaterThan(0);
  });

  it('reports null rather than zero when nothing has been acknowledged', async () => {
    harness.db.close();
    harness = createTestApp({ seed: false });
    const { body } = await request(harness.app).get('/api/stats').expect(200);
    const stats = StatsResponseSchema.parse(body);

    expect(stats.totals.all).toBe(0);
    expect(stats.meanTimeToAcknowledgeMinutes).toBeNull();
  });
});

describe('GET /api/sites', () => {
  it('lists the portfolio with open alert counts', async () => {
    const { body } = await request(harness.app).get('/api/sites').expect(200);
    const { sites } = SitesResponseSchema.parse(body);

    expect(sites).toHaveLength(6);
    expect(sites.every((site) => site.openAlerts >= 0)).toBe(true);
    expect(sites.find((site) => site.kind === 'battery')?.energyMwh).toBeGreaterThan(0);
    expect(sites.find((site) => site.kind === 'solar')?.energyMwh).toBeNull();
  });
});

describe('empty portfolio', () => {
  it('serves an empty board rather than erroring', async () => {
    harness.db.close();
    harness = createTestApp({ seed: false });

    const { body } = await request(harness.app).get('/api/alerts').expect(200);
    const parsed = AlertListResponseSchema.parse(body);
    expect(parsed.items).toEqual([]);
    expect(parsed.totalPages).toBe(1);
  });
});
