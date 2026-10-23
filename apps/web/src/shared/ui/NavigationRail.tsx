import { useReducer, type ReactNode } from 'react';
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
  secondary?: boolean;
  count?: number;
}

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

  const expanded = mobile ? mobileOpen : isExpanded(state);

  const primary = destinations.filter((d) => !d.secondary);
  const secondary = destinations.filter((d) => d.secondary);

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

        <RailGroup destinations={primary} active={active} onNavigate={go} />

        <hr className="rail-divider" />

        <RailGroup destinations={secondary} active={active} foot onNavigate={go} />
      </nav>
    </>
  );
}

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
