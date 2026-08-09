import { describe, expect, it } from 'vitest';
import type { AlertStatus, AlertType, Severity } from '@incident-board/shared';
import {
  AGE_UPLIFT_CAP,
  computeTriage,
  priorityForScore,
  type TriageContext,
  type TriageInput,
} from './triage.js';

/**
 * The triage engine decides what an operator looks at first, so these tests pin down the
 * behaviour that ranking depends on: the band edges, that age escalates proportionally and
 * stops escalating, that work-in-progress is damped, and that the whole thing is a pure
 * function of an injected clock rather than of wall time.
 */

const NOW = new Date('2026-08-09T12:00:00.000Z');

const CONTEXT: TriageContext = { now: NOW, portfolioMaxCapacityMw: 50 };

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function makeInput(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    severity: 'high' satisfies Severity,
    type: 'inverter_fault' satisfies AlertType,
    status: 'new' satisfies AlertStatus,
    detectedAt: hoursAgo(0),
    acknowledgedAt: null,
    siteCapacityMw: 50,
    ...overrides,
  };
}

/** high(60) × production(1.2) × siteFactor(1.3 at portfolio max) */
const BASE_SCORE = 60 * 1.2 * 1.3;

describe('priorityForScore', () => {
  it.each([
    [1_000, 'P1'],
    [120, 'P1'],
    [119.99, 'P2'],
    [70, 'P2'],
    [69.99, 'P3'],
    [35, 'P3'],
    [34.99, 'P4'],
    [0, 'P4'],
  ])('maps a score of %s to %s', (score, expected) => {
    expect(priorityForScore(score)).toBe(expected);
  });
});

describe('computeTriage — base scoring', () => {
  it('scores severity, alert category and site capacity together', () => {
    const triage = computeTriage(makeInput(), CONTEXT);
    expect(triage.score).toBeCloseTo(BASE_SCORE, 1);
    expect(triage.priority).toBe('P2');
    expect(triage.basePriority).toBe('P2');
  });

  it('ranks a safety-category alert above a production one of identical severity', () => {
    const safety = computeTriage(makeInput({ type: 'ground_fault' }), CONTEXT);
    const production = computeTriage(makeInput({ type: 'inverter_fault' }), CONTEXT);
    expect(safety.score).toBeGreaterThan(production.score);
    expect(safety.reasons).toContainEqual(expect.stringContaining('Safety-related type'));
  });

  it('ranks the same alert higher on a larger site', () => {
    const large = computeTriage(makeInput({ siteCapacityMw: 50 }), CONTEXT);
    const small = computeTriage(makeInput({ siteCapacityMw: 5 }), CONTEXT);
    expect(large.score).toBeGreaterThan(small.score);
    expect(large.reasons).toContainEqual(expect.stringContaining('High-capacity site'));
    expect(small.reasons).not.toContainEqual(expect.stringContaining('High-capacity site'));
  });

  it('does not divide by zero when the portfolio has no capacity recorded', () => {
    const triage = computeTriage(makeInput(), { now: NOW, portfolioMaxCapacityMw: 0 });
    expect(triage.score).toBeCloseTo(60 * 1.2, 1);
    expect(Number.isFinite(triage.score)).toBe(true);
  });

  it('keeps a low-severity informational alert out of the way however old it gets', () => {
    // The uplift is a percentage of the item's own base rather than a flat addition, so
    // nothing trivial can float to the top of the board purely by ageing.
    const triage = computeTriage(
      makeInput({ severity: 'low', type: 'curtailment', detectedAt: hoursAgo(30 * 24) }),
      CONTEXT,
    );
    expect(triage.priority).toBe('P4');
    expect(triage.needsAttention).toBe(false);
  });
});

describe('computeTriage — age escalation', () => {
  it('raises the score proportionally while nobody has resolved it', () => {
    const triage = computeTriage(makeInput({ detectedAt: hoursAgo(10) }), CONTEXT);
    expect(triage.score).toBeCloseTo(BASE_SCORE * 1.4, 1);
    // Escalation is the whole point: this started as a P2 and is now demanding attention.
    expect(triage.basePriority).toBe('P2');
    expect(triage.priority).toBe('P1');
    expect(triage.reasons).toContainEqual(expect.stringContaining('+40% urgency'));
  });

  it('stops escalating at the cap', () => {
    const atCap = computeTriage(makeInput({ detectedAt: hoursAgo(12.5) }), CONTEXT);
    const wellPastCap = computeTriage(makeInput({ detectedAt: hoursAgo(500) }), CONTEXT);
    expect(atCap.score).toBeCloseTo(BASE_SCORE * (1 + AGE_UPLIFT_CAP), 1);
    expect(wellPastCap.score).toBe(atCap.score);
  });

  it('does not escalate an alert somebody is actively working', () => {
    const triage = computeTriage(
      makeInput({ status: 'in_progress', detectedAt: hoursAgo(48) }),
      CONTEXT,
    );
    expect(triage.score).toBeCloseTo(BASE_SCORE * 0.6, 1);
    expect(triage.reasons).toContainEqual(expect.stringContaining('urgency damped'));
  });

  it('treats a future timestamp as brand new rather than producing a negative age', () => {
    const triage = computeTriage(makeInput({ detectedAt: hoursAgo(-6) }), CONTEXT);
    expect(triage.ageMinutes).toBe(0);
    expect(triage.score).toBeCloseTo(BASE_SCORE, 1);
  });
});

describe('computeTriage — status damping and closure', () => {
  it('damps an acknowledged alert less than one in progress', () => {
    const acknowledged = computeTriage(makeInput({ status: 'acknowledged' }), CONTEXT);
    const inProgress = computeTriage(makeInput({ status: 'in_progress' }), CONTEXT);
    expect(acknowledged.score).toBeGreaterThan(inProgress.score);
  });

  it.each(['resolved', 'dismissed'] as const)('zeroes the score of a %s alert', (status) => {
    const triage = computeTriage(makeInput({ status, severity: 'critical' }), CONTEXT);
    expect(triage.score).toBe(0);
    expect(triage.needsAttention).toBe(false);
  });

  it('remembers the priority a closed alert was worked at', () => {
    // Reporting a resolved thermal-runaway alert as "P4" because its live urgency is now zero
    // would misrepresent the history for whoever reads it next.
    const triage = computeTriage(
      makeInput({ status: 'resolved', severity: 'critical', type: 'thermal_runaway_risk' }),
      CONTEXT,
    );
    expect(triage.priority).toBe('P1');
    expect(triage.priority).toBe(triage.basePriority);
    expect(triage.reasons).toContainEqual(expect.stringContaining('no further action'));
  });
});

describe('computeTriage — acknowledgement SLA', () => {
  it('breaches once an unacknowledged alert passes its target', () => {
    const within = computeTriage(makeInput({ detectedAt: hoursAgo(0.5) }), CONTEXT);
    const past = computeTriage(makeInput({ detectedAt: hoursAgo(2) }), CONTEXT);
    expect(within.slaAckMinutes).toBe(60); // base priority P2
    expect(within.slaBreached).toBe(false);
    expect(past.slaBreached).toBe(true);
    expect(past.reasons).toContainEqual(expect.stringContaining('SLA breached'));
  });

  it('measures a breach against the time it was actually acknowledged', () => {
    const promptly = computeTriage(
      makeInput({
        status: 'acknowledged',
        detectedAt: hoursAgo(10),
        acknowledgedAt: hoursAgo(9.5),
      }),
      CONTEXT,
    );
    const late = computeTriage(
      makeInput({
        status: 'acknowledged',
        detectedAt: hoursAgo(10),
        acknowledgedAt: hoursAgo(4),
      }),
      CONTEXT,
    );
    // Acknowledged inside 30 minutes: no breach, even though the alert is still open 10h later.
    expect(promptly.slaBreached).toBe(false);
    expect(late.slaBreached).toBe(true);
    expect(late.reasons).toContainEqual(expect.stringContaining('Acknowledged late'));
  });

  it('derives the SLA from the priority at detection, not the escalated priority', () => {
    // At 10h this alert has escalated from P2 to P1, but the target it is measured against
    // stays the P2 target of 60 minutes. Otherwise ageing would tighten the deadline it is
    // being judged by, and everything old would be in breach by construction.
    const triage = computeTriage(makeInput({ detectedAt: hoursAgo(10) }), CONTEXT);
    expect(triage.priority).toBe('P1');
    expect(triage.basePriority).toBe('P2');
    expect(triage.slaAckMinutes).toBe(60);
  });

  it('does not report a breach on an alert that was closed without acknowledgement', () => {
    const triage = computeTriage(
      makeInput({ status: 'dismissed', detectedAt: hoursAgo(72) }),
      CONTEXT,
    );
    expect(triage.slaBreached).toBe(false);
  });
});

describe('computeTriage — needs attention', () => {
  it('flags urgent work nobody has started', () => {
    const triage = computeTriage(makeInput({ severity: 'critical' }), CONTEXT);
    expect(triage.needsAttention).toBe(true);
  });

  it('clears the flag once somebody is working it', () => {
    const triage = computeTriage(
      makeInput({ severity: 'critical', status: 'in_progress' }),
      CONTEXT,
    );
    expect(triage.needsAttention).toBe(false);
  });

  it('flags a low-priority alert that has blown its SLA', () => {
    // Nothing here is dramatic, but an alert nobody acknowledged for four days is a process
    // failure worth surfacing on its own.
    const triage = computeTriage(
      makeInput({ severity: 'medium', type: 'comms_loss', detectedAt: hoursAgo(96) }),
      CONTEXT,
    );
    expect(triage.priority).not.toBe('P1');
    expect(triage.slaBreached).toBe(true);
    expect(triage.needsAttention).toBe(true);
  });
});

describe('computeTriage — determinism', () => {
  it('returns identical output for identical input', () => {
    const input = makeInput({ detectedAt: hoursAgo(7) });
    expect(computeTriage(input, CONTEXT)).toEqual(computeTriage(input, CONTEXT));
  });

  it('depends on the injected clock rather than wall time', () => {
    const input = makeInput({ detectedAt: hoursAgo(1) });
    const later: TriageContext = {
      ...CONTEXT,
      now: new Date(NOW.getTime() + 6 * 3_600_000),
    };
    expect(computeTriage(input, later).ageMinutes).toBe(7 * 60);
    expect(computeTriage(input, CONTEXT).ageMinutes).toBe(60);
  });
});
