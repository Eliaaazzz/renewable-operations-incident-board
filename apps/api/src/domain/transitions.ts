import type { AlertStatus } from '@incident-board/shared';
import { InvalidTransitionError } from '../errors.js';

/**
 * The status lifecycle, expressed as an explicit matrix rather than scattered `if` statements.
 *
 * Two deliberate choices:
 *  - An alert can be resolved or dismissed straight from `new`. Plenty of alerts self-clear or
 *    are obvious false positives, and forcing an operator through `acknowledged` first would
 *    only teach them to click through it.
 *  - Reopening lands in `in_progress`, never back in `new`. Once a human has seen an alert it
 *    can never truthfully be unseen, and the audit trail should say so.
 */
export const ALLOWED_TRANSITIONS: Record<AlertStatus, readonly AlertStatus[]> = {
  new: ['acknowledged', 'in_progress', 'resolved', 'dismissed'],
  acknowledged: ['in_progress', 'resolved', 'dismissed'],
  in_progress: ['acknowledged', 'resolved', 'dismissed'],
  resolved: ['in_progress'],
  dismissed: ['in_progress'],
};

export function allowedTransitions(from: AlertStatus): readonly AlertStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function isTransitionAllowed(from: AlertStatus, to: AlertStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Throws an `InvalidTransitionError` (422) carrying the legal alternatives. */
export function assertTransitionAllowed(from: AlertStatus, to: AlertStatus): void {
  if (!isTransitionAllowed(from, to)) {
    throw new InvalidTransitionError(from, to, ALLOWED_TRANSITIONS[from]);
  }
}
