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
import { isolate } from '../../../shared/money';
import { useNavigation, useRoute } from '../../../shared/routing';
import { countryName, lacksRegion, regionRequired, useShippingCountries } from '../../../shared/countries';
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
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { Code } from '../../../shared/ui/Serial';
import { TwoFactorPanel } from './TwoFactorPanel';
import { IconLocation, IconPlus, IconUser } from '../../../shared/ui/icons';

interface Profile {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  nameReviewRequired: boolean;
}

interface Address {
  id: string;
  label: string;
  recipient: string;
  line1: string;
  city: string;
  region: string | null;
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
          <Panel title={t('profile.nameLabel')} subtitle={t('profile.nameSubtitle')}>
            <div className="request-form">
              <div className="stack stack--tight request-form-fields">
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
                      dir="auto"
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
                      dir="auto"
                    />
                  </Field>
                </div>
              </div>

              {/* The account as it is read: the name as it is being written, and what cannot be written here. */}
              {profile && (
                <aside className="request-slip">
                  <DrawerTag
                    kicker={t('profile.details.heading')}
                    title={
                      <>
                        <span className="sr-only">{t('profile.details.fullName')} </span>
                        {fullName(firstName, lastName) || (
                          <span className="drawer-tag-quiet">{t('profile.details.noName')}</span>
                        )}
                      </>
                    }
                    lines={[
                      {
                        label: t('profile.details.email'),
                        value: <span dir="ltr">{profile.email}</span>,
                      },
                      {
                        label: t('profile.details.username'),
                        value: (
                          <>
                            <Code value={`@${profile.username}`} />
                            <small className="drawer-tag-sub">
                              {t('profile.details.usernameImmutable')}
                            </small>
                          </>
                        ),
                      },
                    ]}
                    status={
                      <StatusBadge tone="info">{roleKey ? t(roleKey) : profile.role}</StatusBadge>
                    }
                  />
                </aside>
              )}

              <div className="row request-form-actions">
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
              <ul className="address-labels">
                {addresses.map((address) => (
                  <AddressCard
                    key={address.id}
                    address={address}
                    onDelete={() => setDeleting(address)}
                    onSaved={async () => {
                      setStatus(t('profile.address.updated'));
                      await load();
                    }}
                    onError={setError}
                  />
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
          <div className="security-grid">
            <PasswordPanel onStatus={setStatus} onError={setError} />
            <TwoFactorPanel />
          </div>
        </TabPanel>
      )}

      {deleting && (
        <ConfirmationModal
          title={t('profile.address.deleteTitle')}
          body={<p>{t('profile.address.deleteBody', { label: isolate(deleting.label) })}</p>}
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
    draft.label &&
    draft.recipient &&
    draft.line1 &&
    draft.city &&
    draft.country &&
    draft.postalCode &&
    (draft.region || !regionRequired(draft.country, countries));

  async function save() {
    try {
      await api.patch(`/me/addresses/${address.id}`, {
        label: draft.label,
        recipient: draft.recipient,
        line1: draft.line1,
        city: draft.city,
        region: draft.region?.trim() || null,
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
      <li className="address-item">
        <AddressLabel address={address} kicker={address.label} />
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
      </li>
    );
  }

  return (
    <li className="address-item is-editing">
      <div className="request-form">
        <div className="request-form-fields">
          <AddressFields draft={draft} onChange={(next) => setDraft({ ...draft, ...next })} />
        </div>
        <aside className="request-slip">
          <AddressLabel address={draft} kicker={draft.label.trim() || t('profile.address.edit')} />
        </aside>
        <div className="actions request-form-actions">
          <Button size="sm" variant="gold" disabled={!valid} onClick={save}>
            {t('profile.address.save')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t('profile.address.cancel')}
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * An address as it is written on a parcel: whose it is, and where it goes. What has not been written yet is
 * asked for in the quieter ink, so a label being filled in reads as one, and a saved one as it will be sent.
 */
function AddressLabel({ address, kicker }: { address: AddressDraft; kicker: string }) {
  const { t } = useI18n();
  const countries = useShippingCountries();
  const quiet = (text: string) => <span className="drawer-tag-quiet">{text}</span>;
  const town = [address.city.trim(), address.region?.trim()].filter(Boolean).join(', ');
  const townLine = [town, address.postalCode.trim()].filter(Boolean).join(' ');

  return (
    <DrawerTag
      kicker={kicker}
      title={address.recipient.trim() || quiet(t('profile.addressForm.recipient'))}
      status={
        (address.isDefault || lacksRegion(address, countries)) && (
          <>
            {address.isDefault && (
              <StatusBadge tone="gold">{t('profile.addresses.default')}</StatusBadge>
            )}
            {lacksRegion(address, countries) && (
              <StatusBadge tone="warning">{t('profile.addresses.regionMissing')}</StatusBadge>
            )}
          </>
        )
      }
    >
      <address className="address-lines">
        <span>{address.line1.trim() || quiet(t('profile.addressForm.line1'))}</span>
        <span>{townLine || quiet(t('profile.addressForm.city'))}</span>
        <span>
          {address.country
            ? countryName(address.country, countries)
            : quiet(t('profile.addressForm.country'))}
        </span>
      </address>
    </DrawerTag>
  );
}

type AddressDraft = Omit<Address, 'id'>;

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
  const country = countries.find((c) => c.code === draft.country);

  return (
    <div className="form-grid">
      <Field label={t('profile.addressForm.label')} htmlFor={`${id}-label`}>
        <input
          id={`${id}-label`}
          value={draft.label}
          onChange={(e) => set({ label: e.target.value })}
          dir="auto"
        />
      </Field>
      <Field label={t('profile.addressForm.recipient')} htmlFor={`${id}-recipient`}>
        <input
          id={`${id}-recipient`}
          value={draft.recipient}
          onChange={(e) => set({ recipient: e.target.value })}
          autoComplete="name"
          dir="auto"
        />
      </Field>
      <Field label={t('profile.addressForm.line1')} htmlFor={`${id}-line1`}>
        <input
          id={`${id}-line1`}
          value={draft.line1}
          onChange={(e) => set({ line1: e.target.value })}
          autoComplete="address-line1"
          dir="auto"
        />
      </Field>
      <Field label={t('profile.addressForm.city')} htmlFor={`${id}-city`}>
        <input
          id={`${id}-city`}
          value={draft.city}
          onChange={(e) => set({ city: e.target.value })}
          autoComplete="address-level2"
          dir="auto"
        />
      </Field>
      <Field
        label={t('profile.addressForm.country')}
        htmlFor={`${id}-country`}
        hint={t('profile.addressForm.countryHint')}
      >
        <select
          id={`${id}-country`}
          value={draft.country}
          onChange={(e) => set({ country: e.target.value, region: '' })}
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
      <Field
        label={t('profile.addressForm.region')}
        htmlFor={`${id}-region`}
        hint={
          country?.regionRequired
            ? t('profile.addressForm.regionRequiredHint', { country: country.name })
            : t('profile.addressForm.regionOptionalHint')
        }
      >
        {country?.regions ? (
          <select
            id={`${id}-region`}
            value={draft.region ?? ''}
            onChange={(e) => set({ region: e.target.value })}
            autoComplete="address-level1"
          >
            <option value="">{t('profile.addressForm.regionPlaceholder')}</option>
            {country.regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.code} — {r.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`${id}-region`}
            value={draft.region ?? ''}
            maxLength={60}
            onChange={(e) => set({ region: e.target.value })}
            autoComplete="address-level1"
            dir="auto"
          />
        )}
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
  const countries = useShippingCountries();
  const empty: AddressDraft = {
    label: '',
    recipient: '',
    line1: '',
    city: '',
    region: '',
    country: '',
    postalCode: '',
    isDefault: false,
  };
  const [draft, setDraft] = useState<AddressDraft>(empty);

  const valid =
    draft.label &&
    draft.recipient &&
    draft.line1 &&
    draft.city &&
    draft.country &&
    draft.postalCode &&
    (draft.region || !regionRequired(draft.country, countries));

  async function add() {
    try {
      await api.post('/me/addresses', { ...draft, region: draft.region?.trim() || null });
      setDraft(empty);
      await onAdded();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <Panel title={t('profile.addressForm.legend')}>
      <div className="request-form">
        <div className="request-form-fields">
          <AddressFields draft={draft} onChange={setDraft} />
        </div>
        <aside className="request-slip">
          <AddressLabel
            address={draft}
            kicker={draft.label.trim() || t('profile.addressForm.legend')}
          />
        </aside>
        <div className="row request-form-actions">
          <Button variant="gold" icon={<IconPlus />} disabled={!valid} onClick={add}>
            {t('profile.addressForm.submit')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
