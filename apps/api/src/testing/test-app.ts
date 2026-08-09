import type { Express } from 'express';
import { createApp } from '../app.js';
import type { ModelClient, RepairContext } from '../ai/types.js';
import { loadConfig, type AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { createLogger } from '../lib/logger.js';
import { createTestDb, TEST_NOW } from './test-db.js';

export interface TestAppOptions {
  now?: Date;
  /** `null` (the default) exercises the degraded path with no model present. */
  modelClient?: ModelClient | null;
  env?: Record<string, string>;
  seed?: boolean;
}

export interface TestApp {
  app: Express;
  db: Db;
  config: AppConfig;
  now: Date;
}

export function createTestApp(options: TestAppOptions = {}): TestApp {
  const now = options.now ?? TEST_NOW;
  const db = createTestDb({ now, ...(options.seed === undefined ? {} : { seed: options.seed }) });

  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    LOG_LEVEL: 'silent',
    SEED_ON_BOOT: 'false',
    // Tests that want a model inject one explicitly; the default is "no model available",
    // which is the state CI always runs in.
    AI_ENABLED: 'true',
    AI_TIMEOUT_MS: '2000',
    ...options.env,
  });

  const { app } = createApp({
    db,
    config,
    logger: createLogger('silent'),
    clock: () => now,
    modelClient: options.modelClient ?? null,
  });

  return { app, db, config, now };
}

/* ---------------------------------------------------------------- model stub */

export interface StubModelOptions {
  /** Successive responses; the last one repeats if more calls arrive. */
  responses?: string[];
  /** Throw instead of responding, to simulate an unreachable or timing-out daemon. */
  failWith?: Error;
  available?: boolean;
  /** Holds the response open, so overlapping requests can be tested. */
  delayMs?: number;
}

export interface StubModelClient extends ModelClient {
  calls: { repair: boolean }[];
}

/**
 * A model backend under full test control. Every AI behaviour worth asserting — valid output,
 * malformed output, a successful repair, a hallucinated site, an unreachable daemon — is a
 * different script handed to this stub, so none of it needs a real model in CI.
 */
export function createStubModelClient(options: StubModelOptions = {}): StubModelClient {
  const responses = options.responses ?? ['{}'];
  const calls: { repair: boolean }[] = [];

  return {
    name: 'ollama',
    model: 'stub-model',
    baseUrl: 'http://stub',
    calls,
    isAvailable: () =>
      Promise.resolve({
        ok: options.available ?? true,
        latencyMs: 1,
        detail: null,
      }),
    complete: async (_prompt, _signal, repairFrom?: RepairContext) => {
      calls.push({ repair: repairFrom !== undefined });
      if (options.delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (options.failWith !== undefined) throw options.failWith;
      const index = Math.min(calls.length - 1, responses.length - 1);
      return responses[index] ?? '{}';
    },
  };
}

/** A well-formed model answer, with fields overridable per test. */
export function modelAnswer(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary:
      'Cell temperatures in rack R04 crossed the trip point and are still climbing. The rack has not isolated itself, so this needs an immediate response.',
    likelyCauses: ['Cooling loop failure on the affected module', 'Cell-level thermal event'],
    suggestedPriority: 'P1',
    priorityRationale: 'Safety risk with a rising trend and no isolation.',
    nextActions: [
      { action: 'Isolate the rack from the EMS', owner: 'remote_ops', urgency: 'now' },
      { action: 'Keep personnel clear of the enclosure', owner: 'field_tech', urgency: 'now' },
    ],
    safetyFlag: true,
    confidence: 'high',
    ...overrides,
  });
}
