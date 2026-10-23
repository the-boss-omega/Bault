import { describe, it, expect } from 'vitest';
import {
  INITIAL_NAV_RAIL_STATE,
  isExpanded,
  navRailReducer,
  type NavRailEvent,
  type NavRailState,
} from '../../apps/web/src/shared/ui/navRailState';

function run(...events: NavRailEvent[]): NavRailState {
  return events.reduce(navRailReducer, INITIAL_NAV_RAIL_STATE);
}

describe('navigation rail: two states only', () => {
  it('starts collapsed', () => {
    expect(isExpanded(INITIAL_NAV_RAIL_STATE)).toBe(false);
  });

  it('expands on hover and on keyboard focus', () => {
    expect(isExpanded(run({ type: 'pointerEnter' }))).toBe(true);
    expect(isExpanded(run({ type: 'focusEnter' }))).toBe(true);
  });

  it('has no pinned state — nothing keeps it open once hover and focus end', () => {
    expect(isExpanded(run({ type: 'pointerEnter' }, { type: 'pointerLeave' }))).toBe(false);
    expect(isExpanded(run({ type: 'focusEnter' }, { type: 'focusLeave' }))).toBe(false);
    expect(
      isExpanded(
        run(
          { type: 'pointerEnter' },
          { type: 'focusEnter' },
          { type: 'pointerLeave' },
          { type: 'focusLeave' },
        ),
      ),
    ).toBe(false);
  });

  it('exposes no pin field at all', () => {
    expect(Object.keys(INITIAL_NAV_RAIL_STATE).sort()).toEqual(['dismissed', 'focusWithin', 'hovering']);
  });
});

describe('navigation rail: closing after a selection', () => {
  it('collapses immediately when a destination is selected, pointer still inside', () => {
    const state = run({ type: 'pointerEnter' }, { type: 'navigate' });
    expect(isExpanded(state)).toBe(false);
  });

  it('stays collapsed while focus remains on the item just activated', () => {
    const state = run({ type: 'pointerEnter' }, { type: 'focusEnter' }, { type: 'navigate' });
    expect(isExpanded(state)).toBe(false);
  });

  it('reopens when the pointer actually moves over the rail again', () => {
    const state = run(
      { type: 'pointerEnter' },
      { type: 'navigate' },
      { type: 'pointerLeave' },
      { type: 'pointerEnter' },
      { type: 'pointerMove' },
    );
    expect(isExpanded(state)).toBe(true);
  });

  it('stays closed through the leave/enter storm a selection causes', () => {
    const state = run(
      { type: 'pointerEnter' },
      { type: 'navigate' },
      { type: 'pointerLeave' },
      { type: 'pointerEnter' },
    );
    expect(isExpanded(state)).toBe(false);
  });

  it('reopens when the keyboard moves focus to another item', () => {
    const state = run({ type: 'focusEnter' }, { type: 'navigate' }, { type: 'focusEnter' });
    expect(isExpanded(state)).toBe(true);
  });
});

describe('navigation rail: collapsing on hover end', () => {
  it('collapses on pointer leave with no grace period in the state itself', () => {
    const hovering = run({ type: 'pointerEnter' });
    expect(isExpanded(hovering)).toBe(true);
    expect(isExpanded(navRailReducer(hovering, { type: 'pointerLeave' }))).toBe(false);
  });

  it('stays expanded on pointer leave while keyboard focus is still inside', () => {
    const state = run({ type: 'focusEnter' }, { type: 'pointerEnter' }, { type: 'pointerLeave' });
    expect(isExpanded(state)).toBe(true);
  });

  it('keeps the rail collapsed after a selection until the pointer moves', () => {
    const afterLeave = run({ type: 'pointerEnter' }, { type: 'navigate' }, { type: 'pointerLeave' });
    expect(isExpanded(afterLeave)).toBe(false);
    expect(isExpanded(navRailReducer(afterLeave, { type: 'pointerEnter' }))).toBe(false);
    expect(
      isExpanded(
        navRailReducer(navRailReducer(afterLeave, { type: 'pointerEnter' }), { type: 'pointerMove' }),
      ),
    ).toBe(true);
  });

  it('does not churn state while the pointer moves over an already-open rail', () => {
    const open = run({ type: 'pointerEnter' }, { type: 'pointerMove' });
    expect(navRailReducer(open, { type: 'pointerMove' })).toBe(open);
    expect(navRailReducer(open, { type: 'pointerEnter' })).toBe(open);
  });
});
