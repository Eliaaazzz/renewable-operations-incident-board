import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Insight } from '@incident-board/shared';
import { InsightPanel } from './InsightPanel';

/**
 * What the operator must always be able to see about an AI answer: where it came from, that the
 * two assessments disagreed, and what the guardrails flagged. These are the properties that
 * make the feature defensible rather than decorative, so they are asserted rather than assumed.
 */

const NOW = new Date('2026-08-09T12:00:00.000Z');

function makeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 1,
    alertId: 'ALT-1042',
    provider: 'ollama',
    model: 'llama3.2:3b',
    payload: {
      summary: 'Rack R04 cell temperature is above the trip point and still rising.',
      likelyCauses: ['Cooling loop failure', 'Cell-level thermal event'],
      suggestedPriority: 'P1',
      priorityRationale: 'Safety risk with a rising trend.',
      nextActions: [
        { action: 'Isolate the rack from the EMS', owner: 'remote_ops', urgency: 'now' },
      ],
      safetyFlag: true,
      confidence: 'medium',
    },
    degraded: false,
    degradedReason: null,
    warnings: [],
    ruleBaseline: { priority: 'P1', score: 196.6, reasons: ['Critical severity'] },
    disagreement: { bands: 0, level: 'none' },
    latencyMs: 4200,
    generatedAt: '2026-08-09T11:58:00.000Z',
    promptHash: 'abcdef0123456789',
    contentHash: '0123456789abcdef',
    feedback: null,
    ...overrides,
  };
}

const noop = (): void => {};

describe('InsightPanel', () => {
  it('shows which model produced the answer and when', () => {
    render(
      <InsightPanel insight={makeInsight()} generating={false} error={null} onGenerate={noop} onFeedback={noop} now={NOW} />,
    );
    expect(screen.getByText(/llama3\.2:3b/)).toBeInTheDocument();
    expect(screen.getByText(/2m ago/)).toBeInTheDocument();
  });

  it('always carries a warning that generated text needs checking', () => {
    render(
      <InsightPanel insight={makeInsight()} generating={false} error={null} onGenerate={noop} onFeedback={noop} now={NOW} />,
    );
    expect(screen.getByText(/Generated text can be wrong/i)).toBeInTheDocument();
  });

  it('labels a fallback answer as the rules engine rather than the model', () => {
    render(
      <InsightPanel
        insight={makeInsight({
          degraded: true,
          provider: 'rule-based',
          degradedReason: 'the model did not respond within 60s',
          warnings: [
            {
              code: 'provider_unavailable',
              severity: 'warning',
              message: 'This was produced by the deterministic rules engine.',
            },
          ],
        })}
        generating={false}
        error={null}
        onGenerate={noop}
        onFeedback={noop}
        now={NOW}
      />,
    );

    expect(screen.getByText(/deterministic rules engine, not the language model/i)).toBeInTheDocument();
    expect(screen.getByText(/did not respond within 60s/i)).toBeInTheDocument();
  });

  it('shows both verdicts when the model and the rules disagree', () => {
    // Silently picking a winner would present a coin toss to the operator as an answer.
    render(
      <InsightPanel
        insight={makeInsight({
          payload: { ...makeInsight().payload, suggestedPriority: 'P4' },
          ruleBaseline: { priority: 'P1', score: 196.6, reasons: [] },
          disagreement: { bands: 3, level: 'major' },
        })}
        generating={false}
        error={null}
        onGenerate={noop}
        onFeedback={noop}
        now={NOW}
      />,
    );

    expect(screen.getByText(/Model suggests/i)).toBeInTheDocument();
    expect(screen.getByText(/Scoring rules give/i)).toBeInTheDocument();
    expect(screen.getByText(/disagree by 3 bands/i)).toBeInTheDocument();
  });

  it('surfaces guardrail warnings next to the text they qualify', () => {
    render(
      <InsightPanel
        insight={makeInsight({
          warnings: [
            {
              code: 'ungrounded_number',
              severity: 'warning',
              message: 'Cites a figure not present in the alert record: 999.7',
            },
            {
              code: 'injection_suspected',
              severity: 'warning',
              message: 'This alert contains text shaped like an instruction to an AI system.',
            },
          ],
        })}
        generating={false}
        error={null}
        onGenerate={noop}
        onFeedback={noop}
        now={NOW}
      />,
    );

    expect(screen.getByText(/999\.7/)).toBeInTheDocument();
    expect(screen.getByText(/instruction to an AI system/i)).toBeInTheDocument();
  });

  it('offers generation with an explanation before anything has been produced', async () => {
    const onGenerate = vi.fn();
    render(
      <InsightPanel insight={null} generating={false} error={null} onGenerate={onGenerate} onFeedback={noop} now={NOW} />,
    );

    expect(screen.getByText(/advisory/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /generate assessment/i }));
    expect(onGenerate).toHaveBeenCalledWith(false);
  });

  it('warns that local generation is slow instead of showing a bare spinner', () => {
    render(
      <InsightPanel insight={null} generating error={null} onGenerate={noop} onFeedback={noop} now={NOW} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/can take up to a minute/i);
  });

  it('records an operator verdict', async () => {
    const onFeedback = vi.fn();
    render(
      <InsightPanel insight={makeInsight()} generating={false} error={null} onGenerate={noop} onFeedback={onFeedback} now={NOW} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Not helpful' }));
    expect(onFeedback).toHaveBeenCalledWith(false);
  });

  it('reflects a verdict that was already recorded', () => {
    render(
      <InsightPanel
        insight={makeInsight({
          feedback: { helpful: true, comment: null, createdAt: '2026-08-09T11:59:00.000Z' },
        })}
        generating={false}
        error={null}
        onGenerate={noop}
        onFeedback={noop}
        now={NOW}
      />,
    );
    expect(screen.getByText(/Marked helpful/i)).toBeInTheDocument();
    // The thumb glyph is aria-hidden, so the accessible name is the word alone — which is what
    // a screen reader announces and therefore what this query must match.
    expect(screen.getByRole('button', { name: 'Helpful' })).toHaveAttribute('aria-pressed', 'true');
  });
});
