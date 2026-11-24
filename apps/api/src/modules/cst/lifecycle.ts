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

export const IN_THE_BUILDING = ['received', 'stored', 'listed', 'on-hold', 'sold'] as const;

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

const STATE_WORDS: Record<LifecycleState, string> = {
  received: 'received',
  stored: 'stored',
  listed: 'listed',
  'on-hold': 'on hold',
  sold: 'sold',
  shipped: 'shipped',
  donated: 'donated',
  consigned: 'consigned',
  at_grader: 'at the grader',
  discarded: 'discarded',
};

export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    throw new AppError(
      ErrorCode.CONFLICT,
      `This item is ${STATE_WORDS[from] ?? from}, so it cannot be ${STATE_WORDS[to] ?? to} now`,
      409,
      { from, to },
    );
  }
}
