import type { Alert, AlertNote, Site, Triage } from '@incident-board/shared';

/** Everything the insight layer is allowed to know about an alert. */
export interface AlertContext {
  alert: Alert;
  site: Site;
  /** The deterministic assessment. Never sent to the model — see `prompt.ts`. */
  triage: Triage;
  recentNotes: AlertNote[];
}

export interface BuiltPrompt {
  system: string;
  user: string;
  /** Identifies the exact prompt, so a cached answer can be tied back to what produced it. */
  hash: string;
  /** Identifies just the alert content, for display and for explaining a cache miss. */
  contentHash: string;
}

export interface Availability {
  ok: boolean;
  latencyMs: number | null;
  detail: string | null;
}

/**
 * The seam a language-model backend plugs into. Deliberately narrow: it takes a prompt and
 * returns raw text. Every decision about whether that text is *usable* — schema, grounding,
 * agreement with the rules — happens in `guards.ts`, so swapping the backend cannot
 * accidentally swap the safety checks with it.
 */
export interface ModelClient {
  readonly name: 'ollama';
  readonly model: string;
  readonly baseUrl: string;
  isAvailable(): Promise<Availability>;
  complete(prompt: BuiltPrompt, signal: AbortSignal, repairFrom?: RepairContext): Promise<string>;
}

export interface RepairContext {
  /** The unusable response, fed back so the model can correct it rather than start over. */
  previousResponse: string;
  problem: string;
}
