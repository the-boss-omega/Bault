import { describe, it, expect } from 'vitest';
import {
  INITIAL_NAV_RAIL_STATE,
  isExpanded,
  navRailReducer,
  type NavRailEvent,
  type NavRailState,
} from '../../apps/web/src/shared/ui/navRailState';

/**
 * Navigation rail behaviour.
 *
 * The rail's expansion rule lives in a pure reducer precisely so it can be
 * pinned down here: the SPA's test suite runs in a Node environment with no DOM,
 * and "the menu closes when you pick something" is too important to leave to a
 * manual check.
 */

/** Apply a sequence of events to the initial state. */
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
    // Every combination of leaving: the rail is collapsed in all of them.
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
    // A regression guard with teeth: if a "pinned"/"locked"/"sticky" flag is
    // ever reintroduced to this state, this fails.
    expect(Object.keys(INITIAL_NAV_RAIL_STATE).sort()).toEqual(['dismissed', 'focusWithin', 'hovering']);
  });
});

describe('navigation rail: closing after a selection', () => {
  it('collapses immediately when a destination is selected, pointer still inside', () => {
    const state = run({ type: 'pointerEnter' }, { type: 'navigate' });
    expect(isExpanded(state)).toBe(false);
  });

  it('stays collapsed while focus remains on the item just activated', () => {
    // Clicking focuses the button first, then fires click → 'navigate'. The rail
    // must not spring back open because focus is technically still inside it.
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

  /**
   * The regression this shape caused in the real browser.
   *
   * Selecting a destination remounts the workspace body under a cursor that has
   * not moved, and the browser emits mouseleave + mouseenter for that stationary
   * pointer. Treated as intent, the rail reopened the instant it closed — the
   * unit tests passed and the app was visibly wrong. Only genuine MOVEMENT
   * counts now, so this exact sequence must leave the rail shut.
   */
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
    // After activating with Enter, Tab moves focus on: the labels come back so
    // a keyboard user can keep navigating.
    const state = run({ type: 'focusEnter' }, { type: 'navigate' }, { type: 'focusEnter' });
    expect(isExpanded(state)).toBe(true);
  });
});

describe('navigation rail: collapsing on hover end', () => {
  it('collapses on pointer leave with no grace period in the state itself', () => {
    // The reducer is synchronous and has no timer: 'pointerLeave' collapses on
    // the spot. A delay could only be reintroduced by adding one to the
    // component, which this asserts is not the model.
    const hovering = run({ type: 'pointerEnter' });
    expect(isExpanded(hovering)).toBe(true);
    expect(isExpanded(navRailReducer(hovering, { type: 'pointerLeave' }))).toBe(false);
  });

  it('stays expanded on pointer leave while keyboard focus is still inside', () => {
    // Hover ending must not yank the rail away from a keyboard user working in it.
    const state = run({ type: 'focusEnter' }, { type: 'pointerEnter' }, { type: 'pointerLeave' });
    expect(isExpanded(state)).toBe(true);
  });

  it('keeps the rail collapsed after a selection until the pointer moves', () => {
    // Leaving does not by itself re-arm the rail — the selection storm contains
    // a mouseleave too. Movement is the signal, and it is the only one.
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
    // The component only dispatches pointerMove when it would change something;
    // the reducer returns the SAME object regardless, so React can bail out.
    const open = run({ type: 'pointerEnter' }, { type: 'pointerMove' });
    expect(navRailReducer(open, { type: 'pointerMove' })).toBe(open);
    expect(navRailReducer(open, { type: 'pointerEnter' })).toBe(open);
  });
});
