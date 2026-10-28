import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { ShelfYieldPanel } from './ShelfYieldPanel';
import { useI18n } from '../../shared/i18n';
import type { MessageKey } from '../../shared/i18n';
import { useNavigation, useRoute } from '../../shared/routing';
import { ContextTabs, ErrorState, SuccessNote, TabPanel } from '../../shared/ui/primitives';
import { WalletRequestsSection } from './WalletRequestsSection';
import { HouseStoreSection } from './HouseStoreSection';
import { SignInsSection } from './SignInsSection';
import { AccountingSection } from './AccountingSection';
import { PricingSection } from './PricingSection';
import { DisputesSection } from './DisputesSection';
import { UsersSection, type AdminUser } from './UsersSection';
import { ItemsSection, type AdminItem } from './ItemsSection';
import { StorageFeesSection } from './StorageFeesSection';
import { OutboxSection, type ParkedMessage } from './OutboxSection';

const TABS = [
  'yield',
  'users',
  'signins',
  'outbox',
  'requests',
  'accounting',
  'items',
  'house',
  'pricing',
  'disputes',
  'storage',
] as const;
type SectionKey = (typeof TABS)[number];

const TAB_LABEL: Record<SectionKey, MessageKey> = {
  yield: 'admin.section.yield',
  users: 'admin.section.users',
  signins: 'admin.section.signins',
  outbox: 'admin.section.outbox',
  requests: 'admin.section.requests',
  accounting: 'admin.section.accounting',
  items: 'admin.section.items',
  house: 'admin.section.house',
  pricing: 'admin.section.pricing',
  disputes: 'admin.section.disputes',
  storage: 'admin.section.storage',
};

export function AdminConsole({ currentUserId }: { currentUserId: string }) {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab } = useNavigation(route);

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [items, setItems] = useState<AdminItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parkedCount, setParkedCount] = useState<number | null>(null);

  const section: SectionKey = (TABS as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as SectionKey)
    : 'yield';

  const load = useCallback(async () => {
    try {
      const [u, i] = await Promise.all([
        api.get<AdminUser[]>('/admin/users'),
        api.get<AdminItem[]>('/admin/items'),
      ]);
      setUsers(u);
      setItems(i);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setUsers([]);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<ParkedMessage[]>('/admin/outbox/parked')
      .then((list) => setParkedCount(list.length))
      .catch(() => setParkedCount(null));
  }, []);

  const tabs = TABS.map((key) => ({
    key,
    label:
      key === 'outbox' && parkedCount
        ? t('admin.section.outboxCount', { count: parkedCount })
        : t(TAB_LABEL[key]),
  }));

  return (
    <>
      <ContextTabs label={t('admin.title')} tabs={tabs} active={section} onSelect={goTab} />

      {message && <SuccessNote>{message}</SuccessNote>}
      {error && (
        <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />
      )}

      {section === 'yield' && (
        <TabPanel tab="yield">
          <ShelfYieldPanel />
        </TabPanel>
      )}

      {section === 'users' && (
        <TabPanel tab="users">
          <UsersSection
            users={users}
            currentUserId={currentUserId}
            onChanged={(saved) =>
              setUsers((list) => list?.map((u) => (u.id === saved.id ? saved : u)) ?? list)
            }
            onSaved={setMessage}
            onError={setError}
          />
        </TabPanel>
      )}

      {section === 'outbox' && (
        <TabPanel tab="outbox">
          <OutboxSection onMsg={setMessage} onError={setError} onCount={setParkedCount} />
        </TabPanel>
      )}

      {section === 'house' && (
        <TabPanel tab="house">
          <HouseStoreSection onMsg={setMessage} onError={setError} />
        </TabPanel>
      )}

      {section === 'requests' && (
        <TabPanel tab="requests">
          <WalletRequestsSection
            currentUserId={currentUserId}
            onMsg={setMessage}
            onError={setError}
          />
        </TabPanel>
      )}

      {section === 'accounting' && (
        <TabPanel tab="accounting">
          <AccountingSection onError={setError} />
        </TabPanel>
      )}

      {section === 'items' && (
        <TabPanel tab="items">
          <ItemsSection
            items={items}
            users={users ?? []}
            onChanged={(saved) =>
              setItems((list) => list?.map((i) => (i.id === saved.id ? saved : i)) ?? list)
            }
            onSaved={setMessage}
            onError={setError}
          />
        </TabPanel>
      )}

      {section === 'pricing' && (
        <TabPanel tab="pricing">
          <PricingSection onMsg={setMessage} onError={setError} />
        </TabPanel>
      )}

      {section === 'disputes' && (
        <TabPanel tab="disputes">
          <DisputesSection onMsg={setMessage} onError={setError} />
        </TabPanel>
      )}

      {section === 'signins' && (
        <TabPanel tab="signins">
          <SignInsSection onError={setError} />
        </TabPanel>
      )}

      {section === 'storage' && (
        <TabPanel tab="storage">
          <StorageFeesSection onError={setError} />
        </TabPanel>
      )}
    </>
  );
}
