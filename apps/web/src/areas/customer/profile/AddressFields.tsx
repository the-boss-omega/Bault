import { useId } from 'react';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { countryName, lacksRegion, regionRequired, useShippingCountries, type ShippingCountry } from '../../../shared/countries';
import { Field, StatusBadge } from '../../../shared/ui/primitives';
import { DrawerTag } from '../../../shared/ui/DrawerTag';

export interface Address {
  id: string;
  label: string;
  recipient: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  country: string;
  postalCode: string;
  phone: string | null;
  isDefault: boolean;
}

export const EMPTY_ADDRESS: AddressDraft = {
  label: '',
  recipient: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  country: '',
  postalCode: '',
  phone: '',
  isDefault: false,
};

export function addressOptionals(draft: Pick<AddressDraft, 'line2' | 'phone'>) {
  return { line2: draft.line2?.trim() || null, phone: draft.phone?.trim() || null };
}

export function missingAddressFields(draft: AddressDraft, countries: readonly ShippingCountry[]): MessageKey[] {
  const missing: MessageKey[] = [];
  if (!draft.country) missing.push('profile.addressForm.country');
  if (!draft.label.trim()) missing.push('profile.addressForm.label');
  if (!draft.recipient.trim()) missing.push('profile.addressForm.recipient');
  if (!draft.line1.trim()) missing.push('profile.addressForm.line1');
  if (!draft.city.trim()) missing.push('profile.addressForm.city');
  if (draft.country && !draft.region?.trim() && regionRequired(draft.country, countries)) {
    missing.push('profile.addressForm.region');
  }
  if (!draft.postalCode.trim()) missing.push('profile.addressForm.postalCode');
  return missing;
}

/**
 * An address as it is written on a parcel: whose it is, and where it goes. What has not been written yet is
 * asked for in the quieter ink, so a label being filled in reads as one, and a saved one as it will be sent.
 */
export function AddressLabel({
  address,
  kicker,
  item,
}: {
  address: AddressDraft;
  kicker: string;
  item?: boolean;
}) {
  const { t } = useI18n();
  const countries = useShippingCountries();
  const quiet = (text: string) => <span className="drawer-tag-quiet">{text}</span>;
  const town = [address.city.trim(), address.region?.trim()].filter(Boolean).join(', ');
  const townLine = [town, address.postalCode.trim()].filter(Boolean).join(' ');

  return (
    <DrawerTag
      kicker={kicker}
      item={item}
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
        {address.line2?.trim() && <span>{address.line2.trim()}</span>}
        <span>{townLine || quiet(t('profile.addressForm.city'))}</span>
        <span>
          {address.country
            ? countryName(address.country, countries)
            : quiet(t('profile.addressForm.country'))}
        </span>
        {address.phone?.trim() && <span dir="ltr">{address.phone.trim()}</span>}
      </address>
    </DrawerTag>
  );
}

export type AddressDraft = Omit<Address, 'id'>;

export function AddressFields({
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
      <Field label={t('profile.addressForm.line2')} htmlFor={`${id}-line2`}>
        <input
          id={`${id}-line2`}
          value={draft.line2 ?? ''}
          maxLength={100}
          onChange={(e) => set({ line2: e.target.value })}
          autoComplete="address-line2"
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
      <Field
        label={t('profile.addressForm.phone')}
        htmlFor={`${id}-phone`}
        hint={draft.country && draft.country !== 'US' ? t('profile.addressForm.phoneAbroadHint') : undefined}
      >
        <input
          id={`${id}-phone`}
          type="tel"
          value={draft.phone ?? ''}
          maxLength={20}
          onChange={(e) => set({ phone: e.target.value })}
          autoComplete="tel"
          inputMode="tel"
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
