import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { ShelfYieldPanel } from './ShelfYieldPanel';
import { dollarsToCents, formatDate, formatUsd } from '../../shared/money';
import { useI18n } from '../../shared/i18n';
import type { MessageKey, TranslateFn } from '../../shared/i18n';
import { ITEM_CLASSES, itemClassLabel } from '../../shared/itemClasses';
import { actionLabel } from '../../shared/pricingActions';
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
import { IconGavel, IconPlus, IconReceipt } from '../../shared/ui/icons';
import { WalletRequestsSection } from './WalletRequestsSection';
import { ItemsSection, UsersSection, type AdminItem, type AdminUser } from './PeopleAndItems';
import { HouseStoreSection } from './HouseStoreSection';
import { SignInsSection } from './SignInsSection';
import { ChargebacksSection } from './ChargebacksSection';

/**
 * `yield` sits FIRST, before the management tables.
 *
 * The others are opened by an administrator who already knows what they came to
 * do — find a user, settle a dispute, change a price. Shelf Yield is the one
 * that tells them what to do, so it is what the section opens on.
 */
const TABS = ['yield', 'users', 'signins', 'requests', 'items', 'house', 'pricing', 'disputes', 'chargebacks', 'storage'] as const;
type SectionKey = (typeof TABS)[number];

const TAB_LABEL: Record<SectionKey, MessageKey> = {
  yield: 'admin.section.yield',
  users: 'admin.section.users',
  signins: 'admin.section.signins',
  requests: 'admin.section.requests',
  items: 'admin.section.items',
  house: 'admin.section.house',
  pricing: 'admin.section.pricing',
  disputes: 'admin.section.disputes',
  chargebacks: 'admin.section.chargebacks',
  storage: 'admin.section.storage',
};

/**
 * Management console (the admin area, presented as "Management" in the UI while
 * keeping the `admin` route key and permissions internally).
 *
 * Sub-sections are contextual tabs on the shared shell — users and items are
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
  /** An action that failed. Shown without a retry: retrying reloads lists, not the action. */
  const [error, setError] = useState<string | null>(null);
  /** The lists themselves failed to load; this one can be retried. */
  const [loadError, setLoadError] = useState<string | null>(null);

  // Opens on Shelf Yield, as the comment on `TABS` has always said it does. The
  // code said `users`, so the section an administrator was meant to land on was
  // one click away instead of in front of them.
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
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setUsers([]);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A banner belongs to the tab it was raised on. "Saved." from the store
  // stayed up on Pricing, and a success and a later error could show together.
  useEffect(() => {
    setMessage(null);
    setError(null);
  }, [section]);

  const say = useCallback((m: string) => {
    setError(null);
    setMessage(m);
  }, []);
  const fail = useCallback((m: string) => {
    setMessage(null);
    setError(m);
  }, []);

  const tabs = TABS.map((key) => ({ key, label: t(TAB_LABEL[key]) }));

  return (
    <>
      <ContextTabs label={t('admin.title')} tabs={tabs} active={section} onSelect={goTab} />

      {message && <SuccessNote>{message}</SuccessNote>}
      {error && <ErrorState message={error} />}
      {loadError && <ErrorState message={loadError} onRetry={() => void load()} retryLabel={t('ui.retry')} />}

      {section === 'yield' && (
        <TabPanel tab="yield">
          <ShelfYieldPanel />
        </TabPanel>
      )}

      {section === 'users' && (
        <TabPanel tab="users">
          <UsersSection
            users={users}
            onMsg={say}
            onChanged={(next) => setUsers((prev) => prev?.map((u) => (u.id === next.id ? next : u)) ?? prev)}
          />
        </TabPanel>
      )}

      {section === 'house' && (
        <TabPanel tab="house">
          <HouseStoreSection onMsg={say} onError={fail} />
        </TabPanel>
      )}

      {section === 'requests' && (
        <TabPanel tab="requests">
          {/* `currentUserId` is what lets the queue mark the reviewer's OWN
              requests as undecidable by them. The API enforces it regardless. */}
          <WalletRequestsSection
            currentUserId={currentUserId}
            onMsg={say}
            onError={fail}
          />
        </TabPanel>
      )}

      {section === 'items' && (
        <TabPanel tab="items">
          <ItemsSection items={items} users={users ?? []} onMsg={say} onChanged={() => void load()} />
        </TabPanel>
      )}

      {section === 'pricing' && (
        <TabPanel tab="pricing">
          <PricingSection onMsg={say} onError={fail} />
        </TabPanel>
      )}

      {section === 'disputes' && (
        <TabPanel tab="disputes">
          <DisputesSection onMsg={say} onError={fail} />
        </TabPanel>
      )}

      {section === 'chargebacks' && (
        <TabPanel tab="chargebacks">
          <ChargebacksSection onMsg={say} />
        </TabPanel>
      )}

      {section === 'signins' && (
        <TabPanel tab="signins">
          <SignInsSection onError={fail} />
        </TabPanel>
      )}

      {section === 'storage' && (
        <TabPanel tab="storage">
          <StorageFeesSection onError={fail} />
        </TabPanel>
      )}
    </>
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

const MODEL_LABEL: Record<string, MessageKey> = {
  fixed: 'admin.pricing.model.fixed',
  percentage: 'admin.pricing.model.percentage',
};

function PricingSection({
  onMsg,
  onError,
}: {
  onMsg: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [rules, setRules] = useState<PricingRule[] | null>(null);
  const [actionType, setActionType] = useState('intake');
  const [itemClass, setItemClass] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState<'fixed' | 'percentage'>('fixed');
  // A flat rule is priced in dollars; a percentage rule is a plain percentage.
  // Both are converted to the minor units / basis points the API stores.
  const [amount, setAmount] = useState('');
  const [billingTrigger, setBillingTrigger] = useState('per_event');

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

  const value = model === 'fixed' ? dollarsToCents(amount) : percentToBasisPoints(amount);

  /**
   * Every action a rule exists for, labelled by what the newest rule says it
   * prices. A new rule for an action supersedes the old one, so offering only
   * five families meant membership, grading and add-on prices could not be
   * changed at all.
   */
  const actionOptions = (() => {
    const latest = new Map<string, PricingRule>();
    for (const r of rules ?? []) {
      const prev = latest.get(r.actionType);
      if (!prev || prev.effectiveFrom < r.effectiveFrom) latest.set(r.actionType, r);
    }
    for (const base of ['intake', 'storage', 'service', 'shipping', 'marketplace_fee']) {
      if (!latest.has(base)) latest.set(base, { actionType: base } as PricingRule);
    }
    return [...latest.entries()]
      .map(([key, r]) => ({
        key,
        label: key.includes(':') && r.description ? `${actionLabel(t, key)} · ${r.description}` : actionLabel(t, key),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  })();

  async function create() {
    if (value === null) return;
    try {
      await api.post('/pricing/rules', {
        actionType,
        itemClass: itemClass || undefined,
        description,
        model,
        value,
        billingTrigger,
      });
      onMsg(t('admin.pricing.created'));
      setAmount('');
      setItemClass('');
      setDescription('');
      setBillingTrigger('per_event');
      await load();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <>
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
                {actionOptions.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t('admin.pricing.col.class')}</span>
              <select value={itemClass} onChange={(e) => setItemClass(e.target.value)}>
                <option value="">{t('admin.pricing.allClasses')}</option>
                {ITEM_CLASSES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {t(c.labelKey)}
                  </option>
                ))}
              </select>
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

          <div className="row">
            <Button
              variant="gold"
              icon={<IconPlus />}
              disabled={value === null || description.trim() === ''}
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
                  const modelKey = MODEL_LABEL[rule.model];
                  const billingKey = BILLING_LABEL[rule.billingTrigger];
                  return (
                    <tr key={rule.id}>
                      <td data-label={t('admin.pricing.col.description')} className="dt-primary">
                        {rule.description ?? '—'}
                      </td>
                      <td data-label={t('admin.pricing.col.action')}>
                        {actionLabel(t, rule.actionType)}
                      </td>
                      <td data-label={t('admin.pricing.col.class')}>
                        {rule.itemClass ? itemClassLabel(t, rule.itemClass) : t('admin.pricing.allClasses')}
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
  // A percentage fee above 100% takes more than the whole amount.
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return Math.round(value * 100);
}

/* ============================================================
   Disputes (ADM-04)
   ============================================================ */

interface Dispute {
  id: string;
  code: string | null;
  transactionId: string;
  status: string;
  ruling: string | null;
  note: string | null;
  createdAt: string;
  transactionCode: string | null;
  transactionType: string | null;
  price: number | null;
  buyerUsername: string | null;
  sellerUsername: string | null;
}

const TXN_TYPE_LABEL: Record<string, MessageKey> = {
  sale: 'admin.txn.sale',
  swap: 'admin.txn.swap',
  transfer: 'admin.txn.transfer',
  consignment: 'admin.txn.consignment',
};

function txnTypeLabel(t: TranslateFn, type: string | null): string {
  if (!type) return '—';
  const key = TXN_TYPE_LABEL[type];
  return key ? t(key) : type;
}

/** "@buyer ← @seller", whichever of the two a transaction has. */
function parties(buyer: string | null, seller: string | null): string {
  return [seller && `@${seller}`, buyer && `@${buyer}`].filter(Boolean).join(' → ');
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
  code: string | null;
  type: string;
  price: number | null;
  buyerId: string | null;
  sellerId: string | null;
  buyerUsername: string | null;
  sellerUsername: string | null;
  createdAt: string;
}

function DisputesSection({
  onMsg,
  onError,
}: {
  onMsg: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
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
            {/* A dispute must reference an ACTUAL recorded transaction — pick one. */}
            <label className="field">
              <span className="field-label">{t('admin.disputes.col.transaction')}</span>
              <select value={transactionId} onChange={(e) => setTransactionId(e.target.value)}>
                <option value="">{t('admin.disputes.selectTransaction')}</option>
                {transactions.map((tx) => (
                  <option key={tx.id} value={tx.id}>
                    {[
                      tx.code ?? tx.id.slice(0, 8),
                      txnTypeLabel(t, tx.type),
                      tx.price !== null ? formatUsd(tx.price) : null,
                      parties(tx.buyerUsername, tx.sellerUsername),
                      formatDate(tx.createdAt, locale),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
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
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('admin.disputes.col.id')}</th>
                  <th scope="col">{t('admin.disputes.col.transaction')}</th>
                  <th scope="col">{t('admin.col.status')}</th>
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
      <td data-label={t('admin.disputes.col.id')}>
        <code dir="ltr">{dispute.code ?? dispute.id.slice(0, 8)}</code>
        {dispute.note && <span className="dt-sub">{dispute.note}</span>}
      </td>
      <td data-label={t('admin.disputes.col.transaction')}>
        <code dir="ltr">{dispute.transactionCode ?? dispute.transactionId.slice(0, 8)}</code>
        <span className="dt-sub">
          {[
            txnTypeLabel(t, dispute.transactionType),
            dispute.price !== null ? formatUsd(dispute.price) : null,
            parties(dispute.buyerUsername, dispute.sellerUsername),
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </td>
      <td data-label={t('admin.col.status')}>
        <StatusBadge tone={DISPUTE_TONE[dispute.status] ?? 'neutral'}>
          {currentLabel ? t(currentLabel) : dispute.status}
        </StatusBadge>
        {dispute.ruling && <span className="dt-sub">{dispute.ruling}</span>}
      </td>
      <td data-label={t('admin.disputes.col.update')}>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
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
   Storage-fee runs (VLT-04) — read-only; billing is fully automatic
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
      {/* Billing is fully automatic: a daily worker job charges every account with
          items stored for more than one day. There is no manual charge trigger. */}
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
