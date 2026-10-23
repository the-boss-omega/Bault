import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';

export type LifecycleState =
  | 'received'
  | 'stored'
  | 'listed'
  | 'on-hold'
  | 'sold'
  | 'shipped'
  | 'donated'
  | 'consigned'
  | 'at_grader'
  | 'discarded';

const TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  received: ['stored'],
  stored: ['listed', 'on-hold', 'sold', 'shipped', 'donated', 'consigned', 'at_grader', 'discarded'],
  listed: ['stored', 'sold', 'on-hold'],
  'on-hold': ['stored'],
  sold: ['stored', 'shipped'],
  shipped: [],
  donated: [],
  consigned: [],
  at_grader: ['stored', 'discarded'],
  discarded: [],
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
