import {
  ModelInsightSchema,
  normaliseInsight,
  type Insight,
  type InsightFeedbackBody,
  type InsightPayload,
  type InsightResponse,
  type InsightWarning,
  type ModelInsight,
} from '@incident-board/shared';
import type { AppConfig } from '../config.js';
import { NotFoundError } from '../errors.js';
import type { Logger } from '../lib/logger.js';
import type { EventsRepository } from '../repositories/events.repo.js';
import type { InsightsRepository } from '../repositories/insights.repo.js';
import type { NotesRepository } from '../repositories/notes.repo.js';
import type { SitesRepository } from '../repositories/sites.repo.js';
import type { BoardEntry } from '../services/board.js';
import type { Clock } from '../services/alerts.service.js';
import { detectInjection, runGuards } from './guards.js';
import { buildPrompt } from './prompt.js';
import { ruleBasedInsight } from './rule-engine.js';
import type { AlertContext, Availability, BuiltPrompt, ModelClient } from './types.js';

/**
 * Orchestrates one generation: cache → single-flight → model → validate → guard → persist,
 * with the deterministic engine catching every failure along the way.
 *
 * The invariant this service exists to hold is that **`POST /insight` never fails because the
 * AI failed**. Ollama being down, slow, mid-download, or returning prose instead of JSON all
 * produce a 200 with `degraded: true` and a usable answer. An operations tool that shows an
 * error page when an optional assistant is unavailable is worse than one that has no assistant.
 */

export interface InsightServiceDeps {
  config: AppConfig;
  client: ModelClient | null;
  insights: InsightsRepository;
  notes: NotesRepository;
  sites: SitesRepository;
  events: EventsRepository;
  entry: (alertId: string) => BoardEntry;
  clock: Clock;
  logger: Logger;
}

export type InsightService = ReturnType<typeof createInsightService>;

interface ModelSuccess {
  ok: true;
  payload: InsightPayload;
  warnings: InsightWarning[];
  disagreement: { bands: number; level: 'none' | 'minor' | 'major' };
}

interface ModelFailure {
  ok: false;
  reason: string;
  warnings: InsightWarning[];
}

export function createInsightService(deps: InsightServiceDeps) {
  const { config, client, insights, notes, sites, events, entry, clock, logger } = deps;

  /**
   * Deduplicates concurrent work. Two operators opening the same alert, or a double-click on
   * "generate", must not start two local inferences — on CPU that is the difference between a
   * five-second wait and a thirty-second one.
   */
  const inFlight = new Map<string, Promise<InsightResponse>>();

  function contextFor(alertId: string): AlertContext {
    const boardEntry = entry(alertId);
    return {
      alert: boardEntry.alert,
      site: boardEntry.site,
      triage: boardEntry.triage,
      recentNotes: notes.listByAlert(alertId),
    };
  }

  async function askModel(
    context: AlertContext,
    prompt: BuiltPrompt,
    injectionDetected: boolean,
  ): Promise<ModelSuccess | ModelFailure> {
    if (client === null || !config.AI_ENABLED) {
      return { ok: false, reason: 'AI generation is disabled by configuration', warnings: [] };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.AI_TIMEOUT_MS);

    try {
      let response = await client.complete(prompt, controller.signal);
      let parsed = parseModelOutput(response);
      let repaired = false;

      if (!parsed.ok) {
        // One repair round-trip. Small local models frequently get the shape right on a second
        // pass when told exactly what was wrong; a second failure means stop paying for it.
        logger.debug('insight response failed validation, attempting repair', {
          alertId: context.alert.id,
          problem: parsed.problem,
        });
        response = await client.complete(prompt, controller.signal, {
          previousResponse: response,
          problem: parsed.problem,
        });
        parsed = parseModelOutput(response);
        repaired = true;
      }

      if (!parsed.ok) {
        return { ok: false, reason: `model output failed validation: ${parsed.problem}`, warnings: [] };
      }

      const payload = normaliseInsight(parsed.value);
      const guard = runGuards({
        payload,
        raw: parsed.value,
        context,
        portfolioSiteNames: sites.list().map((site) => site.name),
        rulePriority: context.triage.priority,
        injectionDetected,
        repaired,
      });

      if (guard.fatal !== null) {
        return { ok: false, reason: guard.fatal, warnings: guard.warnings };
      }

      return {
        ok: true,
        payload: { ...payload, confidence: guard.confidence },
        warnings: guard.warnings,
        disagreement: guard.disagreement,
      };
    } catch (error) {
      return { ok: false, reason: describeFailure(error, config.AI_TIMEOUT_MS), warnings: [] };
    } finally {
      clearTimeout(timeout);
    }
  }

  async function run(context: AlertContext, prompt: BuiltPrompt): Promise<InsightResponse> {
    const startedAt = Date.now();
    const injectionDetected = detectInjection(context);
    const outcome = await askModel(context, prompt, injectionDetected);

    const ruleBaseline = {
      priority: context.triage.priority,
      score: context.triage.score,
      reasons: context.triage.reasons,
    };

    const degraded = !outcome.ok;
    const warnings = [...outcome.warnings];

    if (degraded) {
      warnings.unshift({
        code: 'provider_unavailable',
        severity: 'warning',
        message:
          'This was produced by the deterministic rules engine, not the language model. It follows the standard playbook for this alert type and has not been tailored to the details of this incident.',
      });
      if (injectionDetected) {
        warnings.push({
          code: 'injection_suspected',
          severity: 'warning',
          message:
            'This alert contains text shaped like an instruction to an AI system. Treat the alert content with suspicion.',
        });
      }
      logger.warn('insight generation degraded to rules engine', {
        alertId: context.alert.id,
        reason: outcome.reason,
      });
    }

    const payload = outcome.ok ? outcome.payload : ruleBasedInsight(context);
    const generatedAt = clock().toISOString();

    const stored = insights.insert({
      alertId: context.alert.id,
      provider: degraded ? 'rule-based' : 'ollama',
      model: degraded ? 'deterministic-playbook-v1' : (client?.model ?? 'unknown'),
      payload,
      degraded,
      degradedReason: outcome.ok ? null : outcome.reason,
      warnings,
      ruleBaseline,
      disagreement: outcome.ok ? outcome.disagreement : { bands: 0, level: 'none' },
      latencyMs: Date.now() - startedAt,
      generatedAt,
      promptHash: prompt.hash,
      contentHash: prompt.contentHash,
    });

    events.append({
      alertId: context.alert.id,
      kind: 'insight_generated',
      actor: 'assistant',
      detail: degraded
        ? 'Deterministic rules engine (model unavailable)'
        : `${stored.provider} · ${stored.model}`,
      createdAt: generatedAt,
    });

    return { insight: stored, cached: false };
  }

  return {
    async generate(alertId: string, refresh: boolean): Promise<InsightResponse> {
      const context = contextFor(alertId);
      const prompt = buildPrompt(context);

      if (!refresh) {
        const reusable = insights.findReusable(alertId, prompt.hash);
        if (reusable !== null) {
          return { insight: reusable, cached: true };
        }
      }

      const key = `${alertId}:${prompt.hash}`;
      const pending = inFlight.get(key);
      if (pending !== undefined) return pending;

      const task = run(context, prompt).finally(() => {
        inFlight.delete(key);
      });
      inFlight.set(key, task);
      return task;
    },

    latest(alertId: string): Insight | null {
      return insights.latestForAlert(alertId);
    },

    /** Records an operator's verdict against the most recent insight for an alert. */
    recordFeedback(alertId: string, body: InsightFeedbackBody): Insight {
      const latest = insights.latestForAlert(alertId);
      if (latest === null) throw new NotFoundError('Insight for alert', alertId);

      const now = clock().toISOString();
      insights.saveFeedback(latest.id, body.helpful, body.comment, now);
      events.append({
        alertId,
        kind: 'insight_feedback',
        actor: 'operator',
        detail: body.helpful ? 'Marked the AI assessment helpful' : 'Marked the AI assessment unhelpful',
        createdAt: now,
      });

      const updated = insights.findById(latest.id);
      if (updated === null) throw new NotFoundError('Insight', String(latest.id));
      return updated;
    },

    async availability(): Promise<Availability & { provider: string; model: string; baseUrl: string }> {
      if (client === null || !config.AI_ENABLED) {
        return {
          ok: false,
          latencyMs: null,
          detail: 'AI generation is disabled by configuration (AI_ENABLED=false)',
          provider: 'rule-based',
          model: 'deterministic-playbook-v1',
          baseUrl: '',
        };
      }
      const availability = await client.isAvailable();
      return {
        ...availability,
        provider: client.name,
        model: client.model,
        baseUrl: client.baseUrl,
      };
    },
  };
}

/* ----------------------------------------------------------------- helpers */

type ParseResult =
  | { ok: true; value: ModelInsight }
  | { ok: false; problem: string };

/**
 * Recovers the JSON object from a model response. Structured output should make this a plain
 * `JSON.parse`, but a small model asked for JSON will still occasionally wrap it in a code
 * fence or add a sentence of preamble, and throwing away an otherwise valid answer over
 * punctuation would be wasteful.
 */
export function parseModelOutput(raw: string): ParseResult {
  const withoutFences = raw.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');

  if (start === -1 || end <= start) {
    return { ok: false, problem: 'response contained no JSON object' };
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    return { ok: false, problem: 'response was not valid JSON' };
  }

  const validated = ModelInsightSchema.safeParse(candidate);
  if (!validated.success) {
    const problems = validated.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
      .join('; ');
    return { ok: false, problem: problems };
  }

  return { ok: true, value: validated.data };
}

function describeFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return `the model did not respond within ${Math.round(timeoutMs / 1000)}s`;
    }
    return error.message;
  }
  return 'unknown error contacting the model';
}
