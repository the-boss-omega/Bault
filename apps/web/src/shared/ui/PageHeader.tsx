import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n, useT, type Locale } from '../i18n';
import { formatDate } from '../money';
import { useTheme } from '../theme';
import type { AppNotification } from '../hooks';
import { IconButton } from './primitives';
import {
  IconBell,
  IconChevronDown,
  IconChevronRight,
  IconGlobe,
  IconMonitor,
  IconMoon,
  IconSun,
  IconSettings,
  IconShield,
  IconSignOut,
  IconUser,
} from './icons';

export interface Crumb {
  label: string;
  onClick?: () => void;
}

export function PageHeader({
  title,
  crumbs,
  actions,
}: {
  title: string;
  crumbs: readonly Crumb[];
  actions: ReactNode;
}) {
  const t = useT();
  return (
    <header className="page-header">
      <div className="ph-main">
        <h1 className="page-title">{title}</h1>
        <nav className="breadcrumb" aria-label={t('nav.breadcrumb')}>
          {crumbs.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} style={{ display: 'inline-flex', gap: 6 }}>
              {index > 0 && (
                <span className="breadcrumb-sep" aria-hidden="true">
                  ›
                </span>
              )}
              {crumb.onClick ? (
                <button type="button" onClick={crumb.onClick}>
                  {crumb.label}
                </button>
              ) : (
                <span aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      </div>
      <div className="ph-actions">{actions}</div>
    </header>
  );
}

export function AccountPill({
  username,
  roleLabel,
  suspended,
}: {
  username?: string;
  roleLabel: string;
  suspended: boolean;
}) {
  const t = useT();

  if (suspended) {
    return (
      <span className="status-pill status-pill--warning" title={t('app.account.suspendedHint')}>
        <span className="status-dot status-dot--warning" aria-hidden="true" />
        <span className="status-pill-main">{t('app.account.suspended')}</span>
      </span>
    );
  }

  return (
    <span className="status-pill" title={t('app.account.activeHint', { role: roleLabel })}>
      <span className="status-dot" aria-hidden="true" />
      {username ? (
        <>
          <span className="status-pill-main" dir="ltr">
            @{username}
          </span>
          <span className="status-pill-sub">{roleLabel}</span>
        </>
      ) : (
        <span className="status-pill-main">{roleLabel}</span>
      )}
    </span>
  );
}

function usePopover(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close();
        ref.current?.querySelector<HTMLElement>('button')?.focus();
      }
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return ref;
}

export function NotificationBell({
  items,
  unseen,
  onOpen,
  onViewAll,
  renderTitle,
  renderText,
}: {
  items: readonly AppNotification[];
  unseen: number;
  onOpen: () => void;
  onViewAll: () => void;
  renderTitle: (n: AppNotification) => string;
  renderText: (n: AppNotification) => string;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = usePopover(open, () => setOpen(false));
  const recent = items.slice(0, 5);

  return (
    <div className="pop-wrap" ref={ref}>
      <IconButton
        label={unseen > 0 ? t('notifications.newCount', { n: unseen }) : t('notifications.title')}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={open ? 'is-on' : ''}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) onOpen();
        }}
      >
        <IconBell />
        {unseen > 0 && (
          <span className="bell-badge" aria-hidden="true">
            {unseen > 9 ? '9+' : unseen}
          </span>
        )}
      </IconButton>

      {open && (
        <div className="pop pop--wide" role="dialog" aria-label={t('notifications.title')}>
          <div className="pop-head">
            <span className="pop-title">{t('notifications.title')}</span>
            <span className="hint">{t('notifications.recent')}</span>
          </div>
          {recent.length === 0 ? (
            <p className="hint" style={{ padding: '20px 16px', textAlign: 'center' }}>
              {t('notifications.empty')}
            </p>
          ) : (
            <ul className="pop-list">
              {recent.map((n) => (
                <li key={n.id}>
                  <div className="pop-row">
                    <p className="pop-row-title">{renderTitle(n)}</p>
                    <p className="pop-row-text">
                      <bdi dir="auto">{renderText(n)}</bdi>
                    </p>
                    <p className="pop-row-date">
                      <span className="date">{formatDate(n.createdAt, locale)}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="pop-foot">
            <button
              type="button"
              className="link-more"
              style={{ width: '100%', justifyContent: 'center' }}
              onClick={() => {
                setOpen(false);
                onViewAll();
              }}
            >
              {t('notifications.viewAll')}
              <IconChevronRight />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ThemeToggle() {
  const t = useT();
  const { choice, resolved, cycle } = useTheme();

  const label =
    choice === 'system'
      ? t('app.theme.system')
      : choice === 'dark'
        ? t('app.theme.dark')
        : t('app.theme.light');

  return (
    <IconButton
      label={t('app.theme.label', { current: label })}
      className="theme-toggle"
      onClick={cycle}
    >
      {choice === 'system' ? (
        <IconMonitor />
      ) : resolved === 'dark' ? (
        <IconMoon />
      ) : (
        <IconSun />
      )}
    </IconButton>
  );
}

export function LanguageSwitcher() {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = usePopover(open, () => setOpen(false));

  const options: { value: Locale; label: string }[] = [
    { value: 'he', label: 'עברית' },
    { value: 'en', label: 'English' },
  ];
  const current = options.find((o) => o.value === locale);

  return (
    <div className="pop-wrap" ref={ref}>
      <IconButton
        label={t('app.switchLanguageLabel')}
        aria-expanded={open}
        aria-haspopup="menu"
        className={open ? 'is-on' : ''}
        onClick={() => setOpen((o) => !o)}
      >
        <IconGlobe />
        <span className="lang-code" aria-hidden="true">
          {locale.toUpperCase()}
        </span>
      </IconButton>

      {open && (
        <div className="pop" role="menu" aria-label={t('app.switchLanguageLabel')}>
          <div className="menu-head">
            <p className="menu-name">{t('menu.language')}</p>
            <p className="menu-sub">{current?.label ?? locale}</p>
          </div>
          <div className="menu-sep" />
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === locale}
              className={`menu-item${option.value === locale ? ' is-on' : ''}`}
              dir={option.value === 'he' ? 'rtl' : 'ltr'}
              onClick={() => {
                setLocale(option.value);
                setOpen(false);
              }}
            >
              <IconGlobe />
              {option.label}
              {option.value === locale && (
                <span className="menu-item-note">{t('menu.languageCurrent')}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function UserMenu({
  initials,
  name,
  roleLabel,
  onProfile,
  onSettings,
  onSignOut,
}: {
  initials: string;
  name: string;
  roleLabel: string;
  onProfile: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = usePopover(open, () => setOpen(false));

  return (
    <div className="pop-wrap" ref={ref}>
      <button
        type="button"
        className="user-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('menu.account')}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <IconChevronDown />
      </button>

      {open && (
        <div className="pop" role="menu" aria-label={t('menu.account')}>
          <div className="menu-head">
            <p className="menu-name">{name}</p>
            <p className="menu-sub">{roleLabel}</p>
          </div>
          <div className="menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onProfile();
            }}
          >
            <IconUser />
            {t('menu.profile')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
          >
            <IconSettings />
            {t('menu.accountSettings')}
          </button>
          <div className="menu-item" role="presentation" style={{ cursor: 'default' }}>
            <IconShield />
            {t('menu.role')}
            <span className="menu-item-note">{roleLabel}</span>
          </div>
          <div className="menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="menu-item menu-item--danger"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <IconSignOut />
            {t('app.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
