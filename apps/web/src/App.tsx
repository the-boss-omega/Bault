import { useEffect, useState } from 'react';
import { useI18n, type MessageKey } from './shared/i18n';
import { api } from './shared/api';
import { AuthPage, type SessionUser } from './areas/customer/auth/AuthPage';
import { VaultPage } from './areas/customer/vault/VaultPage';
import { WalletPage } from './areas/customer/finance/WalletPage';
import { MarketplacePage } from './areas/customer/marketplace/MarketplacePage';
import { ServicesPage } from './areas/customer/services/ServicesPage';
import { ShipmentPage } from './areas/customer/shipping/ShipmentPage';
import { NotificationsPage } from './areas/customer/notifications/NotificationsPage';
import { ProfilePage } from './areas/customer/profile/ProfilePage';
import { WarehouseConsole } from './areas/warehouse/WarehouseConsole';
import { AdminConsole } from './areas/admin/AdminConsole';

/**
 * Root component. Auth-gates the app, then shows tabs by role:
 *   - EVERYONE (user / warehouse_operator / admin) can do everything a collector
 *     can: vault, wallet, marketplace, services, shipping.
 *   - staff (warehouse_operator / admin) ALSO get the warehouse console.
 *   - the manager (admin) ALSO gets the admin console (manage all users + cards).
 * A logout button revokes the session and returns to login. (No calendar anywhere.)
 */
const ROLE_KEY: Record<string, MessageKey> = {
  user: 'role.user',
  warehouse_operator: 'role.warehouse_operator',
  admin: 'role.admin',
};

/** Tab order and their labels; role gating is applied at render time. */
const TABS: ReadonlyArray<{ key: string; label: MessageKey }> = [
  { key: 'vault', label: 'tab.vault' },
  { key: 'wallet', label: 'tab.wallet' },
  { key: 'marketplace', label: 'tab.marketplace' },
  { key: 'services', label: 'tab.services' },
  { key: 'shipping', label: 'tab.shipping' },
  { key: 'notifications', label: 'tab.notifications' },
  { key: 'profile', label: 'tab.profile' },
];

export default function App() {
  const { t, toggleLocale } = useI18n();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tab, setTab] = useState<string>(() => localStorage.getItem('bault.tab') ?? 'vault');
  const [booting, setBooting] = useState(true);

  // Restore the session on load: the httpOnly cookie survives a refresh, so ask the
  // API who we are. This keeps the user signed in (and on their last tab) after F5.
  useEffect(() => {
    void (async () => {
      try {
        const me = await api.get<{ id: string; role: string }>('/me/profile');
        setUser({ id: me.id, role: me.role });
      } catch {
        setUser(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // Persist the active tab so a refresh returns to the same page.
  useEffect(() => {
    localStorage.setItem('bault.tab', tab);
  }, [tab]);

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore — clear local state regardless */
    }
    setUser(null);
    setTab('vault');
    localStorage.removeItem('bault.tab');
  }

  if (booting) {
    return (
      <main>
        <header className="app-bar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">🗄️</span>
            <h1>{t('app.title')}</h1>
          </div>
          <span className="spacer" />
          <button className="btn btn--ghost" onClick={toggleLocale} aria-label={t('app.switchLanguageLabel')}>
            {t('app.switchLanguage')}
          </button>
        </header>
        <p className="hint">{t('app.loading')}</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main>
        <header className="app-bar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">🗄️</span>
            <h1>{t('app.title')}</h1>
          </div>
          <span className="spacer" />
          <button className="btn btn--ghost" onClick={toggleLocale} aria-label={t('app.switchLanguageLabel')}>
            {t('app.switchLanguage')}
          </button>
        </header>
        <AuthPage
          onSignedIn={(u) => {
            setUser(u);
            setTab(u.role === 'admin' ? 'admin' : u.role === 'warehouse_operator' ? 'warehouse' : 'vault');
          }}
        />
      </main>
    );
  }

  const isStaff = user.role === 'warehouse_operator' || user.role === 'admin';
  const isAdmin = user.role === 'admin';
  // Fall back if a persisted tab isn't allowed for this role (e.g. a collector's
  // saved 'admin' tab), so a refresh never lands on a blank screen.
  const activeTab = (tab === 'warehouse' && !isStaff) || (tab === 'admin' && !isAdmin) ? 'vault' : tab;
  // An unrecognised role falls back to showing the raw role string.
  const roleKey = ROLE_KEY[user.role];
  const roleLabel = roleKey ? t(roleKey) : user.role;

  return (
    <main>
      <header className="app-bar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">🗄️</span>
          <h1>Bault</h1>
        </div>
        <span className="spacer" />
        <span className="role-chip">
          {t('app.signedInAs', { role: roleLabel })}
        </span>
        <button className="btn btn--ghost" onClick={toggleLocale} aria-label={t('app.switchLanguageLabel')}>
          {t('app.switchLanguage')}
        </button>
        <button className="btn btn--ghost" onClick={logout}>{t('app.logout')}</button>
      </header>
      <nav className="tabs">
        {/* Collector features — available to every role. */}
        {TABS.map((tb) => (
          <button
            key={tb.key}
            className={`tab${activeTab === tb.key ? ' is-active' : ''}`}
            onClick={() => setTab(tb.key)}
          >
            {t(tb.label)}
          </button>
        ))}
        {isStaff && <button className={`tab${activeTab ==='warehouse' ? ' is-active' : ''}`} onClick={() => setTab('warehouse')}>{t('tab.warehouse')}</button>}
        {isAdmin && <button className={`tab${activeTab ==='admin' ? ' is-active' : ''}`} onClick={() => setTab('admin')}>{t('tab.admin')}</button>}
      </nav>

      {activeTab ==='vault' && <VaultPage />}
      {activeTab ==='wallet' && <WalletPage />}
      {activeTab ==='marketplace' && <MarketplacePage />}
      {activeTab ==='services' && <ServicesPage />}
      {activeTab ==='shipping' && <ShipmentPage />}
      {activeTab ==='notifications' && <NotificationsPage />}
      {activeTab ==='profile' && <ProfilePage />}
      {activeTab ==='warehouse' && isStaff && <WarehouseConsole />}
      {activeTab ==='admin' && isAdmin && <AdminConsole />}
    </main>
  );
}
