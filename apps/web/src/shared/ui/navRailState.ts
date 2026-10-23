export interface NavRailState {
  hovering: boolean;
  focusWithin: boolean;
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

export function isExpanded(state: NavRailState): boolean {
  if (state.dismissed) return false;
  return state.hovering || state.focusWithin;
}

export function navRailReducer(state: NavRailState, event: NavRailEvent): NavRailState {
  switch (event.type) {
    case 'pointerEnter':
      return state.hovering ? state : { ...state, hovering: true };

    case 'pointerMove':
      return state.hovering && !state.dismissed
        ? state
        : { ...state, hovering: true, dismissed: false };

    case 'pointerLeave':
      return state.hovering ? { ...state, hovering: false } : state;

    case 'focusEnter':
      return { ...state, focusWithin: true, dismissed: false };

    case 'focusLeave':
      return { ...state, focusWithin: false };

    case 'navigate':
      return { ...state, hovering: false, dismissed: true };

    default:
      return state;
  }
}
