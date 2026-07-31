import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { CardPhotoButton } from '../../shared/CardPhoto';
import { BarcodePrintButton } from '../../shared/Barcode';
import { formatUsd } from '../../shared/money';
import { useT } from '../../shared/i18n';
import type { MessageKey } from '../../shared/i18n';

interface AdminUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
  intakeId: string;
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

type SectionKey = 'users' | 'items' | 'pricing' | 'disputes' | 'storage';

const SECTIONS: readonly { key: SectionKey; label: MessageKey }[] = [
  { key: 'users', label: 'admin.section.users' },
  { key: 'items', label: 'admin.section.items' },
  { key: 'pricing', label: 'admin.section.pricing' },
  { key: 'disputes', label: 'admin.section.disputes' },
  { key: 'storage', label: 'admin.section.storage' },
];

/**
 * Manager (admin) console. Sub-tabs: users + items (inline-editable tables),
 * pricing rules, transaction disputes and storage-fee runs. Storage-fee billing
 * is automatic and read-only here (Requirement 12.2); there are no banners
 * anywhere on the platform (Requirement 1.2).
 */
export function AdminConsole() {
  const t = useT();
  const [section, setSection] = useState<SectionKey>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [items, setItems] = useState<AdminItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      setUsers(await api.get<AdminUser[]>('/admin/users'));
      setItems(await api.get<AdminItem[]>('/admin/items'));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  return (
    <section>
      <h2>{t('admin.title')}</h2>
      <nav className="tabs">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            className={`tab${section === s.key ? ' is-active' : ''}`}
            onClick={() => setSection(s.key)}
          >
            {t(s.label)}
          </button>
        ))}
      </nav>
      {msg && <p role="status">{msg}</p>}

      {section === 'users' && (
        <>
          <h3>{t('admin.users.heading', { count: users.length })}</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('admin.users.col.email')}</th>
                  <th>{t('admin.users.col.name')}</th>
                  <th>{t('admin.users.col.role')}</th>
                  <th>{t('admin.col.status')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <UserRow key={u.id} user={u} onSaved={(m) => setMsg(m)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {section === 'items' && (
        <>
          <h3>{t('admin.items.heading', { count: items.length })}</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('admin.items.col.barcode')}</th>
                  <th>{t('admin.items.col.description')}</th>
                  <th>{t('admin.items.col.type')}</th>
                  <th>{t('admin.items.col.condition')}</th>
                  <th>{t('admin.items.col.owner')}</th>
                  <th>{t('admin.items.col.lifecycle')}</th>
                  <th>{t('admin.items.col.hold')}</th>
                  <th>{t('admin.items.col.photo')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <ItemRow key={it.id} item={it} users={users} onSaved={(m) => setMsg(m)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {section === 'pricing' && <PricingSection onMsg={setMsg} />}
      {section === 'disputes' && <DisputesSection onMsg={setMsg} />}
      {section === 'storage' && <StorageFeesSection onMsg={setMsg} />}
    </section>
  );
}

function UserRow({ user, onSaved }: { user: AdminUser; onSaved: (m: string) => void }) {
  const t = useT();
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);

  async function save() {
    try {
      await api.patch(`/admin/users/${user.id}`, { displayName, role, status });
      onSaved(t('admin.users.saved', { email: user.email }));
    } catch (e) {
      onSaved((e as Error).message);
    }
  }

  return (
    <tr>
      <td dir="ltr">{user.email}</td>
      <td><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></td>
      <td>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>
      <td>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td><button className="btn btn--primary" onClick={save}>{t('admin.action.save')}</button></td>
    </tr>
  );
}

function ItemRow({ item, users, onSaved }: { item: AdminItem; users: AdminUser[]; onSaved: (m: string) => void }) {
  const t = useT();
  const [description, setDescription] = useState(item.description);
  const [typeClass, setTypeClass] = useState(item.typeClass);
  const [conditionGrade, setConditionGrade] = useState(item.conditionGrade ?? '');
  const [ownerId, setOwnerId] = useState(item.ownerId);
  const [lifecycleState, setLifecycleState] = useState(item.lifecycleState);
  const [holdFlag, setHoldFlag] = useState(item.holdFlag);

  async function save() {
    try {
      await api.patch(`/admin/items/${item.id}`, { description, typeClass, conditionGrade, ownerId, lifecycleState, holdFlag });
      onSaved(t('admin.items.saved', { barcode: item.barcode }));
    } catch (e) {
      onSaved((e as Error).message);
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
      <td><input value={description} onChange={(e) => setDescription(e.target.value)} /></td>
      <td><input value={typeClass} onChange={(e) => setTypeClass(e.target.value)} /></td>
      <td><input value={conditionGrade} onChange={(e) => setConditionGrade(e.target.value)} style={{ width: '5rem' }} /></td>
      <td>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
        </select>
      </td>
      <td>
        <select value={lifecycleState} onChange={(e) => setLifecycleState(e.target.value)}>
          {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td><input type="checkbox" checked={holdFlag} onChange={(e) => setHoldFlag(e.target.checked)} /></td>
      <td><CardPhotoButton serialNumber={item.serialNumber} title={item.description || item.typeClass} /></td>
      <td><button className="btn btn--primary" onClick={save}>{t('admin.action.save')}</button></td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Pricing rules (ADM-02 / PRC-02)
// ---------------------------------------------------------------------------

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

const ACTION_TYPES = ['intake', 'storage', 'service', 'shipping', 'marketplace_fee'];
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

function PricingSection({ onMsg }: { onMsg: (m: string) => void }) {
  const t = useT();
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [actionType, setActionType] = useState('intake');
  const [itemClass, setItemClass] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState<'fixed' | 'percentage'>('fixed');
  const [value, setValue] = useState('');
  const [billingTrigger, setBillingTrigger] = useState('per_event');

  const load = useCallback(async () => {
    try {
      setRules(await api.get<PricingRule[]>('/pricing/rules'));
    } catch (e) {
      onMsg((e as Error).message);
    }
  }, [onMsg]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    try {
      await api.post('/pricing/rules', {
        actionType,
        itemClass: itemClass || undefined,
        description,
        model,
        value: Number(value),
        billingTrigger,
      });
      onMsg(t('admin.pricing.created'));
      setValue('');
      setItemClass('');
      setDescription('');
      setBillingTrigger('per_event');
      await load();
    } catch (e) {
      onMsg((e as Error).message);
    }
  }

  return (
    <>
      <h3>{t('admin.pricing.heading', { count: rules.length })}</h3>
      <fieldset>
        <legend>{t('admin.pricing.newRule')}</legend>
        <div className="field-row">
          <input
            placeholder={t('admin.pricing.descriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <select value={actionType} onChange={(e) => setActionType(e.target.value)}>
            {ACTION_TYPES.map((a) => {
              const k = ACTION_LABEL[a];
              return <option key={a} value={a}>{k ? t(k) : a}</option>;
            })}
          </select>
          <input placeholder={t('admin.pricing.itemClassPlaceholder')} value={itemClass} onChange={(e) => setItemClass(e.target.value)} />
          <select value={model} onChange={(e) => setModel(e.target.value as 'fixed' | 'percentage')}>
            <option value="fixed">{t('admin.pricing.model.fixed')}</option>
            <option value="percentage">{t('admin.pricing.model.percentage')}</option>
          </select>
          <input type="number" placeholder={t('admin.pricing.col.value')} value={value} onChange={(e) => setValue(e.target.value)} dir="ltr" />
          <select value={billingTrigger} onChange={(e) => setBillingTrigger(e.target.value)}>
            {BILLING_TRIGGERS.map((b) => {
              const k = BILLING_LABEL[b];
              return <option key={b} value={b}>{k ? t(k) : b}</option>;
            })}
          </select>
          <button
            className="btn btn--primary"
            disabled={value === '' || description.trim() === ''}
            onClick={create}
          >
            {t('admin.pricing.addRule')}
          </button>
        </div>
        <p className="hint">{t('admin.pricing.valueHint')}</p>
        <p className="hint">{t('admin.pricing.billingHint')}</p>
      </fieldset>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('admin.pricing.col.description')}</th>
              <th>{t('admin.pricing.col.action')}</th>
              <th>{t('admin.pricing.col.class')}</th>
              <th>{t('admin.pricing.col.model')}</th>
              <th>{t('admin.pricing.col.value')}</th>
              <th>{t('admin.pricing.col.billing')}</th>
              <th>{t('admin.pricing.col.effectiveFrom')}</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const actionKey = ACTION_LABEL[r.actionType];
              const modelKey = MODEL_LABEL[r.model];
              const billingKey = BILLING_LABEL[r.billingTrigger];
              return (
                <tr key={r.id}>
                  <td>{r.description ?? '—'}</td>
                  <td>{actionKey ? t(actionKey) : r.actionType}</td>
                  <td>{r.itemClass ?? t('admin.pricing.allClasses')}</td>
                  <td><span className="badge badge--info">{modelKey ? t(modelKey) : r.model}</span></td>
                  <td dir="ltr">{r.model === 'fixed' ? formatUsd(r.value) : `${(r.value / 100).toFixed(2)}%`}</td>
                  <td>{billingKey ? t(billingKey) : r.billingTrigger}</td>
                  <td dir="ltr">{r.effectiveFrom?.slice(0, 10)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Disputes (ADM-04)
// ---------------------------------------------------------------------------

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
const DISPUTE_BADGE: Record<string, string> = {
  open: 'badge--pending',
  investigating: 'badge--info',
  ruled: 'badge--success',
  closed: 'badge',
};

interface AdminTransaction {
  id: string;
  type: string;
  price: number;
  buyerId: string | null;
  sellerId: string | null;
  createdAt: string;
}

function DisputesSection({ onMsg }: { onMsg: (m: string) => void }) {
  const t = useT();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [transactions, setTransactions] = useState<AdminTransaction[]>([]);
  const [transactionId, setTransactionId] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      setDisputes(await api.get<Dispute[]>('/admin/disputes'));
      setTransactions(await api.get<AdminTransaction[]>('/admin/transactions'));
    } catch (e) {
      onMsg((e as Error).message);
    }
  }, [onMsg]);

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
      onMsg((e as Error).message);
    }
  }

  return (
    <>
      <h3>{t('admin.disputes.heading', { count: disputes.length })}</h3>
      <fieldset>
        <legend>{t('admin.disputes.openLegend')}</legend>
        <div className="field-row">
          {/* A dispute must reference an ACTUAL recorded transaction — pick one. */}
          <select value={transactionId} onChange={(e) => setTransactionId(e.target.value)} dir="ltr">
            <option value="">{t('admin.disputes.selectTransaction')}</option>
            {transactions.map((tx) => (
              <option key={tx.id} value={tx.id}>
                {tx.id.slice(0, 8)} — {tx.type} — {formatUsd(tx.price)} — {tx.createdAt.slice(0, 10)}
              </option>
            ))}
          </select>
          <input placeholder={t('admin.disputes.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn--primary" disabled={!transactionId} onClick={open}>{t('admin.disputes.openButton')}</button>
        </div>
        {transactions.length === 0 && <p className="hint">{t('admin.disputes.noTransactions')}</p>}
      </fieldset>
      {disputes.length === 0 ? (
        <p className="hint">{t('admin.disputes.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.disputes.col.id')}</th>
                <th>{t('admin.disputes.col.transaction')}</th>
                <th>{t('admin.col.status')}</th>
                <th>{t('admin.disputes.col.ruling')}</th>
                <th>{t('admin.disputes.col.update')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {disputes.map((d) => (
                <DisputeRow key={d.id} dispute={d} onSaved={async (m) => { onMsg(m); await load(); }} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function DisputeRow({ dispute, onSaved }: { dispute: Dispute; onSaved: (m: string) => Promise<void> }) {
  const t = useT();
  const [status, setStatus] = useState(dispute.status);
  const [ruling, setRuling] = useState(dispute.ruling ?? '');

  async function save() {
    try {
      await api.patch(`/admin/disputes/${dispute.id}`, { status, ruling: ruling || undefined });
      await onSaved(t('admin.disputes.updated'));
    } catch (e) {
      await onSaved((e as Error).message);
    }
  }

  const currentLabel = DISPUTE_LABEL[dispute.status];

  return (
    <tr>
      <td dir="ltr">{dispute.id.slice(0, 8)}</td>
      <td dir="ltr">{dispute.transactionId}</td>
      <td>
        <span className={`badge ${DISPUTE_BADGE[dispute.status] ?? ''}`}>
          {currentLabel ? t(currentLabel) : dispute.status}
        </span>
      </td>
      <td>{dispute.ruling ?? '—'}</td>
      <td>
        <div className="field-row">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {DISPUTE_STATUSES.map((s) => {
              const k = DISPUTE_LABEL[s];
              return <option key={s} value={s}>{k ? t(k) : s}</option>;
            })}
          </select>
          <input placeholder={t('admin.disputes.col.ruling')} value={ruling} onChange={(e) => setRuling(e.target.value)} />
        </div>
      </td>
      <td><button className="btn btn--primary" onClick={save}>{t('admin.disputes.updateButton')}</button></td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Storage-fee runs (VLT-04) — read-only; billing is fully automatic (no manual trigger)
// ---------------------------------------------------------------------------

interface FeeRun {
  id: string;
  thresholdDays: number;
  runAt: string;
  chargedItemIds: string[];
  totalAmount: number;
  currency: string;
}

function StorageFeesSection({ onMsg }: { onMsg: (m: string) => void }) {
  const t = useT();
  const [runs, setRuns] = useState<FeeRun[]>([]);

  const load = useCallback(async () => {
    try {
      setRuns(await api.get<FeeRun[]>('/admin/storage-fee-runs'));
    } catch (e) {
      onMsg((e as Error).message);
    }
  }, [onMsg]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <h3>{t('admin.section.storage')}</h3>
      {/* Billing is fully automatic: a daily worker job charges every account with
          items stored for more than one day. There is no manual charge trigger. */}
      <p className="hint">{t('admin.storage.autoNotice')}</p>
      <h3>{t('admin.storage.previousRuns', { count: runs.length })}</h3>
      {runs.length === 0 ? (
        <p className="hint">{t('admin.storage.empty')}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('admin.storage.col.date')}</th>
                <th>{t('admin.storage.col.thresholdDays')}</th>
                <th>{t('admin.storage.col.chargedItems')}</th>
                <th>{t('admin.storage.col.total')}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td dir="ltr">{r.runAt?.slice(0, 10)}</td>
                  <td>{r.thresholdDays}</td>
                  <td>{Array.isArray(r.chargedItemIds) ? r.chargedItemIds.length : 0}</td>
                  <td dir="ltr">{formatUsd(r.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
