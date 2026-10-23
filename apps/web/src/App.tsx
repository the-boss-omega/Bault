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
  IconShield,
  IconShippingServices,
  IconVault,
  IconWallet,
  IconWarehouse,
} from './shared/ui/icons';
import { AuthPage, AuthShell, type AuthMode, type SessionUser } from './areas/customer/auth/AuthPage';
import { mustEnrolSecondFactor } from './shared/twoFactor';
import { ForcedEnrollmentPage } from './areas/customer/auth/ForcedEnrollmentPage';
import { LandingPage } from './areas/customer/marketing/LandingPage';
import { MembershipPage } from './areas/customer/membership/MembershipPage';
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

const ROLE_KEY: Record<string, MessageKey> = {
  user: 'role.user',
  warehouse_operator: 'role.warehouse_operator',
  admin: 'role.admin',
};

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
  { key: 'inbound', labelKey: 'tab.inbound', titleKey: 'inbound.title', icon: <IconInbox /> },
  { key: 'wallet', labelKey: 'tab.wallet', titleKey: 'wallet.title', icon: <IconWallet /> },
  { key: 'membership', labelKey: 'tab.membership', titleKey: 'membership.title', icon: <IconShield /> },
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

type BootState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'ready'; user: SessionUser }
  | { status: 'blocked'; messageKey: MessageKey; detail: string | null };

const TOKEN_ROUTES = ['verify-email', 'reset-password'] as const;

const AUTH_ROUTES: Record<string, AuthMode> = {
  signin: 'signIn',
  signup: 'signUp',
  forgot: 'forgot',
};

const LANDING_ROUTES = ['', 'welcome'];

export default function App() {
  const { t } = useI18n();
  const route = useRoute();
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });

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

  if ((TOKEN_ROUTES as readonly string[]).includes(route.section)) {
    const token = route.params.token ?? null;
    return (
      <AuthShell bare>
        {route.section === 'verify-email' ? (
          <VerifyEmailPage token={token} />
        ) : (
          <ResetPasswordPage token={token} />
        )}
      </AuthShell>
    );
  }

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
          resetProfileRequest();
          void loadSession().catch(() => undefined);
        }}
      />
    );
  }

  if (mustEnrolSecondFactor(boot.user)) {
    return (
      <ForcedEnrollmentPage
        onEnrolled={() => {
          resetProfileRequest();
          void probeSession();
        }}
        onSignOut={() => {
          void api
            .post('/auth/logout')
            .catch(() => undefined)
            .finally(() => {
              clearLastVisitedSection();
              resetProfileRequest();
              setBoot({ status: 'anonymous' });
            });
        }}
      />
    );
  }

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
  const suspended = user.status === 'suspended';

  const allowed = useMemo(
    () =>
      SECTIONS.filter((s) => {
        if (suspended) return s.key === 'support';
        return !s.requires || (s.requires === 'staff' && isStaff) || (s.requires === 'admin' && isAdmin);
      }),
    [isStaff, isAdmin, suspended],
  );

  const fallback = suspended ? 'support' : isAdmin ? 'admin' : isStaff ? 'warehouse' : 'vault';
  const requested = route.section || lastVisitedSection() || fallback;
  const known = (!suspended && requested === 'profile') || allowed.some((s) => s.key === requested);
  const section = known ? requested : fallback;

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
  const tabKey = route.tab ? `${TAB_PREFIX[section] ?? ''}${route.tab}` : '';

  useEffect(() => {
    document.title = `${pageTitle} · Bault`;
    return () => {
      document.title = 'Bault';
    };
  }, [pageTitle]);

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
    }
    clearLastVisitedSection();
    navigate({ section: 'vault' }, { replace: true });
    onSignedOut();
  }

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

          <main className="page" id="main" key={section}>
            {section === 'vault' && <VaultPage />}
            {section === 'inbound' && <InboundPage />}
            {section === 'support' && <SupportPage suspended={suspended} />}
            {section === 'wallet' && <WalletPage />}
            {section === 'membership' && <MembershipPage />}
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

