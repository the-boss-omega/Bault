import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';

/**
 * Item lifecycle state machine (T044, Principle I).
 *
 * Only the transitions listed here are legal; any other is rejected. Terminal
 * states (shipped/donated/consigned) have no outgoing edges — the record still
 * persists forever (items are never deleted).
 */
export type LifecycleState =
  | 'received'
  | 'stored'
  | 'listed'
  | 'on-hold'
  | 'sold'
  | 'shipped'
  | 'donated'
  | 'consigned';

const TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  received: ['stored'],
  stored: ['listed', 'on-hold', 'sold', 'shipped', 'donated', 'consigned'],
  listed: ['stored', 'sold', 'on-hold'], // unlist / sale / hold
  'on-hold': ['stored'], // hold released
  sold: ['stored', 'shipped'], // ownership moved; item stays shelved unless shipped
  shipped: [],
  donated: [],
  consigned: [],
};

export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError(
      ErrorCode.CONFLICT,
      `Illegal item transition ${from} → ${to}`,
      409,
      { from, to },
    );
  }
}
