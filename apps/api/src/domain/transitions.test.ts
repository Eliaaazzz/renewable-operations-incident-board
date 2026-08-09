import { describe, expect, it } from 'vitest';
import { STATUS_VALUES, type AlertStatus } from '@incident-board/shared';
import { InvalidTransitionError } from '../errors.js';
import { ALLOWED_TRANSITIONS, assertTransitionAllowed, isTransitionAllowed } from './transitions.js';

describe('status transitions', () => {
  it('never allows a status to move to itself', () => {
    for (const status of STATUS_VALUES) {
      expect(isTransitionAllowed(status, status)).toBe(false);
    }
  });

  it('never returns an alert to "new"', () => {
    // Once a human has seen an alert it cannot truthfully be unseen, and the audit trail
    // should not be able to claim otherwise.
    for (const status of STATUS_VALUES) {
      expect(isTransitionAllowed(status, 'new')).toBe(false);
    }
  });

  it('lets an obvious false positive be closed straight from "new"', () => {
    expect(isTransitionAllowed('new', 'dismissed')).toBe(true);
    expect(isTransitionAllowed('new', 'resolved')).toBe(true);
  });

  it.each(['resolved', 'dismissed'] as const)('reopens a %s alert into "in_progress" only', (status) => {
    expect(ALLOWED_TRANSITIONS[status]).toEqual(['in_progress']);
  });

  it('reaches every status from "new"', () => {
    const reachable = new Set<AlertStatus>(['new']);
    let changed = true;
    while (changed) {
      changed = false;
      for (const status of [...reachable]) {
        for (const next of ALLOWED_TRANSITIONS[status]) {
          if (!reachable.has(next)) {
            reachable.add(next);
            changed = true;
          }
        }
      }
    }
    expect([...reachable].sort()).toEqual([...STATUS_VALUES].sort());
  });

  it('throws with the legal alternatives attached', () => {
    expect(() => assertTransitionAllowed('resolved', 'new')).toThrow(InvalidTransitionError);
    try {
      assertTransitionAllowed('resolved', 'acknowledged');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect((error as InvalidTransitionError).details).toEqual({
        from: 'resolved',
        to: 'acknowledged',
        allowed: ['in_progress'],
      });
    }
  });
});
