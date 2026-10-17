/**
 * The navigation rail's expansion state machine, as pure data.
 *
 * The rail has exactly two states: collapsed, and temporarily expanded while
 * the pointer is over it or keyboard focus is inside it. There is no pinned
 * state, no persisted preference, and nothing that survives a navigation.
 *
 * `dismissed` makes "selecting a destination closes the menu" work. Activating
 * an item sets it, which collapses the rail even though the pointer and focus
 * are still inside. It clears on the two signals that mean "I want the menu
 * again": the pointer moving over the rail, or focus arriving from the keyboard.
 *
 * It is not cleared by `mouseenter`. Selecting a destination remounts the
 * workspace body under a cursor that has not moved, and the browser emits a
 * `mouseleave` / `mouseenter` pair for that stationary pointer; treated as
 * intent, it would reopen the rail after every selection. That is why
 * `pointerMove` is a separate event from `pointerEnter`.
 *
 * Kept out of the component so it can be tested without a DOM: the web test
 * project runs in a Node environment (see `vitest.workspace.ts`).
 */
export interface NavRailState {
  /** The pointer is currently over the rail. */
  hovering: boolean;
  /** Keyboard focus is currently on something inside the rail. */
  focusWithin: boolean;
  /** A destination was just activated. Suppresses expansion until the user signals they want the menu back. */
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
 * There is no third input: no pin, no stored preference, no route. If both
 * pointer and focus are outside, the rail is collapsed.
 */
export function isExpanded(state: NavRailState): boolean {
  if (state.dismissed) return false;
  return state.hovering || state.focusWithin;
}

export function navRailReducer(state: NavRailState, event: NavRailEvent): NavRailState {
  switch (event.type) {
    /**
     * The pointer is over the rail. This does not clear `dismissed`, because
     * `mouseenter` also fires for a stationary cursor when a selection replaces
     * the DOM under it (see the module comment).
     */
    case 'pointerEnter':
      return state.hovering ? state : { ...state, hovering: true };

    /**
     * Real pointer movement over the rail. A stationary cursor produces no
     * `mousemove`, however much the DOM churns underneath it, so this is what
     * clears `dismissed` after a selection.
     */
    case 'pointerMove':
      return state.hovering && !state.dismissed
        ? state
        : { ...state, hovering: true, dismissed: false };

    /**
     * Leaving collapses immediately, with no grace period: "expanded" tracks the
     * pointer exactly.
     *
     * `dismissed` is left alone, because the post-selection event storm contains
     * a `mouseleave` too. A genuine return involves movement, which clears it.
     */
    case 'pointerLeave':
      return state.hovering ? { ...state, hovering: false } : state;

    /**
     * Focus arriving is a deliberate keyboard act, so it clears `dismissed`:
     * Tab to the next item after an activation and the labels come back.
     *
     * This is safe because the post-selection storm re-fires pointer events,
     * not focus, and the `focusin` that accompanies a click arrives before the
     * click that sets `dismissed`.
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
