import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useT } from '../../../shared/i18n';
import type { MessageKey } from '../../../shared/i18n';

interface Profile {
  id: string;
  email: string;
  /** Immutable: chosen at registration, never editable (Requirement 4.1). */
  username: string;
  intakeId: string;
  role: string;
  status: string;
  displayName: string | null;
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

/**
 * Own profile (ACC): view email / intake id / role, edit the display name, and
 * manage saved shipping addresses (add / delete, with a default marker).
 */
export function ProfilePage() {
  const t = useT();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, addr] = await Promise.all([
        api.get<Profile>('/me/profile'),
        api.get<Address[]>('/me/addresses'),
      ]);
      setProfile(p);
      setDisplayName(p.displayName ?? '');
      setAddresses(addr);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveName() {
    try {
      const p = await api.patch<Profile>('/me/profile', { displayName });
      setProfile(p);
      setStatus(t('profile.status.nameSaved'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeAddress(id: string) {
    try {
      await api.del(`/me/addresses/${id}`);
      setStatus(t('profile.status.addressDeleted'));
      setError(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const roleKey = profile ? ROLE_LABEL[profile.role] : undefined;

  return (
    <section>
      <h2>{t('profile.title')}</h2>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}

      {profile && (
        <div className="card">
          <h4>{t('profile.details.heading')}</h4>
          <p className="card-meta">
            <span className="hint">{t('profile.details.email')}</span> <span dir="ltr">{profile.email}</span>
          </p>
          {/* Rendered as static text on purpose — a username can never be edited
              (Requirement 4.1), so there is deliberately no input for it. */}
          <p className="card-meta">
            <span className="hint">{t('profile.details.username')}</span>{' '}
            <code dir="ltr">{profile.username}</code>
            <span className="hint">({t('profile.details.usernameImmutable')})</span>
          </p>
          <p className="card-meta">
            <span className="hint">{t('profile.details.intakeId')}</span> <code dir="ltr">{profile.intakeId}</code>
          </p>
          <p className="card-meta">
            <span className="hint">{t('profile.details.role')}</span>{' '}
            <span className="badge badge--info">{roleKey ? t(roleKey) : profile.role}</span>
          </p>
          <div className="field-row">
            <label>
              {t('profile.displayNameLabel')}
              <input
                placeholder={t('profile.displayNamePlaceholder')}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
            <button className="btn btn--primary" onClick={saveName}>{t('profile.saveName')}</button>
          </div>
        </div>
      )}

      {/* Saved shipping addresses are managed HERE and only here — the shipping
          page just picks one from this list (Requirement 4.2 / 5.1). */}
      <h3>{t('profile.addresses.heading')}</h3>
      {addresses.length === 0 ? (
        <p className="hint">{t('profile.addresses.empty')}</p>
      ) : (
        <ul className="card-grid">
          {addresses.map((a) => (
            <li key={a.id}>
              <AddressCard
                address={a}
                onDelete={() => removeAddress(a.id)}
                onSaved={async () => {
                  setStatus(t('profile.address.updated'));
                  await load();
                }}
                onError={(m) => setError(m)}
              />
            </li>
          ))}
        </ul>
      )}

      <AddressForm
        onAdded={async () => {
          setStatus(t('profile.status.addressAdded'));
          await load();
        }}
        onError={(m) => setError(m)}
      />
    </section>
  );
}

/**
 * One saved address: read-only card that flips into an inline edit form
 * (Requirement 4.2 — addresses are added, edited and removed from this page).
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
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(address);

  function start() {
    setDraft(address);
    setEditing(true);
  }

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
        <h4>
          {address.label}{' '}
          {address.isDefault && <span className="badge badge--info">{t('profile.addresses.default')}</span>}
        </h4>
        <p className="card-desc">{address.recipient}</p>
        <p className="card-desc">
          {address.line1}, {address.city}, {address.country} {address.postalCode}
        </p>
        <div className="actions">
          <button className="btn btn--primary" onClick={start}>{t('profile.address.edit')}</button>
          <button className="btn btn--danger" onClick={onDelete}>{t('profile.addresses.delete')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="field-row">
        <input placeholder={t('profile.addressForm.label')} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        <input placeholder={t('profile.addressForm.recipient')} value={draft.recipient} onChange={(e) => setDraft({ ...draft, recipient: e.target.value })} />
        <input placeholder={t('profile.addressForm.line1')} value={draft.line1} onChange={(e) => setDraft({ ...draft, line1: e.target.value })} />
        <input placeholder={t('profile.addressForm.city')} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
        <input placeholder={t('profile.addressForm.country')} value={draft.country} onChange={(e) => setDraft({ ...draft, country: e.target.value })} />
        <input placeholder={t('profile.addressForm.postalCode')} value={draft.postalCode} onChange={(e) => setDraft({ ...draft, postalCode: e.target.value })} dir="ltr" />
        <label>
          <input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
          {t('profile.addressForm.isDefault')}
        </label>
      </div>
      <div className="actions">
        <button className="btn btn--primary" disabled={!valid} onClick={save}>{t('profile.address.save')}</button>
        <button className="btn btn--ghost" onClick={() => setEditing(false)}>{t('profile.address.cancel')}</button>
      </div>
    </div>
  );
}

function AddressForm({ onAdded, onError }: { onAdded: () => Promise<void>; onError: (m: string) => void }) {
  const t = useT();
  const [label, setLabel] = useState('');
  const [recipient, setRecipient] = useState('');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState(() => t('profile.addressForm.countryDefault'));
  const [postalCode, setPostalCode] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  const valid = label && recipient && line1 && city && country && postalCode;

  async function add() {
    try {
      await api.post('/me/addresses', { label, recipient, line1, city, country, postalCode, isDefault });
      setLabel('');
      setRecipient('');
      setLine1('');
      setCity('');
      setPostalCode('');
      setIsDefault(false);
      await onAdded();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <fieldset>
      <legend>{t('profile.addressForm.legend')}</legend>
      <div className="field-row">
        <input placeholder={t('profile.addressForm.label')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <input placeholder={t('profile.addressForm.recipient')} value={recipient} onChange={(e) => setRecipient(e.target.value)} />
        <input placeholder={t('profile.addressForm.line1')} value={line1} onChange={(e) => setLine1(e.target.value)} />
        <input placeholder={t('profile.addressForm.city')} value={city} onChange={(e) => setCity(e.target.value)} />
        <input placeholder={t('profile.addressForm.country')} value={country} onChange={(e) => setCountry(e.target.value)} />
        <input placeholder={t('profile.addressForm.postalCode')} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} dir="ltr" />
        <label>
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          {t('profile.addressForm.isDefault')}
        </label>
        <button className="btn btn--primary" disabled={!valid} onClick={add}>{t('profile.addressForm.submit')}</button>
      </div>
    </fieldset>
  );
}
