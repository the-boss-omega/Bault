import { useCallback, useEffect, useId, useState } from 'react';
import { api, apiErrorKey } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import {
  NAME_PART_MAX,
  PASSWORD_MIN,
  fullName,
  isValidNamePart,
  normalizeNamePart,
} from '../../../shared/names';
import { useNavigation, useRoute } from '../../../shared/routing';
import { countryName, useShippingCountries } from '../../../shared/countries';
import {
  Button,
  ContextTabs,
  EmptyState,
  ErrorState,
  Field,
  Panel,
  StatusBadge,
  SuccessNote,
  TabPanel,
} from '../../../shared/ui/primitives';
import { ConfirmationModal } from '../../../shared/ui/DetailDrawer';
import { TwoFactorPanel } from './TwoFactorPanel';
import { IconLocation, IconPlus, IconUser } from '../../../shared/ui/icons';

/**
 * `GET /me/profile`. A person's name is the two explicit fields; the full name
 * is derived at render time.
 */
interface Profile {
  id: string;
  email: string;
  /** Immutable: chosen at registration, never editable (Requirement 4.1). */
  username: string;
  role: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  /** Set when a migrated legacy name has not yet been confirmed by anyone. */
  nameReviewRequired: boolean;
}

interface Address {
  id: string;
  label: string;
  recipient: string;
  line1: string;
  city: string;
  country: string;
  postalCode: string;
  isDefault: boolean;
}

const ROLE_LABEL: Record<string, MessageKey> = {
  user: 'profile.role.user',
  warehouse_operator: 'profile.role.warehouse_operator',
  admin: 'profile.role.admin',
};

const TABS = ['details', 'addresses', 'security'] as const;
type ProfileTab = (typeof TABS)[number];

/**
 * Own profile: view email, username and role, edit the two name fields, and
 * manage saved shipping addresses (add, edit, delete, with a default marker).
 * Reached from the account menu; it is deliberately not a rail destination.
 *
 * The username is shown as text, never an input: it is permanent. First and
 * last name are the editable identity fields, and the full name shown beside
 * them is derived from these two instead of stored.
 */
export function ProfilePage() {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab } = useNavigation(route);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Address | null>(null);

  const tab: ProfileTab = (TABS as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as ProfileTab)
    : 'details';

  // A failed load names the actual failure (backend down, session expired,
  // permission denied) instead of a raw transport message.
  const describe = useCallback(
    (e: unknown) => {
      const key = apiErrorKey(e);
      if (key) return t(key);
      return e instanceof Error && e.message ? e.message : t('error.unexpected');
    },
    [t],
  );

  const load = useCallback(async () => {
    try {
      const [p, addr] = await Promise.all([
        api.get<Profile>('/me/profile'),
        api.get<Address[]>('/me/addresses'),
      ]);
      setProfile(p);
      setFirstName(p.firstName ?? '');
      setLastName(p.lastName ?? '');
      setAddresses(addr);
      setError(null);
    } catch (e) {
      setError(describe(e));
    }
  }, [describe]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveName() {
    try {
      const p = await api.patch<Profile>('/me/profile', {
        firstName: normalizeNamePart(firstName),
        lastName: normalizeNamePart(lastName),
      });
      setProfile(p);
      setFirstName(p.firstName ?? '');
      setLastName(p.lastName ?? '');
      setStatus(t('profile.status.nameSaved'));
      setError(null);
    } catch (e) {
      setError(describe(e));
    }
  }

  async function removeAddress(address: Address) {
    try {
      await api.del(`/me/addresses/${address.id}`);
      setStatus(t('profile.status.addressDeleted'));
      setError(null);
      await load();
    } catch (e) {
      setError(describe(e));
    } finally {
      setDeleting(null);
    }
  }

  const roleKey = profile ? ROLE_LABEL[profile.role] : undefined;
  const tabs = TABS.map((key) => ({ key, label: t(`profile.tab.${key}` as MessageKey) }));

  // Both parts are required, and Save stays disabled unless something changed,
  // so confirming a flagged legacy name is a deliberate act.
  const firstOk = isValidNamePart(normalizeNamePart(firstName));
  const lastOk = isValidNamePart(normalizeNamePart(lastName));
  const nameDirty =
    normalizeNamePart(firstName) !== (profile?.firstName ?? '') ||
    normalizeNamePart(lastName) !== (profile?.lastName ?? '');

  return (
    <>
      <ContextTabs label={t('profile.title')} tabs={tabs} active={tab} onSelect={goTab} />

      {status && <SuccessNote>{status}</SuccessNote>}
      {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}

      {tab === 'details' && (
        <TabPanel tab="details">
          <Panel title={t('profile.details.heading')}>
            {profile && (
              <dl className="detail-list" style={{ maxWidth: 560 }}>
                <div className="detail-row">
                  <dt className="detail-label">{t('profile.details.email')}</dt>
                  <dd className="detail-value" dir="ltr">
                    {profile.email}
                  </dd>
                </div>
                {/* Static text on purpose: a username can never be edited
                    (Requirement 4.1), so there is deliberately no input. */}
                <div className="detail-row">
                  <dt className="detail-label">{t('profile.details.username')}</dt>
                  <dd className="detail-value">
                    <code dir="ltr">{profile.username}</code>
                    <span className="detail-value-sub">{t('profile.details.usernameImmutable')}</span>
                  </dd>
                </div>
                <div className="detail-row">
                  <dt className="detail-label">{t('profile.details.fullName')}</dt>
                  <dd className="detail-value">
                    {/* Derived, never stored, so it cannot disagree with the
                        two fields it comes from. */}
                    {fullName(profile.firstName, profile.lastName) || (
                      <span className="muted">{t('profile.details.noName')}</span>
                    )}
                  </dd>
                </div>
                <div className="detail-row">
                  <dt className="detail-label">{t('profile.details.role')}</dt>
                  <dd className="detail-value">
                    <StatusBadge tone="info">{roleKey ? t(roleKey) : profile.role}</StatusBadge>
                  </dd>
                </div>
              </dl>
            )}
          </Panel>

          <Panel title={t('profile.nameLabel')} subtitle={t('profile.nameSubtitle')}>
            <div className="stack stack--tight" style={{ maxWidth: 560 }}>
              {/* Shown only for an account migration 0004 could not split
                  without guessing. It states what happened and what to do,
                  instead of presenting a guessed split as fact. */}
              {profile?.nameReviewRequired && (
                <SuccessNote tone="warning">{t('profile.nameReviewRequired')}</SuccessNote>
              )}

              <div className="form-grid">
                <Field
                  label={t('auth.firstName')}
                  error={firstName.length > 0 && !firstOk ? t('auth.nameInvalid') : undefined}
                >
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    maxLength={NAME_PART_MAX}
                    aria-invalid={firstName.length > 0 && !firstOk}
                  />
                </Field>

                <Field
                  label={t('auth.lastName')}
                  error={lastName.length > 0 && !lastOk ? t('auth.nameInvalid') : undefined}
                >
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                    maxLength={NAME_PART_MAX}
                    aria-invalid={lastName.length > 0 && !lastOk}
                  />
                </Field>
              </div>

              <p className="field-hint">
                {t('profile.namePreview', {
                  name: fullName(firstName, lastName) || t('profile.details.noName'),
                })}
              </p>

              <div className="row">
                <Button variant="gold" disabled={!firstOk || !lastOk || !nameDirty} onClick={saveName}>
                  {t('profile.saveName')}
                </Button>
              </div>
            </div>
          </Panel>
        </TabPanel>
      )}

      {tab === 'addresses' && (
        <TabPanel tab="addresses">
          {/* Saved shipping addresses are managed here and only here; the
              shipping page picks one from this list (Req 4.2 / 5.1). */}
          <Panel
            title={t('profile.addresses.heading')}
            subtitle={t('profile.addresses.subtitle')}
            flush={addresses.length === 0}
          >
            {addresses.length === 0 ? (
              <EmptyState
                title={t('profile.addresses.empty')}
                text={t('profile.addresses.emptyText')}
                icon={<IconLocation />}
              />
            ) : (
              <ul className="card-grid">
                {addresses.map((address) => (
                  <li key={address.id}>
                    <AddressCard
                      address={address}
                      onDelete={() => setDeleting(address)}
                      onSaved={async () => {
                        setStatus(t('profile.address.updated'));
                        await load();
                      }}
                      onError={setError}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <AddressForm
            onAdded={async () => {
              setStatus(t('profile.status.addressAdded'));
              await load();
            }}
            onError={setError}
          />
        </TabPanel>
      )}

      {tab === 'security' && (
        <TabPanel tab="security">
          <PasswordPanel onStatus={setStatus} onError={setError} />
          <TwoFactorPanel />
        </TabPanel>
      )}

      {deleting && (
        <ConfirmationModal
          title={t('profile.address.deleteTitle')}
          body={<p>{t('profile.address.deleteBody', { label: deleting.label })}</p>}
          confirmLabel={t('profile.addresses.delete')}
          cancelLabel={t('ui.cancel')}
          tone="danger"
          onConfirm={() => void removeAddress(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}

      {!profile && !error && (
        <Panel title={t('profile.title')}>
          <EmptyState title={t('app.loading')} icon={<IconUser />} />
        </Panel>
      )}
    </>
  );
}

/**
 * Change the account password.
 *
 * The current password is required by the API, so an unattended signed-in
 * browser is not enough to lock the real owner out of their own account.
 * `POST /auth/password/change` verifies it with argon2 before writing anything.
 *
 * On success the API ends every other session the account has open and keeps
 * this one, so the page stays usable afterwards.
 */
function PasswordPanel({
  onStatus,
  onError,
}: {
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const tooShort = next.length > 0 && next.length < PASSWORD_MIN;
  const mismatch = confirm.length > 0 && confirm !== next;
  // Refuse a no-op change here: the server would report success while nothing
  // happened.
  const unchanged = next.length > 0 && next === current;
  const ready = current.length > 0 && next.length >= PASSWORD_MIN && confirm === next && !unchanged;

  async function save() {
    setBusy(true);
    try {
      await api.post('/auth/password/change', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      onStatus(t('profile.password.changed'));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('profile.password.heading')} subtitle={t('profile.password.subtitle')}>
      <div className="stack stack--tight" style={{ maxWidth: 460 }}>
        <Field label={t('profile.password.current')}>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            dir="ltr"
          />
        </Field>

        {/* Two different problems, told apart: too short, and unchanged. */}
        <Field
          label={t('auth.newPassword')}
          hint={t('auth.passwordHint')}
          error={
            unchanged
              ? t('profile.password.sameAsCurrent')
              : tooShort
                ? t('auth.passwordTooShort', { min: PASSWORD_MIN })
                : undefined
          }
        >
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            aria-invalid={tooShort || unchanged}
            dir="ltr"
          />
        </Field>

        <Field
          label={t('auth.confirmPassword')}
          error={mismatch ? t('auth.passwordMismatch') : undefined}
        >
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            aria-invalid={mismatch}
            dir="ltr"
          />
        </Field>

        <div className="row">
          <Button variant="gold" disabled={busy || !ready} onClick={() => void save()}>
            {t('profile.password.submit')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/**
 * One saved address: read-only card that flips into an inline edit form
 * (Requirement 4.2: addresses are added, edited and removed from this page).
 */
function AddressCard({
  address,
  onDelete,
  onSaved,
  onError,
}: {
  address: Address;
  onDelete: () => void;
  onSaved: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const countries = useShippingCountries();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(address);

  const valid =
    draft.label && draft.recipient && draft.line1 && draft.city && draft.country && draft.postalCode;

  async function save() {
    try {
      await api.patch(`/me/addresses/${address.id}`, {
        label: draft.label,
        recipient: draft.recipient,
        line1: draft.line1,
        city: draft.city,
        country: draft.country,
        postalCode: draft.postalCode,
        isDefault: draft.isDefault,
      });
      setEditing(false);
      await onSaved();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  if (!editing) {
    return (
      <div className="card">
        <div className="card-meta">
          <h3 className="card-title" style={{ flex: '1 1 auto' }}>
            {address.label}
          </h3>
          {address.isDefault && <StatusBadge tone="gold">{t('profile.addresses.default')}</StatusBadge>}
        </div>
        <p className="card-desc">{address.recipient}</p>
        {/* The country is stored as a code, so its name is looked up for display. */}
        <p className="card-desc">
          {address.line1}, {address.city}, {countryName(address.country, countries)}{' '}
          {address.postalCode}
        </p>
        <div className="actions">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDraft(address);
              setEditing(true);
            }}
          >
            {t('profile.address.edit')}
          </Button>
          <Button size="sm" variant="danger" onClick={onDelete}>
            {t('profile.addresses.delete')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <AddressFields draft={draft} onChange={(next) => setDraft({ ...draft, ...next })} />
      <div className="actions">
        <Button size="sm" variant="gold" disabled={!valid} onClick={save}>
          {t('profile.address.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          {t('profile.address.cancel')}
        </Button>
      </div>
    </div>
  );
}

type AddressDraft = Omit<Address, 'id'>;

/** The address field set, shared by the edit card and the add form. */
function AddressFields({
  draft,
  onChange,
}: {
  draft: AddressDraft;
  onChange: (next: AddressDraft) => void;
}) {
  const { t } = useI18n();
  const countries = useShippingCountries();
  const set = (patch: Partial<AddressDraft>) => onChange({ ...draft, ...patch });
  const id = useId();

  return (
    <div className="form-grid">
      {/* `Field` throughout, so each control's accessible name is its caption alone. */}
      <Field label={t('profile.addressForm.label')} htmlFor={`${id}-label`}>
        <input id={`${id}-label`} value={draft.label} onChange={(e) => set({ label: e.target.value })} />
      </Field>
      <Field label={t('profile.addressForm.recipient')} htmlFor={`${id}-recipient`}>
        <input
          id={`${id}-recipient`}
          value={draft.recipient}
          onChange={(e) => set({ recipient: e.target.value })}
          autoComplete="name"
        />
      </Field>
      <Field label={t('profile.addressForm.line1')} htmlFor={`${id}-line1`}>
        <input
          id={`${id}-line1`}
          value={draft.line1}
          onChange={(e) => set({ line1: e.target.value })}
          autoComplete="address-line1"
        />
      </Field>
      <Field label={t('profile.addressForm.city')} htmlFor={`${id}-city`}>
        <input
          id={`${id}-city`}
          value={draft.city}
          onChange={(e) => set({ city: e.target.value })}
          autoComplete="address-level2"
        />
      </Field>
      {/*
        A select, because every carrier rule reads this field as an ISO code.
        The list comes from the carrier table itself, so nothing here can offer
        a destination that cannot be reached.
      */}
      <Field
        label={t('profile.addressForm.country')}
        htmlFor={`${id}-country`}
        hint={t('profile.addressForm.countryHint')}
      >
        <select
          id={`${id}-country`}
          value={draft.country}
          onChange={(e) => set({ country: e.target.value })}
          autoComplete="country"
        >
          <option value="">{t('profile.addressForm.countryPlaceholder')}</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('profile.addressForm.postalCode')} htmlFor={`${id}-postal`}>
        <input
          id={`${id}-postal`}
          value={draft.postalCode}
          onChange={(e) => set({ postalCode: e.target.value })}
          autoComplete="postal-code"
          dir="ltr"
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.isDefault}
          onChange={(e) => set({ isDefault: e.target.checked })}
        />
        {t('profile.addressForm.isDefault')}
      </label>
    </div>
  );
}

function AddressForm({
  onAdded,
  onError,
}: {
  onAdded: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const empty: AddressDraft = {
    label: '',
    recipient: '',
    line1: '',
    city: '',
    // No default: a pre-filled country is a country nobody checked.
    country: '',
    postalCode: '',
    isDefault: false,
  };
  const [draft, setDraft] = useState<AddressDraft>(empty);

  const valid =
    draft.label && draft.recipient && draft.line1 && draft.city && draft.country && draft.postalCode;

  async function add() {
    try {
      await api.post('/me/addresses', draft);
      setDraft(empty);
      await onAdded();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <Panel title={t('profile.addressForm.legend')}>
      <div className="stack stack--tight">
        <AddressFields draft={draft} onChange={setDraft} />
        <div className="row">
          <Button variant="gold" icon={<IconPlus />} disabled={!valid} onClick={add}>
            {t('profile.addressForm.submit')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
