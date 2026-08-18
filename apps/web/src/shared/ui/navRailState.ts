/**
 * The navigation rail's expansion state machine, as pure data.
 *
 * The rail has exactly TWO states — collapsed, and temporarily expanded while
 * the pointer is over it or keyboard focus is inside it. There is no pinned
 * state, no persisted "keep it open" preference, and nothing that survives a
 * navigation; the rule "expanded is always temporary" is stated once, here.
 *
 * `dismissed` is what makes "selecting a destination closes the menu" work
 * without also making the rail unusable. Activating an item sets it, which
 * collapses the rail even though the pointer is still inside it and even though
 * focus is still on the item that was just clicked. It clears on the two signals
 * that unambiguously mean "I want the menu again": the pointer actually MOVING
 * over the rail, or focus arriving from the keyboard.
 *
 * It is specifically NOT cleared by `mouseenter`. Selecting a destination
 * remounts the workspace body under a cursor that has not moved, and the browser
 * emits a `mouseleave` / `mouseenter` pair for that stationary pointer — which,
 * treated as intent, reopened the rail immediately after every selection. This
 * was caught by driving the real app, not by the unit tests below, which is why
 * `pointerMove` now exists as a separate event from `pointerEnter`.
 *
 * Extracted from the component so it can be tested without a DOM — the SPA's
 * test suite runs in a Node environment (see `vitest.workspace.ts`).
 */
export interface NavRailState {
  /** The pointer is currently over the rail. */
  hovering: boolean;
  /** Keyboard focus is currently on something inside the rail. */
  focusWithin: boolean;
  /**
   * A destination was just activated. Suppresses expansion until the user
   * signals they want the menu back.
   */
  dismissed: boolean;
}

export type NavRailEvent =
  | { type: 'pointerEnter' }
  | { type: 'pointerMove' }
  | { type: 'pointerLeave' }
  | { type: 'focusEnter' }
  | { type: 'focusLeave' }
  | { type: 'navigate' };

export const INITIAL_NAV_RAIL_STATE: NavRailState = {
  hovering: false,
  focusWithin: false,
  dismissed: false,
};

/**
 * Whether the rail renders expanded.
 *
 * Note there is no third input: no pin, no stored preference, no route. If both
 * pointer and focus are outside, the rail is collapsed — always.
 */
export function isExpanded(state: NavRailState): boolean {
  if (state.dismissed) return false;
  return state.hovering || state.focusWithin;
}

export function navRailReducer(state: NavRailState, event: NavRailEvent): NavRailState {
  switch (event.type) {
    /**
     * The pointer is over the rail. This does NOT clear `dismissed`.
     *
     * It must not, because `mouseenter` is not proof that the user moved the
     * pointer here. Activating a destination replaces the DOM under a stationary
     * cursor (the workspace body remounts, the selector slides), and the browser
     * responds with a `mouseleave` / `mouseenter` pair for a pointer that never
     * moved a pixel. Clearing `dismissed` here made the rail spring straight
     * back open after every selection.
     */
    case 'pointerEnter':
      return state.hovering ? state : { ...state, hovering: true };

    /**
     * REAL pointer movement over the rail — the one signal that unambiguously
     * means "I am using this menu". A stationary cursor produces no `mousemove`,
     * however much the DOM churns underneath it, so this is what clears
     * `dismissed` after a selection.
     */
    case 'pointerMove':
      return state.hovering && !state.dismissed
        ? state
        : { ...state, hovering: true, dismissed: false };

    /**
     * Leaving collapses IMMEDIATELY. There is deliberately no grace period — a
     * timer here is what used to leave the rail hanging open after the pointer
     * had moved on, and "expanded" is meant to track the pointer exactly.
     *
     * `dismissed` is left ALONE for the same reason `pointerEnter` does not
     * clear it: the post-selection event storm contains a `mouseleave` too.
     * Whatever the state, the rail is collapsed while the pointer is outside,
     * and a genuine return involves movement, which clears it.
     */
    case 'pointerLeave':
      return state.hovering ? { ...state, hovering: false } : state;

    /**
     * Focus arriving is a deliberate keyboard act, so it DOES clear `dismissed`.
     * This is what makes the keyboard path work after an activation: Tab to the
     * next item and the labels come back.
     *
     * Unlike `mouseenter`, this is safe — the post-selection storm re-fires
     * pointer events, not focus, and the `focusin` that accompanies a click
     * arrives BEFORE the click that sets `dismissed`.
     */
    case 'focusEnter':
      return { ...state, focusWithin: true, dismissed: false };

    case 'focusLeave':
      return { ...state, focusWithin: false };

    /**
     * Activating a destination collapses the rail even while the pointer is
     * still inside it and focus is still on the activated item.
     */
    case 'navigate':
      return { ...state, hovering: false, dismissed: true };

    default:
      return state;
  }
}
