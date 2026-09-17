import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { hasMessage, useI18n, type MessageKey } from './shared/i18n';
import { ApiError, api, apiErrorKey } from './shared/api';
import { loadProfile, resetProfileRequest } from './shared/session';
import {
  navigate,
  lastVisitedSection,
  clearLastVisitedSection,
  legacyRedirect,
  useRoute,
} from './shared/routing';
import { useMediaQuery, useNotificationFeed } from './shared/hooks';
import { eventLabel, renderContent } from './shared/notifications';
import { NavigationRail, type NavDestination } from './shared/ui/NavigationRail';
import {
  AccountPill,
  LanguageSwitcher,
  NotificationBell,
  PageHeader,
  ThemeToggle,
  UserMenu,
  type Crumb,
} from './shared/ui/PageHeader';
import { fullName, initialsFrom } from './shared/names';
import { ErrorState, IconButton } from './shared/ui/primitives';
import {
  IconAsk,
  IconBell,
  IconInbox,
  IconLegal,
  IconManagement,
  IconMarketplace,
  IconMenu,
  IconShippingServices,
  IconVault,
  IconWallet,
  IconWarehouse,
} from './shared/ui/icons';
import { AuthPage, AuthShell, type AuthMode, type SessionUser } from './areas/customer/auth/AuthPage';
import { LandingPage } from './areas/customer/marketing/LandingPage';
import { VerifyEmailPage } from './areas/customer/auth/VerifyEmailPage';
import { ResetPasswordPage } from './areas/customer/auth/ResetPasswordPage';
import { VaultPage } from './areas/customer/vault/VaultPage';
import { InboundPage } from './areas/customer/inbound/InboundPage';
import { SupportPage } from './areas/customer/support/SupportPage';
import { WalletPage } from './areas/customer/finance/WalletPage';
import { MarketplacePage } from './areas/customer/marketplace/MarketplacePage';
import { ShippingServicesPage } from './areas/customer/shipping/ShippingServicesPage';
import { FaqLegalPage } from './areas/customer/help/FaqLegalPage';
import { NotificationsPage } from './areas/customer/notifications/NotificationsPage';
import { ProfilePage } from './areas/customer/profile/ProfilePage';
import { WarehouseConsole } from './areas/warehouse/WarehouseConsole';
import { AdminConsole } from './areas/admin/AdminConsole';

/**
 * Root component and application shell.
 *
 * The shell — navigation rail, page header, workspace — is mounted once and
 * stays mounted: switching section only moves the custody rule on the active
 * rail item, swaps the title/breadcrumb and re-renders the workspace body. Role
 * gating is unchanged:
 *   - every role gets the collector features (vault, wallet, marketplace,
 *     services, shipping, notifications, profile);
 *   - staff (warehouse_operator / admin) also get the warehouse console;
 *   - the manager (admin) also gets Management (the admin console).
 * Profile, language and sign-out live in the account menu, not the rail.
 */
const ROLE_KEY: Record<string, MessageKey> = {
  user: 'role.user',
  warehouse_operator: 'role.warehouse_operator',
  admin: 'role.admin',
};

/** Rail destinations in order. `admin` keeps its internal key and permissions. */
interface SectionSpec {
  key: string;
  labelKey: MessageKey;
  titleKey: MessageKey;
  icon: ReactElement;
  secondary?: boolean;
  requires?: 'staff' | 'admin';
}

const SECTIONS: readonly SectionSpec[] = [
  { key: 'vault', labelKey: 'tab.vault', titleKey: 'vault.title', icon: <IconVault /> },
  // Inbound sits directly after the Vault because it is where the Vault's
  // contents come from: addresses to ship purchases to, and the parcels those
  // purchases become on their way in.
  { key: 'inbound', labelKey: 'tab.inbound', titleKey: 'inbound.title', icon: <IconInbox /> },
  { key: 'wallet', labelKey: 'tab.wallet', titleKey: 'wallet.title', icon: <IconWallet /> },
  { key: 'marketplace', labelKey: 'tab.marketplace', titleKey: 'market.title', icon: <IconMarketplace /> },
  {
    key: 'shipping-services',
    labelKey: 'tab.shippingServices',
    titleKey: 'shippingServices.title',
    icon: <IconShippingServices />,
  },
  {
    key: 'warehouse',
    labelKey: 'nav.warehouse',
    titleKey: 'warehouse.title',
    icon: <IconWarehouse />,
    requires: 'staff',
  },
  {
    key: 'notifications',
    labelKey: 'tab.notifications',
    titleKey: 'notifications.title',
    icon: <IconBell />,
    secondary: true,
  },
  {
    key: 'support',
    labelKey: 'tab.support',
    titleKey: 'support.title',
    icon: <IconAsk />,
    secondary: true,
  },
  {
    key: 'faq',
    labelKey: 'tab.faqLegal',
    titleKey: 'faqLegal.title',
    icon: <IconLegal />,
    secondary: true,
  },
  {
    key: 'admin',
    labelKey: 'nav.management',
    titleKey: 'admin.title',
    icon: <IconManagement />,
    secondary: true,
    requires: 'admin',
  },
];

/**
 * Message-key prefix for each section's contextual tabs, so the breadcrumb can
 * name the active tab. Sections absent here have no tab strip.
 */
const TAB_PREFIX: Record<string, string> = {
  vault: 'vault.scope.',
  inbound: 'inbound.tab.',
  support: 'support.tab.',
  wallet: 'wallet.tab.',
  marketplace: 'market.tab.',
  'shipping-services': 'ss.tab.',
  faq: 'faq.tab.',
  warehouse: 'warehouse.tab.',
  admin: 'admin.section.',
};

/**
 * Result of the boot-time `/me/profile` probe.
 *
 * `anonymous` and `blocked` are deliberately different: a 401 means "nobody is
 * signed in" and belongs on the sign-in page, while an unreachable API or a 5xx
 * means we do not KNOW who is signed in. Rendering the sign-in form in that case
 * would silently look like a sign-out and invite the user to re-enter a password
 * that cannot be checked, so those states get their own screen with a retry.
 */
type BootState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'ready'; user: SessionUser }
  | { status: 'blocked'; messageKey: MessageKey; detail: string | null };

/**
 * Routes that are answered WITHOUT a session and before the session probe.
 *
 * Both are opened from a link in an email by someone who, by definition, is not
 * signed in — and in the reset case may not be able to sign in at all. Handling
 * them here rather than inside the signed-out `AuthPage` keeps them working for
 * a reader who happens to already have a session (a shared machine, a second
 * account), where the signed-in shell would otherwise treat the route as
 * unknown and bounce them to their landing section, discarding the token.
 */
const TOKEN_ROUTES = ['verify-email', 'reset-password'] as const;

/**
 * The anonymous routes that are a FORM, and which form each one opens on.
 *
 * Everything else an anonymous visitor can ask for falls into one of two cases,
 * and they want opposite things:
 *
 *   - THE BARE ROOT (`#/`, or no hash at all) is somebody arriving. They get
 *     `LandingPage`, which is what this product spent its whole life without:
 *     an answer to "what is this and what does it cost" that does not require an
 *     account to read.
 *   - A DEEP LINK (`#/vault`, `#/wallet`, …) is somebody who had a session and
 *     no longer does. They get the sign-in form, exactly as before, because
 *     answering "take me back to my vault" with a shop window is an obstacle
 *     rather than a welcome.
 *
 * `#/welcome` is the landing page addressed by name, so the sign-in screen can
 * link back to it and a visitor can return to it without clearing the hash.
 */
const AUTH_ROUTES: Record<string, AuthMode> = {
  signin: 'signIn',
  signup: 'signUp',
  forgot: 'forgot',
};

/** Routes that answer with the marketing page rather than with a form. */
const LANDING_ROUTES = ['', 'welcome'];

export default function App() {
  const { t } = useI18n();
  const route = useRoute();
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });

  // Restore the session on load: the httpOnly cookie survives a refresh, so ask
  // the API who we are. This keeps the user signed in after F5, and gives the
  // account menu a real name/email to show. `loadProfile` collapses concurrent
  // callers onto a single request, so StrictMode's double effect stays one call.
  const loadSession = useCallback(async () => {
    const me = await loadProfile();
    setBoot({ status: 'ready', user: me });
  }, []);

  const probeSession = useCallback(async () => {
    setBoot({ status: 'loading' });
    try {
      await loadSession();
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'unauthenticated') {
        setBoot({ status: 'anonymous' });
        return;
      }
      // Unreachable / 5xx / 403 / 404 — a real fault, shown as one. Exactly one
      // attempt is made; recovery is the explicit retry button, never a loop.
      setBoot({
        status: 'blocked',
        messageKey: apiErrorKey(e) ?? 'error.unexpected',
        detail: e instanceof Error ? e.message : null,
      });
    }
  }, [loadSession]);

  useEffect(() => {
    void probeSession();
  }, [probeSession]);

  // Answered ahead of the boot states below: neither page needs to know who is
  // signed in, and making a reader wait on a session probe to read "your email
  // is confirmed" would be a spinner in front of an answer we already have.
  if ((TOKEN_ROUTES as readonly string[]).includes(route.section)) {
    const token = route.params.token ?? null;
    return (
      /* `bare`: no landing stage. Somebody who has clicked a link in an email to
         confirm an address or reset a password is not being sold anything —
         they want one sentence and a button, and a shop window in front of it
         is an obstacle. */
      <AuthShell bare>
        {route.section === 'verify-email' ? (
          <VerifyEmailPage token={token} />
        ) : (
          <ResetPasswordPage token={token} />
        )}
      </AuthShell>
    );
  }

  /**
   * The landing page does not wait for the session probe, and does not fail with it.
   *
   * It is a PUBLIC page. It asks who is signed in for nothing, renders nothing
   * that depends on the answer, and fetches its own figures from a route that
   * is `@Public()` on the server for exactly this reason. Putting it behind the
   * probe bought two bad screens and no correctness: a spinner in front of a
   * page that was ready, and — when the API is unreachable — a full-screen
   * error where the marketing site should be. Somebody arriving at Bault for
   * the first time while the database is down should still be able to read what
   * Bault is; they find out the rest when they press Sign in, which is the
   * control that actually needs a backend.
   *
   * It stays below `TOKEN_ROUTES` because those carry a token and are more
   * specific, and above the boot states because it outranks all three.
   */
  if (boot.status !== 'ready' && LANDING_ROUTES.includes(route.section)) {
    return <LandingPage />;
  }

  if (boot.status === 'loading') {
    return (
      <div className="boot">
        <span className="rail-mark" aria-hidden="true">
          B
        </span>
        <p className="hint">{t('app.loading')}</p>
      </div>
    );
  }

  if (boot.status === 'blocked') {
    return (
      <div className="boot">
        <span className="rail-mark" aria-hidden="true">
          B
        </span>
        <div className="boot-error">
          <ErrorState
            title={t('error.title')}
            message={t(boot.messageKey)}
            onRetry={() => void probeSession()}
            retryLabel={t('ui.retry')}
          />
          {boot.detail && (
            <p className="hint" dir="ltr">
              {boot.detail}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (boot.status === 'anonymous') {
    return (
      <AuthPage
        initialMode={AUTH_ROUTES[route.section] ?? 'signIn'}
        onSignedIn={(u) => {
          setBoot({ status: 'ready', user: u });
          navigate(
            {
              section:
                u.role === 'admin' ? 'admin' : u.role === 'warehouse_operator' ? 'warehouse' : 'vault',
            },
            { replace: true },
          );
          // Backfill email / display name for the account menu. A fresh sign-in
          // needs a fresh request, so drop any settled in-flight slot first.
          resetProfileRequest();
          void loadSession().catch(() => undefined);
        }}
      />
    );
  }

  /*
   * NOT keyed on `locale`.
   *
   * The workspace used to be remounted on every language change, which threw
   * away the whole section's state — open drawer, table filters, half-typed
   * form — to achieve something React context already does. A locale change now
   * re-renders in place: same components, new strings, nothing reloaded.
   */
  return (
    <Workspace
      user={boot.user}
      onSignedOut={() => {
        resetProfileRequest();
        setBoot({ status: 'anonymous' });
      }}
    />
  );
}

function Workspace({ user, onSignedOut }: { user: SessionUser; onSignedOut: () => void }) {
  const { t } = useI18n();
  const route = useRoute();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [railOpen, setRailOpen] = useState(false);
  const notifications = useNotificationFeed();

  const isStaff = user.role === 'warehouse_operator' || user.role === 'admin';
  const isAdmin = user.role === 'admin';
  /**
   * A suspended account can sign in, and can do exactly one thing: use the
   * helpdesk.
   *
   * Sign-in used to be refused outright, which was coherent while suspension was
   * only ever an administrator's decision. Once the debt sweep started imposing
   * it automatically, refusing sign-in meant a holder who owed $20 could not
   * cash in to clear the $20 — the lock had no key on the inside. Authentication
   * now succeeds and the API restricts everything except the ticket routes.
   *
   * The rail is narrowed to match, rather than showing destinations that would
   * every one of them answer 403. Showing a disabled vault to somebody who
   * cannot open it is a worse explanation than not showing it.
   */
  const suspended = user.status === 'suspended';

  const allowed = useMemo(
    () =>
      SECTIONS.filter((s) => {
        if (suspended) return s.key === 'support';
        return !s.requires || (s.requires === 'staff' && isStaff) || (s.requires === 'admin' && isAdmin);
      }),
    [isStaff, isAdmin, suspended],
  );

  // Resolve the section: the hash wins, then the last visited section, then the
  // role's landing page. An unpermitted or unknown section falls back rather
  // than rendering a blank workspace.
  const fallback = suspended ? 'support' : isAdmin ? 'admin' : isStaff ? 'warehouse' : 'vault';
  const requested = route.section || lastVisitedSection() || fallback;
  const known = (!suspended && requested === 'profile') || allowed.some((s) => s.key === requested);
  const section = known ? requested : fallback;

  // A retired route (`#/services`, `#/shipping`) is rewritten to where its
  // workflow now lives before anything else runs. `replace` keeps Back from
  // returning to the dead URL. This also covers a persisted last-visited
  // section left over from before the merge.
  // Destructured to primitives so the effect below does not re-fire on a fresh
  // object identity every render.
  const legacy = legacyRedirect({ ...route, section: requested });
  const legacySection = legacy?.section ?? null;
  const legacyTab = legacy?.tab ?? null;

  useEffect(() => {
    if (legacySection) {
      navigate({ section: legacySection, tab: legacyTab }, { replace: true });
      return;
    }
    if (route.section !== section) navigate({ section }, { replace: true });
  }, [legacySection, legacyTab, route.section, section]);

  const goto = useCallback((next: string) => navigate({ section: next }), []);

  const roleKey = ROLE_KEY[user.role];
  const roleLabel = roleKey ? t(roleKey) : user.role;

  const destinations: NavDestination[] = allowed.map((s) => ({
    key: s.key,
    label: t(s.labelKey),
    icon: s.icon,
    secondary: s.secondary,
    count: s.key === 'notifications' ? notifications.unseen : undefined,
  }));

  const spec = SECTIONS.find((s) => s.key === section);
  const pageTitle = section === 'profile' ? t('profile.title') : spec ? t(spec.titleKey) : t('app.title');
  const sectionLabel = section === 'profile' ? t('profile.title') : spec ? t(spec.labelKey) : pageTitle;
  // The trailing crumb names the active contextual tab, so the current location
  // is stated in full ("Home › Vault › Card history") rather than stopping at
  // the section. Omitted when the section has no tabs or the tab is unknown.
  const tabKey = route.tab ? `${TAB_PREFIX[section] ?? ''}${route.tab}` : '';
  const crumbs: Crumb[] = [
    { label: t('nav.home'), onClick: () => goto(fallback) },
    hasMessage(tabKey)
      ? { label: sectionLabel, onClick: () => goto(section) }
      : { label: sectionLabel },
    ...(hasMessage(tabKey) ? [{ label: t(tabKey) }] : []),
  ];

  async function signOut() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore — clear local state regardless */
    }
    clearLastVisitedSection();
    navigate({ section: 'vault' }, { replace: true });
    onSignedOut();
  }

  // Hold this frame rather than flashing the fallback section while the legacy
  // redirect lands. Placed after every hook so the hook order stays stable.
  if (legacySection) return null;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t('nav.skipToContent')}
      </a>

      <NavigationRail
        destinations={destinations}
        active={section}
        onNavigate={goto}
        mobile={isMobile}
        open={railOpen}
        onRequestClose={() => setRailOpen(false)}
      />

      <div className="workspace">
        {isMobile && (
          <div className="mobile-bar">
            <IconButton label={t('nav.openMenu')} bare onClick={() => setRailOpen(true)} style={{ color: '#fff' }}>
              <IconMenu />
            </IconButton>
            <span className="rail-mark" aria-hidden="true">
              B
            </span>
            <span className="mobile-bar-title">{pageTitle}</span>
          </div>
        )}

        <div className="workspace-inner">
          <PageHeader
            title={pageTitle}
            crumbs={crumbs}
            actions={
              <>
                <AccountPill
                  username={user.username}
                  roleLabel={roleLabel}
                  suspended={suspended}
                />
                {/* Shell settings, together and SEGMENTED: theme, language and
                    the bell are the same kind of control — they act on the frame
                    rather than on the content — so they are one object with
                    hairlines between them, not three separately-bordered boxes
                    strung along the end of the header. */}
                <span className="ph-controls">
                  <ThemeToggle />
                  <LanguageSwitcher />
                  <NotificationBell
                    items={notifications.items}
                    unseen={notifications.unseen}
                    onOpen={() => {
                      void notifications.reload();
                      notifications.markSeen();
                    }}
                    onViewAll={() => goto('notifications')}
                    renderTitle={(n) => eventLabel(t, n.eventType)}
                    renderText={(n) => renderContent(n.content, eventLabel(t, n.eventType))}
                  />
                </span>
                <UserMenu
                  initials={initialsFrom(user.firstName, user.lastName, user.email)}
                  name={fullName(user.firstName, user.lastName) || user.email || t('menu.account')}
                  roleLabel={roleLabel}
                  onProfile={() => goto('profile')}
                  onSettings={() => goto('profile')}
                  onSignOut={signOut}
                />
              </>
            }
          />

          {/* The section body is the only thing that changes between
              destinations; the rail and header above stay mounted. Keyed on the
              section alone, so switching a contextual tab updates content in
              place instead of remounting (and resetting) the page. */}
          <main className="page" id="main" key={section}>
            {section === 'vault' && <VaultPage />}
            {section === 'inbound' && <InboundPage />}
            {section === 'support' && <SupportPage suspended={suspended} />}
            {section === 'wallet' && <WalletPage />}
            {section === 'marketplace' && <MarketplacePage />}
            {section === 'shipping-services' && <ShippingServicesPage />}
            {section === 'faq' && <FaqLegalPage />}
            {section === 'notifications' && (
              <NotificationsPage feed={notifications} onSeen={notifications.markSeen} />
            )}
            {section === 'profile' && <ProfilePage />}
            {section === 'warehouse' && isStaff && <WarehouseConsole />}
            {section === 'admin' && isAdmin && <AdminConsole currentUserId={user.id} />}
          </main>
        </div>
      </div>
    </div>
  );
}

