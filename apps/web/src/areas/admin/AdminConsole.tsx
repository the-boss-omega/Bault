import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { ShelfYieldPanel } from './ShelfYieldPanel';
import { CardPhotoButton } from '../../shared/CardPhoto';
import { BarcodePrintButton } from '../../shared/Barcode';
import { formatDate, formatUsd } from '../../shared/money';
import { useI18n } from '../../shared/i18n';
import type { MessageKey } from '../../shared/i18n';
import { stateLabel } from '../../shared/itemTimeline';
import { NAME_PART_MAX, isValidNamePart, normalizeNamePart } from '../../shared/names';
import { useNavigation, useRoute } from '../../shared/routing';
import {
  Button,
  ContextTabs,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
  TabPanel,
  type StatusTone,
} from '../../shared/ui/primitives';
import { IconBox, IconReceipt, IconUsers } from '../../shared/ui/icons';
import { WalletRequestsSection } from './WalletRequestsSection';
import { HouseStoreSection } from './HouseStoreSection';
import { SignInsSection } from './SignInsSection';
import { AccountingSection } from './AccountingSection';
import { PricingSection } from './PricingSection';
import { DisputesSection } from './DisputesSection';
import { OutboxSection, type ParkedMessage } from './OutboxSection';
import { ConfirmationModal } from '../../shared/ui/DetailDrawer';

interface AdminUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  nameReviewRequired: boolean;
  role: string;
  status: string;
  autoSuspended: boolean;
  intakeId: string | null;
  mfaEnabled: boolean;
}

interface AdminItem {
  id: string;
  serialNumber: string;
  barcode: string;
  typeClass: string;
  description: string;
  conditionGrade: string | null;
  lifecycleState: string;
  holdFlag: boolean;
  binId: string | null;
  ownerId: string;
  ownerEmail: string | null;
}

const ROLES = ['user', 'warehouse_operator', 'admin'];
const STATUSES = ['pending', 'active', 'suspended', 'closed'];
const STATES = ['received', 'stored', 'listed', 'on-hold', 'sold', 'shipped', 'donated', 'consigned'];

const ACCOUNT_STATUS_TONE: Record<string, StatusTone> = {
  active: 'success',
  pending: 'warning',
  suspended: 'error',
  closed: 'neutral',
};

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
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
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

  async function resetMfa(target: AdminUser) {
    setResetBusy(true);
    try {
      const res = await api.post<{ sessionsEnded: number }>(`/admin/users/${target.id}/mfa/reset`);
      setMessage(t('admin.users.mfaResetDone', { email: target.email, count: res.sessionsEnded }));
      setError(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setResetBusy(false);
      setResetting(null);
    }
  }

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
      {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}

      {section === 'yield' && (
        <TabPanel tab="yield">
          <ShelfYieldPanel />
        </TabPanel>
      )}

      {section === 'users' && (
        <TabPanel tab="users">
          <Panel
            title={t('admin.users.heading', { count: users?.length ?? 0 })}
            subtitle={t('admin.users.subtitle')}
            flush
          >
            {users === null ? (
              <SkeletonTable rows={5} columns={5} />
            ) : users.length === 0 ? (
              <EmptyState title={t('admin.users.empty')} icon={<IconUsers />} />
            ) : (
              <div className="dt-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('admin.users.col.email')}</th>
                      <th scope="col">{t('admin.users.col.username')}</th>
                      <th scope="col">{t('admin.users.col.name')}</th>
                      <th scope="col">{t('admin.users.col.role')}</th>
                      <th scope="col">{t('admin.col.status')}</th>
                      <th scope="col" className="td-tight" />
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <UserRow
                        key={u.id}
                        user={u}
                        onSaved={setMessage}
                        onError={setError}
                        onResetMfa={u.mfaEnabled && u.id !== currentUserId ? () => setResetting(u) : undefined}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </TabPanel>
      )}

      {section === 'outbox' && (
        <TabPanel tab="outbox">
          <OutboxSection onMsg={setMessage} onError={setError} onCount={setParkedCount} />
        </TabPanel>
      )}

      {resetting && (
        <ConfirmationModal
          title={t('admin.users.mfaResetTitle')}
          body={<p>{t('admin.users.mfaResetBody', { email: resetting.email })}</p>}
          confirmLabel={t('admin.users.mfaResetConfirm')}
          cancelLabel={t('ui.cancel')}
          tone="danger"
          busy={resetBusy}
          onConfirm={() => void resetMfa(resetting)}
          onCancel={() => setResetting(null)}
        />
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
          <Panel
            title={t('admin.items.heading', { count: items?.length ?? 0 })}
            subtitle={t('admin.items.subtitle')}
            flush
          >
            {items === null ? (
              <SkeletonTable rows={5} columns={6} />
            ) : items.length === 0 ? (
              <EmptyState title={t('admin.items.empty')} icon={<IconBox />} />
            ) : (
              <div className="dt-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('admin.items.col.barcode')}</th>
                      <th scope="col">{t('admin.items.col.description')}</th>
                      <th scope="col">{t('admin.items.col.type')}</th>
                      <th scope="col">{t('admin.items.col.condition')}</th>
                      <th scope="col">{t('admin.items.col.owner')}</th>
                      <th scope="col">{t('admin.items.col.lifecycle')}</th>
                      <th scope="col">{t('admin.items.col.hold')}</th>
                      <th scope="col">{t('admin.items.col.photo')}</th>
                      <th scope="col" className="td-tight" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <ItemRow
                        key={it.id}
                        item={it}
                        users={users ?? []}
                        onSaved={setMessage}
                        onError={setError}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
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

function UserRow({
  user,
  onSaved,
  onError,
  onResetMfa,
}: {
  user: AdminUser;
  onSaved: (m: string) => void;
  onError: (m: string) => void;
  onResetMfa?: () => void;
}) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [saved, setSaved] = useState({
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    role: user.role,
    status: user.status,
    autoSuspended: user.autoSuspended,
    nameReviewRequired: user.nameReviewRequired,
  });

  const namesOk =
    isValidNamePart(normalizeNamePart(firstName)) &&
    (lastName.trim() === '' || isValidNamePart(normalizeNamePart(lastName)));

  const changes: Partial<Record<'firstName' | 'lastName' | 'role' | 'status', string>> = {};
  const confirmName = saved.nameReviewRequired && namesOk;
  if (confirmName || normalizeNamePart(firstName) !== saved.firstName) changes.firstName = normalizeNamePart(firstName);
  if (lastName.trim() && (confirmName || normalizeNamePart(lastName) !== saved.lastName))
    changes.lastName = normalizeNamePart(lastName);
  if (role !== saved.role) changes.role = role;
  if (status !== saved.status) changes.status = status;
  const dirty = Object.keys(changes).length > 0;

  async function send(sent: typeof changes) {
    try {
      const updated = await api.patch<Partial<AdminUser> | null>(`/admin/users/${user.id}`, sent);
      setSaved((s) => ({
        ...s,
        ...sent,
        autoSuspended:
          typeof updated?.autoSuspended === 'boolean' ? updated.autoSuspended : sent.status ? false : s.autoSuspended,
        nameReviewRequired:
          typeof updated?.nameReviewRequired === 'boolean'
            ? updated.nameReviewRequired
            : sent.firstName !== undefined || sent.lastName !== undefined
              ? false
              : s.nameReviewRequired,
      }));
      onSaved(t('admin.users.saved', { email: user.email }));
    } catch (e) {
      onError((e as Error).message);
    }
  }

  async function save() {
    if (dirty) await send({ ...changes });
  }

  async function keepSuspended() {
    setStatus('suspended');
    await send({ status: 'suspended' });
  }

  return (
    <tr>
      <td className="dt-primary">
        <bdi dir="ltr">{user.email}</bdi>
        {user.intakeId && (
          <span className="dt-sub" dir="ltr" title={t('admin.users.legacyIntakeIdTitle')}>
            {user.intakeId}
          </span>
        )}
      </td>
      <td>
        <code dir="ltr">{user.username}</code>
      </td>
      <td>
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'nowrap' }}>
          <input
            value={firstName}
            aria-label={t('auth.firstName')}
            placeholder={t('auth.firstName')}
            maxLength={NAME_PART_MAX}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <input
            value={lastName}
            aria-label={t('auth.lastName')}
            placeholder={t('auth.lastName')}
            maxLength={NAME_PART_MAX}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        {saved.nameReviewRequired && (
          <span className="dt-sub">{t('admin.users.nameReviewRequired')}</span>
        )}
      </td>
      <td>
        <select value={role} aria-label={t('admin.users.col.role')} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`role.${r}` as MessageKey)}
            </option>
          ))}
        </select>
      </td>
      <td>
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'nowrap' }}>
          <StatusBadge tone={ACCOUNT_STATUS_TONE[saved.status] ?? 'neutral'}>
            {t(`account.status.${saved.status}` as MessageKey)}
          </StatusBadge>
          {user.mfaEnabled && (
            <span title={t('admin.users.mfaOnTitle')}>
              <StatusBadge tone="info">{t('admin.users.mfaOn')}</StatusBadge>
            </span>
          )}
          <select
            value={status}
            aria-label={t('admin.col.status')}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`account.status.${s}` as MessageKey)}
              </option>
            ))}
          </select>
        </div>
        {saved.status === 'suspended' && saved.autoSuspended && (
          <>
            <span className="dt-sub">{t('admin.users.autoSuspended')}</span>
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('admin.users.keepSuspendedLabel', { email: user.email })}
              onClick={() => void keepSuspended()}
            >
              {t('admin.users.keepSuspended')}
            </Button>
          </>
        )}
      </td>
      <td className="td-tight">
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'nowrap' }}>
          <Button size="sm" variant={dirty ? 'gold' : 'secondary'} disabled={!namesOk || !dirty} onClick={save}>
            {t('admin.action.save')}
          </Button>
          {onResetMfa && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t('admin.users.mfaResetLabel', { email: user.email })}
              onClick={onResetMfa}
            >
              {t('admin.users.mfaReset')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function ItemRow({
  item,
  users,
  onSaved,
  onError,
}: {
  item: AdminItem;
  users: AdminUser[];
  onSaved: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [description, setDescription] = useState(item.description);
  const [typeClass, setTypeClass] = useState(item.typeClass);
  const [conditionGrade, setConditionGrade] = useState(item.conditionGrade ?? '');
  const [ownerId, setOwnerId] = useState(item.ownerId);
  const [lifecycleState, setLifecycleState] = useState(item.lifecycleState);
  const [holdFlag, setHoldFlag] = useState(item.holdFlag);
  const [saved, setSaved] = useState({
    description: item.description,
    typeClass: item.typeClass,
    conditionGrade: item.conditionGrade ?? '',
    ownerId: item.ownerId,
    lifecycleState: item.lifecycleState,
    holdFlag: item.holdFlag,
  });

  const current = { description, typeClass, conditionGrade, ownerId, lifecycleState, holdFlag };
  const changes: Partial<typeof current> = {};
  for (const f of Object.keys(current) as (keyof typeof current)[]) {
    if (current[f] !== saved[f]) Object.assign(changes, { [f]: current[f] });
  }
  const dirty = Object.keys(changes).length > 0;

  async function save() {
    if (!dirty) return;
    const sent = { ...changes };
    try {
      const updated = await api.patch<{ lifecycleState?: string } | null>(`/admin/items/${item.id}`, sent);
      const state = updated?.lifecycleState ?? sent.lifecycleState ?? saved.lifecycleState;
      setLifecycleState(state);
      setSaved((s) => ({ ...s, ...sent, lifecycleState: state }));
      onSaved(t('admin.items.saved', { barcode: item.barcode }));
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <tr>
      <td>
        <div className="barcode-label" dir="ltr">
          <code>{item.barcode}</code>
          <BarcodePrintButton value={item.barcode} caption={item.description || item.typeClass} />
        </div>
      </td>
      <td>
        <input
          value={description}
          aria-label={t('admin.items.col.description')}
          onChange={(e) => setDescription(e.target.value)}
        />
      </td>
      <td>
        <input
          value={typeClass}
          aria-label={t('admin.items.col.type')}
          onChange={(e) => setTypeClass(e.target.value)}
        />
      </td>
      <td>
        <input
          value={conditionGrade}
          aria-label={t('admin.items.col.condition')}
          onChange={(e) => setConditionGrade(e.target.value)}
          style={{ width: '5rem' }}
        />
      </td>
      <td>
        <select
          value={ownerId}
          aria-label={t('admin.items.col.owner')}
          onChange={(e) => setOwnerId(e.target.value)}
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.email}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          value={lifecycleState}
          aria-label={t('admin.items.col.lifecycle')}
          onChange={(e) => setLifecycleState(e.target.value)}
        >
          {STATES.map((s) => (
            <option key={s} value={s}>
              {stateLabel(t, s)}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="checkbox"
          checked={holdFlag}
          aria-label={t('admin.items.col.hold')}
          onChange={(e) => setHoldFlag(e.target.checked)}
        />
      </td>
      <td>
        <CardPhotoButton serialNumber={item.serialNumber} title={item.description || item.typeClass} />
      </td>
      <td className="td-tight">
        <Button size="sm" variant={dirty ? 'gold' : 'secondary'} disabled={!dirty} onClick={save}>
          {t('admin.action.save')}
        </Button>
      </td>
    </tr>
  );
}

interface FeeRun {
  id: string;
  thresholdDays: number;
  runAt: string;
  chargedItemIds: string[];
  totalAmount: number;
  currency: string;
}

function StorageFeesSection({ onError }: { onError: (m: string) => void }) {
  const { t, locale } = useI18n();
  const [runs, setRuns] = useState<FeeRun[] | null>(null);

  const load = useCallback(async () => {
    try {
      setRuns(await api.get<FeeRun[]>('/admin/storage-fee-runs'));
    } catch (e) {
      onError((e as Error).message);
      setRuns([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <p className="infobox">{t('admin.storage.autoNotice')}</p>

      <Panel title={t('admin.storage.previousRuns', { count: runs?.length ?? 0 })} flush>
        {runs === null ? (
          <SkeletonTable rows={3} columns={4} />
        ) : runs.length === 0 ? (
          <EmptyState title={t('admin.storage.empty')} icon={<IconReceipt />} />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.storage.col.date')}</th>
                  <th scope="col" className="td-end">
                    {t('admin.storage.col.thresholdDays')}
                  </th>
                  <th scope="col" className="td-end">
                    {t('admin.storage.col.chargedItems')}
                  </th>
                  <th scope="col" className="td-end">
                    {t('admin.storage.col.total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td data-label={t('admin.storage.col.date')}>
                      <span className="date">{formatDate(run.runAt, locale)}</span>
                    </td>
                    <td data-label={t('admin.storage.col.thresholdDays')} className="td-end num">
                      {run.thresholdDays}
                    </td>
                    <td data-label={t('admin.storage.col.chargedItems')} className="td-end num">
                      {Array.isArray(run.chargedItemIds) ? run.chargedItemIds.length : 0}
                    </td>
                    <td data-label={t('admin.storage.col.total')} className="td-end num">
                      <span dir="ltr">{formatUsd(run.totalAmount)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
