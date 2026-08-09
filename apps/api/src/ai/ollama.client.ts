import { z } from 'zod';
import { ModelInsightSchema } from '@incident-board/shared';
import { buildRepairUser } from './prompt.js';
import type { Availability, BuiltPrompt, ModelClient, RepairContext } from './types.js';

/**
 * Ollama backend, talking to a natively installed daemon (`ollama serve`).
 *
 * The same Zod schema that validates the response is converted to JSON Schema and handed to
 * Ollama as a structured-output constraint. Constraining generation and validating the result
 * from one definition means the two can never drift apart — and the validation still runs,
 * because a constrained decoder guarantees shape, not truthfulness.
 */

const TagsResponseSchema = z.object({
  models: z.array(z.object({ name: z.string() })).default([]),
});

const ChatResponseSchema = z.object({
  message: z.object({ content: z.string() }),
});

const AVAILABILITY_TIMEOUT_MS = 2_500;

let structuredFormat: Record<string, unknown> | null | undefined;

function outputFormat(): Record<string, unknown> | 'json' {
  if (structuredFormat === undefined) {
    try {
      structuredFormat = z.toJSONSchema(ModelInsightSchema) as Record<string, unknown>;
    } catch {
      // Older Zod or an unrepresentable schema: fall back to plain JSON mode, which still
      // forces valid JSON, just without field-level constraints.
      structuredFormat = null;
    }
  }
  return structuredFormat ?? 'json';
}

export interface OllamaOptions {
  baseUrl: string;
  model: string;
}

export function createOllamaClient(options: OllamaOptions): ModelClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  return {
    name: 'ollama',
    model: options.model,
    baseUrl,

    async isAvailable(): Promise<Availability> {
      const startedAt = Date.now();
      try {
        const response = await fetch(`${baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(AVAILABILITY_TIMEOUT_MS),
        });
        const latencyMs = Date.now() - startedAt;

        if (!response.ok) {
          return { ok: false, latencyMs, detail: `Ollama responded ${response.status}` };
        }

        const tags = TagsResponseSchema.safeParse(await response.json());
        if (!tags.success) {
          return { ok: false, latencyMs, detail: 'Unexpected response from /api/tags' };
        }

        const installed = tags.data.models.map((entry) => entry.name);
        if (!installed.includes(options.model)) {
          return {
            ok: false,
            latencyMs,
            detail: `Ollama is running but "${options.model}" is not installed. Run: ollama pull ${options.model}`,
          };
        }

        return { ok: true, latencyMs, detail: null };
      } catch (error) {
        return {
          ok: false,
          latencyMs: null,
          detail:
            error instanceof Error && error.name === 'TimeoutError'
              ? `No response from Ollama at ${baseUrl} within ${AVAILABILITY_TIMEOUT_MS}ms`
              : `Cannot reach Ollama at ${baseUrl}. Is "ollama serve" running?`,
        };
      }
    },

    async complete(
      prompt: BuiltPrompt,
      signal: AbortSignal,
      repairFrom?: RepairContext,
    ): Promise<string> {
      const messages = [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ];

      if (repairFrom !== undefined) {
        messages.push(
          { role: 'assistant', content: repairFrom.previousResponse.slice(0, 2000) },
          { role: 'user', content: buildRepairUser(repairFrom.previousResponse, repairFrom.problem) },
        );
      }

      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: options.model,
          stream: false,
          format: outputFormat(),
          options: {
            // Temperature 0 with a fixed seed makes repeat runs as close to reproducible as a
            // local model gets. It is not a guarantee — see README → AI limitations.
            temperature: 0,
            seed: 42,
            num_predict: 800,
          },
          messages,
        }),
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        throw new Error(`Ollama responded ${response.status}: ${detail}`);
      }

      const parsed = ChatResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error('Ollama returned an unexpected response envelope');
      }
      return parsed.data.message.content;
    },
  };
}
