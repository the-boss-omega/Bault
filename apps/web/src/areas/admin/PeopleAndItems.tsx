import { useState } from 'react';
import { api } from '../../shared/api';
import { CardPhotoButton } from '../../shared/CardPhoto';
import { BarcodePrintButton } from '../../shared/Barcode';
import { useI18n, type MessageKey, type TranslateFn } from '../../shared/i18n';
import { ITEM_CLASSES, itemClassLabel } from '../../shared/itemClasses';
import { NAME_PART_MAX, fullName, isValidNamePart, normalizeNamePart } from '../../shared/names';
import { DetailDrawer } from '../../shared/ui/DetailDrawer';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Panel,
  SkeletonTable,
  StatusBadge,
  type StatusTone,
} from '../../shared/ui/primitives';
import { IconBox, IconUsers } from '../../shared/ui/icons';

/**
 * `GET /admin/users`.
 *
 * `intakeId` survives HERE and only here. It is retired from every customer
 * workflow, but a manager troubleshooting a parcel that arrived with an old
 * pre-printed OW- label needs to be able to look it up — so it stays on the
 * administrative surface and nowhere else, and is read-only.
 */
export interface AdminUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  /** Migrated legacy name whose split was a guess nobody has confirmed yet. */
  nameReviewRequired: boolean;
  role: string;
  status: string;
  intakeId: string | null;
}

export interface AdminItem {
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

const ROLES = ['user', 'warehouse_operator', 'admin'] as const;
const STATUSES = ['pending', 'active', 'suspended', 'closed'] as const;

const ACCOUNT_STATUS_TONE: Record<string, StatusTone> = {
  active: 'success',
  pending: 'warning',
  suspended: 'error',
  closed: 'neutral',
};

/** Every lifecycle state, with its label and tone — the vault's own vocabulary. */
const STATE_META: Record<string, { tone: StatusTone; label: MessageKey }> = {
  received: { tone: 'info', label: 'vault.state.received' },
  stored: { tone: 'success', label: 'vault.state.stored' },
  listed: { tone: 'info', label: 'vault.state.listed' },
  'on-hold': { tone: 'error', label: 'vault.state.onHold' },
  sold: { tone: 'gold', label: 'vault.state.sold' },
  shipped: { tone: 'violet', label: 'vault.state.shipped' },
  donated: { tone: 'success', label: 'vault.state.donated' },
  consigned: { tone: 'info', label: 'vault.state.consigned' },
  at_grader: { tone: 'violet', label: 'vault.state.atGrader' },
  discarded: { tone: 'neutral', label: 'vault.state.discarded' },
};

/** States a card does not come back from. Setting one by hand is confirmed first. */
const TERMINAL = new Set(['sold', 'shipped', 'donated', 'consigned', 'discarded']);

function roleLabel(t: TranslateFn, role: string): string {
  return (ROLES as readonly string[]).includes(role) ? t(`role.${role}` as MessageKey) : role;
}

function statusLabel(t: TranslateFn, status: string): string {
  return (STATUSES as readonly string[]).includes(status) ? t(`account.status.${status}` as MessageKey) : status;
}

function stateLabel(t: TranslateFn, state: string): string {
  const meta = STATE_META[state];
  return meta ? t(meta.label) : state;
}

/* ============================================================
   Users
   ============================================================ */

/**
 * Accounts, as a register you can read at a glance, with the edit in a drawer.
 *
 * The rows used to BE the editor: two name inputs, two selects and a Save per
 * row, 1,196px wide — on a phone the Save button sat at x≈1210, and nothing
 * reloaded after a save, so a suspended account still read "active". Now each
 * row says who the account is, and Edit opens a drawer that saves, shows the
 * result, and hands the updated account back to the list.
 */
export function UsersSection({
  users,
  onChanged,
  onMsg,
}: {
  users: AdminUser[] | null;
  onChanged: (next: AdminUser) => void;
  onMsg: (m: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<AdminUser | null>(null);

  return (
    <Panel title={t('admin.users.heading', { count: users?.length ?? 0 })} subtitle={t('admin.users.subtitle')} flush>
      {users === null ? (
        <SkeletonTable rows={5} columns={5} />
      ) : users.length === 0 ? (
        <EmptyState title={t('admin.users.empty')} icon={<IconUsers />} />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.users.col.name')}</th>
                <th scope="col">{t('admin.users.col.email')}</th>
                <th scope="col">{t('admin.users.col.role')}</th>
                <th scope="col">{t('admin.col.status')}</th>
                <th scope="col" className="td-tight" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td data-label={t('admin.users.col.name')} className="dt-primary">
                    {fullName(u.firstName, u.lastName) || '—'}
                    <span className="dt-sub" dir="ltr">
                      @{u.username}
                    </span>
                    {u.nameReviewRequired && <span className="dt-sub">{t('admin.users.nameReviewRequired')}</span>}
                  </td>
                  <td data-label={t('admin.users.col.email')} dir="ltr">
                    {u.email}
                    {u.intakeId && (
                      <span className="dt-sub" title={t('admin.users.legacyIntakeIdTitle')}>
                        {u.intakeId}
                      </span>
                    )}
                  </td>
                  <td data-label={t('admin.users.col.role')}>{roleLabel(t, u.role)}</td>
                  <td data-label={t('admin.col.status')}>
                    <StatusBadge tone={ACCOUNT_STATUS_TONE[u.status] ?? 'neutral'}>{statusLabel(t, u.status)}</StatusBadge>
                  </td>
                  <td className="td-tight">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(u)}>
                      {t('admin.action.edit')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <UserDrawer
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            onChanged(next);
            onMsg(t('admin.users.saved', { email: next.email }));
            setEditing(null);
          }}
        />
      )}
    </Panel>
  );
}

function UserDrawer({
  user,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  onClose: () => void;
  onSaved: (next: AdminUser) => void;
}) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState(user.firstName ?? '');
  const [lastName, setLastName] = useState(user.lastName ?? '');
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstOk = isValidNamePart(normalizeNamePart(firstName));
  const lastOk = lastName.trim() === '' || isValidNamePart(normalizeNamePart(lastName));
  const dirty =
    normalizeNamePart(firstName) !== (user.firstName ?? '') ||
    normalizeNamePart(lastName) !== (user.lastName ?? '') ||
    role !== user.role ||
    status !== user.status;

  async function save() {
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      if (normalizeNamePart(firstName) !== (user.firstName ?? '')) patch.firstName = normalizeNamePart(firstName);
      if (normalizeNamePart(lastName) !== (user.lastName ?? '')) {
        // Blank clears it: a last name is optional.
        patch.lastName = lastName.trim() === '' ? null : normalizeNamePart(lastName);
      }
      if (role !== user.role) patch.role = role;
      if (status !== user.status) patch.status = status;
      onSaved(await api.patch<AdminUser>(`/admin/users/${user.id}`, patch));
    } catch (e) {
      setError((e as Error).message);
      // Put the controls back to what is actually saved, so the drawer never
      // shows a value the server refused.
      setRole(user.role);
      setStatus(user.status);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailDrawer
      title={fullName(user.firstName, user.lastName) || user.email}
      subtitle={<span dir="ltr">@{user.username} · {user.email}</span>}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!dirty || !firstOk || !lastOk} onClick={() => void save()}>
            {t('admin.action.save')}
          </Button>
        </>
      }
    >
      <div className="stack stack--tight">
        {error && <ErrorState message={error} />}
        <Field label={t('auth.firstName')} error={firstOk ? undefined : t('admin.users.nameInvalid')}>
          <input value={firstName} maxLength={NAME_PART_MAX} onChange={(e) => setFirstName(e.target.value)} />
        </Field>
        <Field
          label={t('auth.lastName')}
          hint={t('admin.users.lastNameHint')}
          error={lastOk ? undefined : t('admin.users.nameInvalid')}
        >
          <input value={lastName} maxLength={NAME_PART_MAX} onChange={(e) => setLastName(e.target.value)} />
        </Field>
        <Field label={t('admin.users.col.role')}>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(t, r)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('admin.col.status')}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(t, s)}
              </option>
            ))}
          </select>
        </Field>
        {user.nameReviewRequired && <p className="field-hint">{t('admin.users.reviewClears')}</p>}
      </div>
    </DetailDrawer>
  );
}

/* ============================================================
   Items
   ============================================================ */

/**
 * Every item, read-only in the list, edited in a drawer.
 *
 * The editor sends only the fields that changed: it used to send all of them,
 * so every save rewrote the owner and state and logged a blank condition as a
 * change, and an item at a grader or discarded could not be saved at all.
 */
export function ItemsSection({
  items,
  users,
  onChanged,
  onMsg,
}: {
  items: AdminItem[] | null;
  users: AdminUser[];
  onChanged: () => void;
  onMsg: (m: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<AdminItem | null>(null);

  return (
    <Panel title={t('admin.items.heading', { count: items?.length ?? 0 })} subtitle={t('admin.items.subtitle')} flush>
      {items === null ? (
        <SkeletonTable rows={5} columns={6} />
      ) : items.length === 0 ? (
        <EmptyState title={t('admin.items.empty')} icon={<IconBox />} />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.items.col.barcode')}</th>
                <th scope="col">{t('admin.items.col.description')}</th>
                <th scope="col">{t('admin.items.col.owner')}</th>
                <th scope="col">{t('admin.items.col.lifecycle')}</th>
                <th scope="col" className="td-tight" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const meta = STATE_META[it.lifecycleState];
                return (
                  <tr key={it.id}>
                    <td data-label={t('admin.items.col.barcode')} dir="ltr">
                      <code className="nowrap">{it.serialNumber}</code>
                    </td>
                    <td data-label={t('admin.items.col.description')}>
                      <span className="clamp-2">{it.description || itemClassLabel(t, it.typeClass)}</span>
                      <span className="dt-sub">
                        {itemClassLabel(t, it.typeClass)}
                        {it.conditionGrade ? ` · ${it.conditionGrade}` : ''}
                      </span>
                    </td>
                    <td data-label={t('admin.items.col.owner')} dir="ltr">
                      {it.ownerEmail ?? '—'}
                    </td>
                    <td data-label={t('admin.items.col.lifecycle')}>
                      <StatusBadge tone={meta?.tone ?? 'neutral'}>{stateLabel(t, it.lifecycleState)}</StatusBadge>
                      {it.holdFlag && (
                        <>
                          {' '}
                          <StatusBadge tone="error">{t('vault.state.onHold')}</StatusBadge>
                        </>
                      )}
                    </td>
                    <td className="td-tight">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(it)}>
                        {t('admin.action.edit')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ItemDrawer
          item={editing}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={() => {
            onMsg(t('admin.items.saved', { barcode: editing.serialNumber }));
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </Panel>
  );
}

function ItemDrawer({
  item,
  users,
  onClose,
  onSaved,
}: {
  item: AdminItem;
  users: AdminUser[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [description, setDescription] = useState(item.description);
  const [typeClass, setTypeClass] = useState(item.typeClass);
  const [conditionGrade, setConditionGrade] = useState(item.conditionGrade ?? '');
  const [ownerId, setOwnerId] = useState(item.ownerId);
  const [lifecycleState, setLifecycleState] = useState(item.lifecycleState);
  const [holdFlag, setHoldFlag] = useState(item.holdFlag);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch: Record<string, unknown> = {};
  if (description !== item.description) patch.description = description;
  if (typeClass !== item.typeClass) patch.typeClass = typeClass;
  if (conditionGrade.trim() !== (item.conditionGrade ?? '')) patch.conditionGrade = conditionGrade.trim();
  if (ownerId !== item.ownerId) patch.ownerId = ownerId;
  if (lifecycleState !== item.lifecycleState) patch.lifecycleState = lifecycleState;
  if (holdFlag !== item.holdFlag) patch.holdFlag = holdFlag;
  const dirty = Object.keys(patch).length > 0;
  // Ownership and terminal states move a card for good; the admin says so first.
  const risky = patch.ownerId !== undefined || (patch.lifecycleState !== undefined && TERMINAL.has(lifecycleState));

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/admin/items/${item.id}`, patch);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const owners = users.some((u) => u.id === item.ownerId)
    ? users
    : [...users, { id: item.ownerId, email: item.ownerEmail ?? item.ownerId } as AdminUser];

  return (
    <DetailDrawer
      title={item.description || itemClassLabel(t, item.typeClass)}
      subtitle={<code dir="ltr">{item.serialNumber}</code>}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="gold" loading={busy} disabled={!dirty || (risky && !confirmed)} onClick={() => void save()}>
            {t('admin.action.save')}
          </Button>
        </>
      }
    >
      <div className="stack stack--tight">
        {error && <ErrorState message={error} />}
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <BarcodePrintButton value={item.barcode} caption={item.description || item.typeClass} />
          <CardPhotoButton serialNumber={item.serialNumber} title={item.description || item.typeClass} />
        </div>
        <Field label={t('admin.items.col.description')}>
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t('admin.items.col.type')}>
          <select value={typeClass} onChange={(e) => setTypeClass(e.target.value)}>
            {!ITEM_CLASSES.some((c) => c.key === typeClass) && <option value={typeClass}>{typeClass}</option>}
            {ITEM_CLASSES.map((c) => (
              <option key={c.key} value={c.key}>
                {t(c.labelKey)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('admin.items.col.condition')}>
          <input value={conditionGrade} onChange={(e) => setConditionGrade(e.target.value)} />
        </Field>
        <Field label={t('admin.items.col.owner')}>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {owners.map((u) => (
              <option key={u.id} value={u.id}>
                {fullName(u.firstName ?? null, u.lastName ?? null)
                  ? `${fullName(u.firstName ?? null, u.lastName ?? null)} — ${u.email}`
                  : u.email}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('admin.items.col.lifecycle')}>
          <select value={lifecycleState} onChange={(e) => setLifecycleState(e.target.value)}>
            {Object.keys(STATE_META).map((s) => (
              <option key={s} value={s}>
                {stateLabel(t, s)}
              </option>
            ))}
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={holdFlag} onChange={(e) => setHoldFlag(e.target.checked)} />
          {t('admin.items.col.hold')}
        </label>
        {risky && (
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            {t('admin.items.confirmRisky')}
          </label>
        )}
      </div>
    </DetailDrawer>
  );
}
