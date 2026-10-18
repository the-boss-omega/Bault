import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { ShelfYieldPanel } from './ShelfYieldPanel';
import { CardPhotoButton } from '../../shared/CardPhoto';
import { BarcodePrintButton } from '../../shared/Barcode';
import { dollarsToCents, formatDate, formatUsd } from '../../shared/money';
import { useI18n } from '../../shared/i18n';
import type { MessageKey } from '../../shared/i18n';
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
import { IconBox, IconGavel, IconPlus, IconReceipt, IconUsers } from '../../shared/ui/icons';
import { WalletRequestsSection } from './WalletRequestsSection';
import { HouseStoreSection } from './HouseStoreSection';
import { SignInsSection } from './SignInsSection';
import { AccountingSection } from './AccountingSection';
import { PricingCoveragePanel, type PricingCoverage } from './PricingCoveragePanel';
import type { MembershipTier, TierCatalogue } from '../../shared/membership';
import { OutboxSection, type ParkedMessage } from './OutboxSection';
import { ConfirmationModal } from '../../shared/ui/DetailDrawer';

/**
 * `GET /admin/users`.
 *
 * `intakeId` appears here and only here, read-only. No customer workflow uses
 * it, but a manager troubleshooting a parcel that arrived with an old
 * pre-printed OW- label needs to be able to look it up.
 */
interface AdminUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  /** Migrated legacy name whose split was a guess nobody has confirmed yet. */
  nameReviewRequired: boolean;
  role: string;
  status: string;
  /**
   * Suspended by the debt sweep, which lifts it once the balance is paid. Any
   * status an administrator sets, `suspended` again included, makes it theirs.
   */
  autoSuspended: boolean;
  intakeId: string | null;
  /** Signs in with a second factor, and so has one an administrator can reset. */
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

/**
 * `yield` sits first, before the management tables.
 *
 * The others are opened by an administrator who already knows what they came to
 * do (find a user, settle a dispute, change a price). Shelf Yield is the one
 * that tells them what to do, so it is what the section opens on.
 */
const TABS = [
  'yield',
  'users',
  'signins',
  // Beside the sign-in log: the other screen about the platform's own health
  // rather than its customers'.
  'outbox',
  'requests',
  // Beside the wallet requests: the other screen about money, and the one an
  // accountant's questions are answered from.
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

/**
 * Management console (the admin area, presented as "Management" in the UI while
 * keeping the `admin` route key and permissions internally).
 *
 * Sub-sections are contextual tabs on the shared shell: users and items are
 * inline-editable tables, pricing rules and disputes are managed here, and
 * storage-fee billing is read-only because it is fully automatic (Req 12.2).
 */
export function AdminConsole({ currentUserId }: { currentUserId: string }) {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab } = useNavigation(route);

  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [items, setItems] = useState<AdminItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The account whose second factor is about to be reset, while the confirmation is open. */
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  /**
   * How many outbox messages are parked, on the tab itself.
   *
   * A parked message is a notification or a reset link somebody did not get,
   * and it waits for a person, so the count shows without opening the tab. Read
   * once when the console opens, and kept current by the section when it
   * requeues.
   */
  const [parkedCount, setParkedCount] = useState<number | null>(null);

  // Opens on Shelf Yield; see the comment on `TABS`.
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

  // Apart from `load`: the count is a convenience, and a failure to read it
  // must not take the users and items tables down with it.
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
                        // Somebody else's, and only where there is one to reset.
                        // The API refuses one's own regardless.
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
          {/* `currentUserId` lets the queue mark the reviewer's own requests as
              undecidable by them. The API enforces it regardless. */}
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

/* ============================================================
   Users
   ============================================================ */

/**
 * One editable user row.
 *
 * The username column is text, not an input: a username is permanent, the API
 * has no field to change it, and the database trigger installed by migration
 * 0004 rejects the write outright.
 *
 * The name is two inputs, and saving them clears the migration's review flag:
 * an admin who edits a flagged name has, by doing so, reviewed it.
 */
function UserRow({
  user,
  onSaved,
  onError,
  onResetMfa,
}: {
  user: AdminUser;
  onSaved: (m: string) => void;
  onError: (m: string) => void;
  /** Present only when this administrator may reset this account's second factor. */
  onResetMfa?: () => void;
}) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  /** What the server holds, as of the list or this row's last save. */
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

  /**
   * Only what the administrator changed.
   *
   * The server reads every field it receives as a decision: a status sent with
   * a name correction would clear the debt sweep's marker on an account the
   * sweep suspended, and the sweep would never lift it.
   */
  const changes: Partial<Record<'firstName' | 'lastName' | 'role' | 'status', string>> = {};
  // A flagged name is confirmed by sending it, changed or not: the server
  // clears the review flag only when a name part arrives.
  const confirmName = saved.nameReviewRequired && namesOk;
  if (confirmName || normalizeNamePart(firstName) !== saved.firstName) changes.firstName = normalizeNamePart(firstName);
  // A blank last name is left as it is, never sent as a value.
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
        // A status sent, even the one the account had, clears the sweep's marker.
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

  /**
   * Take over a suspension the debt sweep imposed, so the sweep does not lift
   * it when the balance is paid. Exactly the status, which the server reads as
   * an administrator's decision; anything else typed into the row stays unsent.
   */
  async function keepSuspended() {
    setStatus('suspended');
    await send({ status: 'suspended' });
  }

  return (
    <tr>
      <td dir="ltr" className="dt-primary">
        {user.email}
        {user.intakeId && (
          <span className="dt-sub" dir="ltr" title={t('admin.users.legacyIntakeIdTitle')}>
            {user.intakeId}
          </span>
        )}
      </td>
      <td dir="ltr">
        <code>{user.username}</code>
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
              {r}
            </option>
          ))}
        </select>
      </td>
      <td>
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'nowrap' }}>
          <StatusBadge tone={ACCOUNT_STATUS_TONE[saved.status] ?? 'neutral'}>{saved.status}</StatusBadge>
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
                {s}
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

/* ============================================================
   Items
   ============================================================ */

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
  /** What the server holds, as of the list or this row's last save. */
  const [saved, setSaved] = useState({
    description: item.description,
    typeClass: item.typeClass,
    conditionGrade: item.conditionGrade ?? '',
    ownerId: item.ownerId,
    lifecycleState: item.lifecycleState,
    holdFlag: item.holdFlag,
  });

  /**
   * Only what the administrator changed, as for a user row: an unchanged empty
   * grade sent back would write "" over a card with none.
   */
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
      // The server may move the state itself (an owner change takes a listed
      // card back to `stored`), so the row shows the state it answered with.
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
      <td dir="ltr">
        <div className="barcode-label">
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
              {s}
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

/* ============================================================
   Pricing rules (ADM-02 / PRC-02)
   ============================================================ */

interface PricingRule {
  id: string;
  actionType: string;
  itemClass: string | null;
  description: string | null;
  model: string;
  value: number;
  currency: string;
  billingTrigger: string;
  effectiveFrom: string;
}

const BILLING_TRIGGERS = ['per_event', 'daily', 'weekly', 'monthly'];
const BILLING_LABEL: Record<string, MessageKey> = {
  per_event: 'admin.pricing.billing.perEvent',
  daily: 'admin.pricing.billing.daily',
  weekly: 'admin.pricing.billing.weekly',
  monthly: 'admin.pricing.billing.monthly',
};

/**
 * The actions a rule can be written for are the API's own catalogue, read from
 * the coverage check (`billable-actions.ts`) rather than listed here, so every
 * price the check reports missing can be loaded from this screen. These labels
 * are only for the actions that have one; the rest show their key.
 */
const ACTION_LABEL: Record<string, MessageKey> = {
  intake: 'admin.pricing.action.intake',
  storage: 'admin.pricing.action.storage',
  service: 'admin.pricing.action.service',
  shipping: 'admin.pricing.action.shipping',
  marketplace_fee: 'admin.pricing.action.marketplaceFee',
};
const MODEL_LABEL: Record<string, MessageKey> = {
  fixed: 'admin.pricing.model.fixed',
  percentage: 'admin.pricing.model.percentage',
};

/**
 * What a membership rule carries besides its price: the shape the seed writes.
 *
 * The worker cannot import the tier catalogue, so the storage sweep reads a
 * member's storage allowance (`storedItems`) off the tier's pricing rule. A
 * rule without it covers none of a member's items, and every one of them is
 * billed storage.
 */
function tierRuleParameters(tier: MembershipTier) {
  return {
    storedItems: tier.storedItems,
    insuredShipments: tier.insuredShipments,
    insuredValueCapMinor: tier.insuredValueCapMinor,
    postageCreditMinor: tier.postageCreditMinor,
    commissionWaivedOnMinor: tier.commissionWaivedOnMinor,
  };
}

function PricingSection({
  onMsg,
  onError,
}: {
  onMsg: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [rules, setRules] = useState<PricingRule[] | null>(null);
  /** The coverage check's answer: the actions the form offers. */
  const [coverage, setCoverage] = useState<PricingCoverage | null>(null);
  /** The tiers, for the allowances a membership rule carries. */
  const [tiers, setTiers] = useState<MembershipTier[] | null>(null);
  const [actionType, setActionType] = useState('intake');
  const [itemClass, setItemClass] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState<'fixed' | 'percentage'>('fixed');
  // A flat rule is priced in dollars; a percentage rule is a plain percentage.
  // Both are converted to the minor units / basis points the API stores.
  const [amount, setAmount] = useState('');
  const [billingTrigger, setBillingTrigger] = useState('per_event');
  // Bumped when a rule is added, so the coverage check re-reads what is priced.
  const [coverageKey, setCoverageKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setRules(await api.get<PricingRule[]>('/pricing/rules'));
    } catch (e) {
      onError((e as Error).message);
      setRules([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<TierCatalogue>('/membership/tiers')
      .then((c) => setTiers(c.tiers))
      .catch((e: Error) => onError(e.message));
  }, [onError]);

  const value = model === 'fixed' ? dollarsToCents(amount) : percentToBasisPoints(amount);
  const catalogue = coverage?.actions ?? [];
  const selected = catalogue.find((a) => a.actionType === actionType) ?? null;
  const tier = tiers?.find((x) => x.feeActionType === actionType) ?? null;
  // Both catalogues first: without the tiers, a membership rule would be
  // written without the allowances the storage sweep reads.
  const ready = selected !== null && tiers !== null;

  async function create() {
    if (value === null || !ready) return;
    try {
      await api.post('/pricing/rules', {
        actionType,
        itemClass: itemClass || undefined,
        description,
        model,
        value,
        billingTrigger,
        ...(tier ? { parameters: tierRuleParameters(tier) } : {}),
      });
      onMsg(t('admin.pricing.created'));
      setAmount('');
      setItemClass('');
      setDescription('');
      setBillingTrigger('per_event');
      setCoverageKey((k) => k + 1);
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <>
      {/* First, because "is anything unpriced?" is the question to answer
          before launch, and before adding a rule to fix it. */}
      <PricingCoveragePanel refreshKey={coverageKey} onError={onError} onLoaded={setCoverage} />

      <Panel title={t('admin.pricing.newRule')} subtitle={t('admin.pricing.newRuleSubtitle')}>
        <div className="stack stack--tight">
          <div className="form-grid">
            <label className="field">
              <span className="field-label">{t('admin.pricing.col.description')}</span>
              <input
                placeholder={t('admin.pricing.descriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('admin.pricing.col.action')}</span>
              <select value={actionType} onChange={(e) => setActionType(e.target.value)}>
                {/* Apart: a rule for a code constant is only published. */}
                {(
                  [
                    ['admin.pricing.group.charged', catalogue.filter((a) => a.resolution !== 'code_constant')],
                    ['admin.pricing.group.published', catalogue.filter((a) => a.resolution === 'code_constant')],
                  ] as const
                ).map(([label, actions]) =>
                  actions.length === 0 ? null : (
                    <optgroup key={label} label={t(label)}>
                      {actions.map((a) => {
                        const key = ACTION_LABEL[a.actionType];
                        return (
                          <option key={a.actionType} value={a.actionType}>
                            {key ? t(key) : a.actionType}
                          </option>
                        );
                      })}
                    </optgroup>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t('admin.pricing.col.class')}</span>
              <input
                placeholder={t('admin.pricing.itemClassPlaceholder')}
                value={itemClass}
                onChange={(e) => setItemClass(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('admin.pricing.col.model')}</span>
              <select value={model} onChange={(e) => setModel(e.target.value as 'fixed' | 'percentage')}>
                <option value="fixed">{t('admin.pricing.model.fixed')}</option>
                <option value="percentage">{t('admin.pricing.model.percentage')}</option>
              </select>
            </label>
            <div className="field">
              <label className="field-label" htmlFor="rule-value">
                {model === 'fixed' ? t('admin.pricing.amountLabel') : t('admin.pricing.percentLabel')}
              </label>
              <div className="money-input">
                <span aria-hidden="true">{model === 'fixed' ? '$' : '%'}</span>
                <input
                  id="rule-value"
                  inputMode="decimal"
                  dir="ltr"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>
            <label className="field">
              <span className="field-label">{t('admin.pricing.col.billing')}</span>
              <select value={billingTrigger} onChange={(e) => setBillingTrigger(e.target.value)}>
                {BILLING_TRIGGERS.map((b) => {
                  const key = BILLING_LABEL[b];
                  return (
                    <option key={b} value={b}>
                      {key ? t(key) : b}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          <p className="field-hint">{t('admin.pricing.billingHint')}</p>
          {tier && (
            <p className="field-hint">{t('admin.pricing.tierHint', { count: tier.storedItems })}</p>
          )}
          {selected?.resolution === 'code_constant' && (
            <p className="field-hint">{t('admin.pricing.publishedHint')}</p>
          )}

          <div className="row">
            <Button
              variant="gold"
              icon={<IconPlus />}
              disabled={value === null || description.trim() === '' || !ready}
              onClick={create}
            >
              {t('admin.pricing.addRule')}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title={t('admin.pricing.heading', { count: rules?.length ?? 0 })} flush>
        {rules === null ? (
          <SkeletonTable rows={4} columns={6} />
        ) : rules.length === 0 ? (
          <EmptyState title={t('admin.pricing.empty')} icon={<IconReceipt />} />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.pricing.col.description')}</th>
                  <th scope="col">{t('admin.pricing.col.action')}</th>
                  <th scope="col">{t('admin.pricing.col.class')}</th>
                  <th scope="col">{t('admin.pricing.col.model')}</th>
                  <th scope="col" className="td-end">
                    {t('admin.pricing.col.value')}
                  </th>
                  <th scope="col">{t('admin.pricing.col.billing')}</th>
                  <th scope="col">{t('admin.pricing.col.effectiveFrom')}</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const actionKey = ACTION_LABEL[rule.actionType];
                  const modelKey = MODEL_LABEL[rule.model];
                  const billingKey = BILLING_LABEL[rule.billingTrigger];
                  return (
                    <tr key={rule.id}>
                      <td data-label={t('admin.pricing.col.description')} className="dt-primary">
                        {rule.description ?? '—'}
                      </td>
                      <td data-label={t('admin.pricing.col.action')}>
                        {actionKey ? t(actionKey) : rule.actionType}
                      </td>
                      <td data-label={t('admin.pricing.col.class')}>
                        {rule.itemClass ?? t('admin.pricing.allClasses')}
                      </td>
                      <td data-label={t('admin.pricing.col.model')}>
                        <StatusBadge tone="info">{modelKey ? t(modelKey) : rule.model}</StatusBadge>
                      </td>
                      <td data-label={t('admin.pricing.col.value')} className="td-end num">
                        <span dir="ltr">
                          {rule.model === 'fixed' ? formatUsd(rule.value) : `${(rule.value / 100).toFixed(2)}%`}
                        </span>
                      </td>
                      <td data-label={t('admin.pricing.col.billing')}>
                        {billingKey ? t(billingKey) : rule.billingTrigger}
                      </td>
                      <td data-label={t('admin.pricing.col.effectiveFrom')}>
                        <span dir="ltr">{formatDate(rule.effectiveFrom, locale)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

/** "2.5" → 250 basis points. Null for anything that isn't a positive number. */
function percentToBasisPoints(input: string): number | null {
  const cleaned = input.trim().replace(/[%\s]/g, '');
  if (cleaned === '' || !/^\d*\.?\d{0,2}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/* ============================================================
   Disputes (ADM-04)
   ============================================================ */

interface Dispute {
  id: string;
  transactionId: string;
  status: string;
  ruling: string | null;
  note: string | null;
  createdAt: string;
}

const DISPUTE_STATUSES = ['open', 'investigating', 'ruled', 'closed'];
const DISPUTE_LABEL: Record<string, MessageKey> = {
  open: 'admin.disputes.status.open',
  investigating: 'admin.disputes.status.investigating',
  ruled: 'admin.disputes.status.ruled',
  closed: 'admin.disputes.status.closed',
};
const DISPUTE_TONE: Record<string, StatusTone> = {
  open: 'warning',
  investigating: 'info',
  ruled: 'success',
  closed: 'neutral',
};

interface AdminTransaction {
  id: string;
  type: string;
  price: number;
  buyerId: string | null;
  sellerId: string | null;
  createdAt: string;
}

function DisputesSection({
  onMsg,
  onError,
}: {
  onMsg: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [transactionId, setTransactionId] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, tx] = await Promise.all([
        api.get<Dispute[]>('/admin/disputes'),
        api.get<AdminTransaction[]>('/admin/transactions'),
      ]);
      setDisputes(d);
      setTransactions(tx);
    } catch (e) {
      onError((e as Error).message);
      setDisputes([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open() {
    try {
      await api.post('/admin/disputes', { transactionId, note: note || undefined });
      onMsg(t('admin.disputes.opened'));
      setTransactionId('');
      setNote('');
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <>
      <Panel title={t('admin.disputes.openLegend')} subtitle={t('admin.disputes.subtitle')}>
        {transactions.length === 0 ? (
          <EmptyState title={t('admin.disputes.noTransactions')} icon={<IconGavel />} />
        ) : (
          <div className="stack stack--tight" style={{ maxWidth: 620 }}>
            {/* A dispute must reference an actual recorded transaction, picked here. */}
            <label className="field">
              <span className="field-label">{t('admin.disputes.col.transaction')}</span>
              <select value={transactionId} onChange={(e) => setTransactionId(e.target.value)} dir="ltr">
                <option value="">{t('admin.disputes.selectTransaction')}</option>
                {transactions.map((tx) => (
                  <option key={tx.id} value={tx.id}>
                    {tx.id.slice(0, 8)} — {tx.type} — {formatUsd(tx.price)} — {tx.createdAt.slice(0, 10)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t('admin.disputes.notePlaceholder')}</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="row">
              <Button variant="gold" icon={<IconGavel />} disabled={!transactionId} onClick={open}>
                {t('admin.disputes.openButton')}
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <Panel title={t('admin.disputes.heading', { count: disputes?.length ?? 0 })} flush>
        {disputes === null ? (
          <SkeletonTable rows={3} columns={5} />
        ) : disputes.length === 0 ? (
          <EmptyState title={t('admin.disputes.empty')} icon={<IconGavel />} />
        ) : (
          <div className="dt-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.disputes.col.id')}</th>
                  <th scope="col">{t('admin.disputes.col.transaction')}</th>
                  <th scope="col">{t('admin.col.status')}</th>
                  <th scope="col">{t('admin.disputes.col.ruling')}</th>
                  <th scope="col">{t('admin.disputes.col.update')}</th>
                  <th scope="col" className="td-tight" />
                </tr>
              </thead>
              <tbody>
                {disputes.map((d) => (
                  <DisputeRow
                    key={d.id}
                    dispute={d}
                    onSaved={async (m) => {
                      onMsg(m);
                      await load();
                    }}
                    onError={onError}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function DisputeRow({
  dispute,
  onSaved,
  onError,
}: {
  dispute: Dispute;
  onSaved: (m: string) => Promise<void>;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState(dispute.status);
  const [ruling, setRuling] = useState(dispute.ruling ?? '');

  async function save() {
    try {
      await api.patch(`/admin/disputes/${dispute.id}`, { status, ruling: ruling || undefined });
      await onSaved(t('admin.disputes.updated'));
    } catch (e) {
      onError((e as Error).message);
    }
  }

  const currentLabel = DISPUTE_LABEL[dispute.status];

  return (
    <tr>
      <td dir="ltr">
        <code>{dispute.id.slice(0, 8)}</code>
      </td>
      <td dir="ltr">
        <code>{dispute.transactionId.slice(0, 8)}</code>
      </td>
      <td>
        <StatusBadge tone={DISPUTE_TONE[dispute.status] ?? 'neutral'}>
          {currentLabel ? t(currentLabel) : dispute.status}
        </StatusBadge>
      </td>
      <td>{dispute.ruling ?? '—'}</td>
      <td>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <select
            value={status}
            aria-label={t('admin.col.status')}
            onChange={(e) => setStatus(e.target.value)}
          >
            {DISPUTE_STATUSES.map((s) => {
              const key = DISPUTE_LABEL[s];
              return (
                <option key={s} value={s}>
                  {key ? t(key) : s}
                </option>
              );
            })}
          </select>
          <input
            placeholder={t('admin.disputes.col.ruling')}
            aria-label={t('admin.disputes.col.ruling')}
            value={ruling}
            onChange={(e) => setRuling(e.target.value)}
          />
        </div>
      </td>
      <td className="td-tight">
        <Button size="sm" variant="secondary" onClick={save}>
          {t('admin.disputes.updateButton')}
        </Button>
      </td>
    </tr>
  );
}

/* ============================================================
   Storage-fee runs (VLT-04): read-only; billing is fully automatic
   ============================================================ */

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
      {/* Billing is fully automatic: the worker's storage sweep bills each item's
          elapsed periods after its included period. There is no manual trigger. */}
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
                      <span dir="ltr">{formatDate(run.runAt, locale)}</span>
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
