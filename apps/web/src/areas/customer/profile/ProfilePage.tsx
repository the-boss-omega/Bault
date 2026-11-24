import { useCallback, useEffect, useState } from 'react';
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
import { regionRequired, useShippingCountries } from '../../../shared/countries';
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
  SkeletonBlock,
} from '../../../shared/ui/primitives';
import { ConfirmationModal } from '../../../shared/ui/DetailDrawer';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { Code } from '../../../shared/ui/Serial';
import { TwoFactorPanel } from './TwoFactorPanel';
import {
  AddressFields,
  AddressLabel,
  EMPTY_ADDRESS,
  addressOptionals,
  missingAddressFields,
  type Address,
  type AddressDraft,
} from './AddressFields';
import { IconLocation, IconPlus, IconUser } from '../../../shared/ui/icons';

interface Profile {
  id: string;
  email: string;
  pendingEmail?: string | null;
  username: string;
  role: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  nameReviewRequired: boolean;
  mfaMethod?: 'totp' | 'email' | null;
  mfaRequired?: boolean;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


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
  const [addresses, setAddresses] = useState<Address[] | null>(null);
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
                <Button
                  variant="primary"
                  disabled={!firstOk || !lastOk || !nameDirty}
                  onClick={saveName}
                >
                  {t('profile.saveName')}
                </Button>
              </div>
            </div>
          </Panel>

          {profile && (
            <EmailPanel profile={profile} onChanged={load} onStatus={setStatus} onError={setError} />
          )}
        </TabPanel>
      )}

      {tab === 'addresses' && (
        <TabPanel tab="addresses">
          <Panel
            title={t('profile.addresses.heading')}
            subtitle={t('profile.addresses.subtitle')}
            flush={!addresses || addresses.length === 0}
          >
            {addresses === null ? (
              error ? null : <SkeletonBlock />
            ) : addresses.length === 0 ? (
              <EmptyState
                title={t('profile.addresses.empty')}
                text={t('profile.addresses.emptyText')}
                icon={<IconLocation />}
              />
            ) : (
              <ul className="tag-grid">
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

  // What a new password has to be, and whether what has been typed is that yet. Nothing typed is echoed on the slip.
  const rules = [
    {
      key: 'length',
      label: t('profile.password.rule.length', { min: PASSWORD_MIN }),
      met: next.length >= PASSWORD_MIN,
    },
    {
      key: 'different',
      label: t('profile.password.rule.different'),
      met: next.length > 0 && next !== current,
    },
    {
      key: 'match',
      label: t('profile.password.rule.match'),
      met: confirm.length > 0 && confirm === next,
    },
  ];

  return (
    <Panel title={t('profile.password.heading')} subtitle={t('profile.password.subtitle')}>
      <div className="request-form request-form--stacked">
        <aside className="request-slip">
          <DrawerTag
            kicker={t('auth.newPassword')}
            lines={rules.map((rule) => ({
              label: rule.label,
              value: (
                <StatusBadge tone={rule.met ? 'success' : 'neutral'}>
                  {t(rule.met ? 'profile.password.met' : 'profile.password.notYet')}
                </StatusBadge>
              ),
            }))}
            status={
              ready ? (
                <StatusBadge tone="success">{t('profile.password.ready')}</StatusBadge>
              ) : undefined
            }
          />
        </aside>

        <div className="stack stack--tight request-form-fields">
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
        </div>

        <div className="row request-form-actions">
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void save()}>
            {t('profile.password.submit')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function EmailPanel({
  profile,
  onChanged,
  onStatus,
  onError,
}: {
  profile: Profile;
  onChanged: () => Promise<void>;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [next, setNext] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'resend' | 'cancel' | null>(null);

  const needsCode = profile.mfaMethod === 'totp' || profile.mfaRequired === true;
  const address = next.trim();
  const digits = code.replace(/\s/g, '');
  const same = address.toLowerCase() === profile.email.toLowerCase();
  const shaped = EMAIL_SHAPE.test(address);
  const fieldError =
    address === '' ? undefined : same ? t('profile.email.same') : !shaped ? t('profile.email.invalid') : undefined;
  const ready = shaped && !same && password.length > 0 && (!needsCode || digits.length > 0);

  async function run(kind: 'send' | 'resend' | 'cancel', work: () => Promise<string>) {
    setBusy(kind);
    try {
      const message = await work();
      await onChanged();
      onStatus(message);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const send = () =>
    run('send', async () => {
      const result = await api.post<{ pendingEmail: string }>('/me/email', {
        email: address,
        currentPassword: password,
        ...(needsCode ? { code: digits } : {}),
      });
      setNext('');
      setPassword('');
      setCode('');
      return t('profile.email.sent', { address: result.pendingEmail });
    });

  const resend = () =>
    run('resend', async () => {
      const result = await api.post<{ pendingEmail: string }>('/me/email/resend', {});
      return t('profile.email.resent', { address: result.pendingEmail });
    });

  const cancel = () =>
    run('cancel', async () => {
      await api.del('/me/email');
      return t('profile.email.cancelled');
    });

  return (
    <Panel title={t('profile.email.heading')} subtitle={t('profile.email.subtitle')}>
      <div className="stack stack--tight">
        {profile.pendingEmail && (
          <div className="stack stack--tight">
            <StatusBadge tone="warning">{t('profile.email.pending')}</StatusBadge>
            <p className="field-hint">
              {t('profile.email.pendingText', { address: profile.pendingEmail, current: profile.email })}
            </p>
            <div className="row">
              <Button size="sm" variant="secondary" loading={busy === 'resend'} disabled={busy !== null} onClick={() => void resend()}>
                {t('profile.email.resend')}
              </Button>
              <Button size="sm" variant="ghost" loading={busy === 'cancel'} disabled={busy !== null} onClick={() => void cancel()}>
                {t('profile.email.cancel')}
              </Button>
            </div>
          </div>
        )}

        <div className="form-grid">
          <Field label={t('profile.email.new')} error={fieldError}>
            <input
              type="email"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="email"
              aria-invalid={fieldError !== undefined}
              dir="ltr"
            />
          </Field>

          <Field label={t('profile.password.current')}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              dir="ltr"
            />
          </Field>

          {needsCode && (
            <Field label={t('profile.email.code')}>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
              />
            </Field>
          )}
        </div>

        <div className="row">
          <Button variant="primary" loading={busy === 'send'} disabled={!ready || busy !== null} onClick={() => void send()}>
            {t('profile.email.submit')}
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
        ...addressOptionals(draft),
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
      <li className="tag-item">
        <AddressLabel item address={address} kicker={address.label} />
        <div className="actions">
          <Button
            size="sm"
            variant="secondary"
            aria-label={t('profile.address.editNamed', { label: address.label })}
            onClick={() => {
              setDraft(address);
              setEditing(true);
            }}
          >
            {t('profile.address.edit')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            aria-label={t('profile.address.deleteNamed', { label: address.label })}
            onClick={onDelete}
          >
            {t('profile.addresses.delete')}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="tag-item is-editing">
      <div className="request-form">
        <div className="request-form-fields">
          <AddressFields draft={draft} onChange={(next) => setDraft({ ...draft, ...next })} />
        </div>
        <aside className="request-slip">
          <AddressLabel address={draft} kicker={draft.label.trim() || t('profile.address.edit')} />
        </aside>
        <div className="actions request-form-actions">
          <Button size="sm" variant="primary" disabled={!valid} onClick={save}>
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

function AddressForm({
  onAdded,
  onError,
}: {
  onAdded: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const countries = useShippingCountries();
  const empty = EMPTY_ADDRESS;
  const [draft, setDraft] = useState<AddressDraft>(empty);

  const valid = missingAddressFields(draft, countries).length === 0;

  async function add() {
    try {
      await api.post('/me/addresses', { ...draft, region: draft.region?.trim() || null, ...addressOptionals(draft) });
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
          <Button variant="primary" icon={<IconPlus />} disabled={!valid} onClick={add}>
            {t('profile.addressForm.submit')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
