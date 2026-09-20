import { useEffect, useReducer, type ReactNode } from 'react';
import { IconClose } from './icons';
import { useT } from '../i18n';
import {
  INITIAL_NAV_RAIL_STATE,
  isExpanded,
  navRailReducer,
} from './navRailState';

export interface NavDestination {
  key: string;
  label: string;
  icon: ReactNode;
  /** Rendered below the divider (notifications, management). */
  secondary?: boolean;
  /** Optional count badge (unseen notifications). */
  count?: number;
}

/**
 * The fixed Bault navigation rail.
 *
 * TWO STATES ONLY: collapsed at 76px, and temporarily expanded to 232px while
 * the pointer is over it or keyboard focus is inside it. There is no pin, no
 * lock, and no persisted "stay open" preference — the rail was pinnable and is
 * not any more, and nothing was added in its place.
 *
 *   - choosing a destination collapses the rail immediately, even though the
 *     pointer is still over it and focus is still on the item just activated;
 *   - moving the pointer off the rail collapses it immediately, with no grace
 *     period — the old 220 ms delay is what left it hanging open;
 *   - Tab/Shift-Tab into the rail expands it, so a keyboard user reads the same
 *     labels a pointer user does, and Tabbing on after activating brings them
 *     back.
 *
 * The expanded rail floats OVER the workspace and the shell reserves only the
 * collapsed width permanently (`.workspace { margin-inline-start: var(--rail-w) }`),
 * so expanding and collapsing never shifts the page.
 *
 * The active destination is marked the way every other state in this product is
 * marked: a 2px custody-green rule on the item's leading edge, its icon at full
 * colour and its label at full weight. `aria-current="page"` carries the same
 * fact to assistive technology, and the mark is present in BOTH rail states, so
 * a collapsed rail still says plainly where you are.
 *
 * It used to be a separate element — a translucent bronze plate with a machined
 * gold notch and a turned rivet — absolutely positioned, measured with a
 * `ResizeObserver` on every expand, collapse and window resize, and animated
 * between rows. Five decorative decisions and a layout read per frame to say
 * "you are here", which a border now says with none.
 */
export function NavigationRail({
  destinations,
  active,
  onNavigate,
  mobile,
  open: mobileOpen,
  onRequestClose,
}: {
  destinations: readonly NavDestination[];
  active: string;
  onNavigate: (key: string) => void;
  mobile: boolean;
  open: boolean;
  onRequestClose: () => void;
}) {
  const t = useT();
  const [state, dispatch] = useReducer(navRailReducer, INITIAL_NAV_RAIL_STATE);

  // On mobile the rail is a drawer the shell opens and closes, so hover has no
  // meaning there and the state machine is bypassed entirely.
  const expanded = mobile ? mobileOpen : isExpanded(state);

  const primary = destinations.filter((d) => !d.secondary);
  const secondary = destinations.filter((d) => d.secondary);

  // The phone drawer closes on Escape, like every other overlay in the product.
  useEffect(() => {
    if (!mobile || !mobileOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onRequestClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobile, mobileOpen, onRequestClose]);

  /** One navigation: tell the shell, collapse the rail, close the mobile drawer. */
  function go(key: string) {
    onNavigate(key);
    dispatch({ type: 'navigate' });
    if (mobile) onRequestClose();
  }

  return (
    <>
      {mobile && mobileOpen && <div className="rail-scrim" role="presentation" onClick={onRequestClose} />}
      <nav
        className={`rail${expanded ? ' is-open' : ''}`}
        aria-label={t('nav.primary')}
        onMouseEnter={mobile ? undefined : () => dispatch({ type: 'pointerEnter' })}
        onMouseLeave={mobile ? undefined : () => dispatch({ type: 'pointerLeave' })}
        // Real movement is the only pointer signal that reopens a rail closed by
        // a selection — see `navRailState`. Dispatched only when it would change
        // something, so an idle sweep of the pointer costs no re-renders.
        onMouseMove={
          mobile || (state.hovering && !state.dismissed)
            ? undefined
            : () => dispatch({ type: 'pointerMove' })
        }
        onFocus={mobile ? undefined : () => dispatch({ type: 'focusEnter' })}
        onBlur={
          mobile
            ? undefined
            : (event) => {
                // React's onBlur bubbles, so it also fires when focus moves
                // BETWEEN two rail items. Only a move out of the rail entirely
                // counts as focus leaving.
                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                  dispatch({ type: 'focusLeave' });
                }
              }
        }
      >
        <a
          className="rail-brand"
          href="#/"
          onClick={(e) => {
            e.preventDefault();
            const first = destinations[0];
            if (first) go(first.key);
          }}
        >
          <span className="rail-mark" aria-hidden="true">
            B
          </span>
          <span className="rail-brand-text">
            <span className="rail-word">Bault</span>
            <span className="rail-sub">{t('nav.workspace')}</span>
          </span>
          <span className="rail-word-mini" aria-hidden="true">
            Bault
          </span>
        </a>
        {/* A drawer needs a visible way out; tapping the scrim is not one anybody sees. */}
        {mobile && mobileOpen && (
          <button type="button" className="rail-close icon-btn icon-btn--bare" aria-label={t('ui.close')} onClick={onRequestClose}>
            <IconClose />
          </button>
        )}

        <RailGroup destinations={primary} active={active} onNavigate={go} />

        <hr className="rail-divider" />

        <RailGroup destinations={secondary} active={active} foot onNavigate={go} />
      </nav>
    </>
  );
}

/**
 * One block of rail items. No measurement, no observer, no positioned element —
 * the active row marks itself.
 */
function RailGroup({
  destinations,
  active,
  onNavigate,
  foot,
}: {
  destinations: readonly NavDestination[];
  active: string;
  onNavigate: (key: string) => void;
  foot?: boolean;
}) {
  return (
    <ul className={`rail-nav${foot ? ' rail-nav--foot' : ''}`}>
      {destinations.map((destination) => {
        const isActive = destination.key === active;
        return (
          <li key={destination.key}>
            <button
              type="button"
              className={`rail-item${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onNavigate(destination.key)}
            >
              <span className="rail-icon">
                {destination.icon}
                {destination.count ? <span className="rail-dot" aria-hidden="true" /> : null}
              </span>
              <span className="rail-label">{destination.label}</span>
              {destination.count ? (
                <span className="rail-count" aria-hidden="true">
                  {destination.count > 99 ? '99+' : destination.count}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
