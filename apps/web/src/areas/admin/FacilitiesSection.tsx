import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { regionRequired, useShippingCountries } from '../../shared/countries';
import { useI18n } from '../../shared/i18n';
import type { MessageKey } from '../../shared/i18n';
import { taxRateLabel } from '../../shared/parcels';
import { useNavigation, useRoute } from '../../shared/routing';
import { DetailDrawer } from '../../shared/ui/DetailDrawer';
import { DrawerTag } from '../../shared/ui/DrawerTag';
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
} from '../../shared/ui/primitives';
import { IconLocation, IconPlus } from '../../shared/ui/icons';
import { Code } from '../../shared/ui/Serial';
import {
  CODE_PATTERN,
  MAX_FORWARDING_DAYS,
  changesBody,
  draftOf,
  isUnchanged,
  newFacilityBody,
  percentToBps,
  previewLines,
  problemsOf,
  type AdminFacility,
  type FacilityDraft,
} from './facilities';

const ROLE_LABEL: Record<AdminFacility['role'], MessageKey> = {
  primary: 'facility.role.primary',
  forwarding: 'facility.role.forwarding',
};

/**
 * The places parcels are sent to and shipped from, as a roll: what each is called, what it does, and whether
 * customers are being shown it. A facility is opened to be changed (or a new one is opened blank) on a card with
 * the form beside it in a drawer, and the drawer's tag is the address as a customer is given it.
 */
export function FacilitiesSection({
  onMsg,
  onError,
}: {
  onMsg: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const route = useRoute();
  const { openRecord, closeRecord } = useNavigation(route);
  const [rows, setRows] = useState<AdminFacility[] | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<AdminFacility[]>('/admin/facilities'));
    } catch (e) {
      onError((e as Error).message);
      setRows([]);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const openId = route.params.facility ?? null;
  const adding = openId === 'new';
  const open = rows?.find((f) => f.id === openId) ?? null;

  return (
    <>
      <Panel
        title={t('facility.heading', { count: rows?.length ?? 0 })}
        subtitle={t('facility.subtitle')}
        tools={
          <Button
            variant="primary"
            size="sm"
            icon={<IconPlus />}
            onClick={() => openRecord('facility', 'new')}
          >
            {t('facility.add')}
          </Button>
        }
        flush
      >
        {rows === null ? (
          <SkeletonTable rows={3} columns={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('facility.empty')}
            text={t('facility.emptyText')}
            icon={<IconLocation />}
          />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('facility.col.facility')}</th>
                  <th scope="col">{t('facility.col.role')}</th>
                  <th scope="col">{t('admin.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr
                    key={f.id}
                    className={'is-clickable' + (f.id === openId ? ' is-selected' : '')}
                    onClick={() => openRecord('facility', f.id)}
                  >
                    <td data-label={t('facility.col.facility')} className="dt-primary">
                      <button
                        type="button"
                        className="register-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          openRecord('facility', f.id);
                        }}
                      >
                        <bdi dir="auto">{f.name}</bdi>
                      </button>
                      <span className="dt-sub">
                        <Code value={f.code} /> · <bdi dir="auto">{placeOf(f)}</bdi>
                      </span>
                    </td>
                    <td data-label={t('facility.col.role')}>
                      {t(ROLE_LABEL[f.role])}
                      {f.role === 'forwarding' && f.forwardsToCode && (
                        <span className="dt-sub">
                          {t('facility.forwardsTo', {
                            code: f.forwardsToCode,
                            days: f.forwardingDays ?? 0,
                          })}
                        </span>
                      )}
                    </td>
                    <td data-label={t('admin.col.status')}>
                      <div className="row roll-status">
                        <StatusBadge tone={f.active ? 'success' : 'neutral'}>
                          {t(f.active ? 'facility.status.active' : 'facility.status.off')}
                        </StatusBadge>
                        {f.placeholder && (
                          <StatusBadge tone="warning">
                            {t('facility.status.placeholder')}
                          </StatusBadge>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {adding && (
        <FacilityDrawer
          key="new"
          facility={null}
          all={rows ?? []}
          onClose={() => closeRecord('facility')}
          onCreated={(created) => {
            setRows((list) => [...(list ?? []), created]);
            onMsg(t('facility.created', { name: created.name }));
            closeRecord('facility');
          }}
          onChanged={() => undefined}
        />
      )}
      {open && (
        <FacilityDrawer
          key={open.id}
          facility={open}
          all={rows ?? []}
          onClose={() => closeRecord('facility')}
          onCreated={() => undefined}
          onChanged={(saved) =>
            setRows((list) => list?.map((f) => (f.id === saved.id ? saved : f)) ?? list)
          }
        />
      )}
    </>
  );
}

function placeOf(f: Pick<AdminFacility, 'city' | 'region' | 'country'>): string {
  return [f.city, f.region || f.country].filter(Boolean).join(', ');
}

function FacilityDrawer({
  facility,
  all,
  onClose,
  onCreated,
  onChanged,
}: {
  /** The facility being changed; none for a new one. */
  facility: AdminFacility | null;
  all: AdminFacility[];
  onClose: () => void;
  onCreated: (created: AdminFacility) => void;
  onChanged: (saved: AdminFacility) => void;
}) {
  const { t } = useI18n();
  const countries = useShippingCountries();
  const isNew = facility === null;
  const [draft, setDraft] = useState<FacilityDraft>(() => draftOf(facility));
  // What the last thing done here came to is told here, in the drawer: the page's own line is behind its backdrop.
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (change: Partial<FacilityDraft>) => setDraft((d) => ({ ...d, ...change }));

  const country = countries.find((c) => c.code === draft.country);
  const regionNeeded = regionRequired(draft.country, countries);
  const problems = problemsOf(draft, { isNew, regionNeeded });
  const edited = !isUnchanged(draft, facility);
  const ready = problems.length === 0 && (isNew || edited);
  const role = facility?.role ?? draft.role;
  const bps = percentToBps(draft.taxPercent);
  const targets = all.filter(
    (f) => f.role === 'primary' && (f.active || f.id === draft.forwardsTo) && f.id !== facility?.id,
  );
  const target = all.find((f) => f.id === draft.forwardsTo);

  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (facility === null) {
        onCreated(await api.post<AdminFacility>('/admin/facilities', newFacilityBody(draft)));
      } else {
        const saved = await api.patch<AdminFacility>(
          `/admin/facilities/${facility.id}`,
          changesBody(draft, facility.role),
        );
        onChanged(saved);
        setNotice({ ok: true, text: t('facility.saved', { name: saved.name }) });
      }
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function switchUse() {
    if (!facility || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const saved = await api.patch<AdminFacility>(`/admin/facilities/${facility.id}`, {
        active: !facility.active,
      });
      onChanged(saved);
      setNotice({
        ok: true,
        text: t(saved.active ? 'facility.putBack' : 'facility.takenOut', { name: saved.name }),
      });
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const name = draft.name.trim();
  const codeTyped = draft.code.trim().toUpperCase();
  const codeWrong = isNew && codeTyped !== '' && !CODE_PATTERN.test(codeTyped);
  const taxWrong = draft.taxPercent.trim() !== '' && bps === null;
  const daysTyped = draft.days.trim() !== '';
  const daysWrong = daysTyped && problems.includes('days');

  return (
    <DetailDrawer
      title={isNew ? t('facility.new') : facility.name}
      subtitle={isNew ? undefined : <Code value={facility.code} />}
      onClose={onClose}
      dirty={edited}
      notice={
        notice &&
        (notice.ok ? (
          <SuccessNote>{notice.text}</SuccessNote>
        ) : (
          <ErrorState message={notice.text} />
        ))
      }
      footer={
        <>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void save()}>
            {t(isNew ? 'facility.create' : 'admin.action.save')}
          </Button>
          {facility && (
            <Button variant="secondary" disabled={busy} onClick={() => void switchUse()}>
              {t(facility.active ? 'facility.takeOut' : 'facility.putBackIn')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('ui.close')}
          </Button>
        </>
      }
    >
      {/* The address as a customer is given it, written as it is typed. */}
      <DrawerTag
        kicker={t('facility.tag')}
        title={
          name ? (
            <bdi dir="auto">{name}</bdi>
          ) : (
            <span className="drawer-tag-quiet">{t('facility.field.name')}</span>
          )
        }
        lines={[
          { label: t('facility.field.role'), value: t(ROLE_LABEL[role]) },
          {
            label: t('facility.field.tax'),
            value: <span dir="ltr">{bps === null ? '—' : taxRateLabel(bps)}</span>,
          },
          ...(role === 'forwarding'
            ? [
                {
                  label: t('facility.field.forwardsTo'),
                  value: target ? (
                    <Code value={target.code} />
                  ) : (
                    <span className="drawer-tag-quiet">—</span>
                  ),
                },
              ]
            : []),
        ]}
        status={
          <>
            <StatusBadge tone={facility && !facility.active ? 'neutral' : 'success'}>
              {t(facility && !facility.active ? 'facility.status.off' : 'facility.status.active')}
            </StatusBadge>
            {facility?.placeholder && (
              <StatusBadge tone="warning">{t('facility.status.placeholder')}</StatusBadge>
            )}
          </>
        }
      >
        <pre className="address-block" dir="ltr">
          {previewLines(draft).join('\n')}
        </pre>
      </DrawerTag>

      {facility?.placeholder && (
        <div className="drawer-note drawer-note--hold">
          <span>{t('facility.placeholderNote')}</span>
        </div>
      )}
      {facility && !facility.active && (
        <div className="drawer-note drawer-note--hold">
          <span>{t('facility.offNote')}</span>
        </div>
      )}

      <div className="stack stack--tight drawer-fields">
        <div className="form-grid">
          {isNew && (
            <Field
              label={t('facility.field.code')}
              hint={t('facility.field.codeHint')}
              error={codeWrong ? t('facility.field.codeWrong') : undefined}
            >
              <input
                value={draft.code}
                maxLength={8}
                spellCheck={false}
                autoComplete="off"
                dir="ltr"
                aria-invalid={codeWrong}
                onChange={(e) => set({ code: e.target.value.toUpperCase() })}
              />
            </Field>
          )}
          <Field label={t('facility.field.name')}>
            <input
              value={draft.name}
              maxLength={80}
              dir="auto"
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          {isNew && (
            <Field
              label={t('facility.field.role')}
              hint={t(`facility.roleHint.${draft.role}` as MessageKey)}
            >
              <select
                value={draft.role}
                onChange={(e) =>
                  set({
                    role: e.target.value as FacilityDraft['role'],
                    forwardsTo: '',
                    days: '',
                  })
                }
              >
                <option value="primary">{t('facility.role.primary')}</option>
                <option value="forwarding">{t('facility.role.forwarding')}</option>
              </select>
            </Field>
          )}
          {role === 'forwarding' && (
            <>
              <Field label={t('facility.field.forwardsTo')}>
                <select
                  value={draft.forwardsTo}
                  onChange={(e) => set({ forwardsTo: e.target.value })}
                >
                  <option value="">{t('profile.addressForm.regionPlaceholder')}</option>
                  {targets.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={t('facility.field.days')}
                hint={t('facility.field.daysHint')}
                error={
                  daysWrong
                    ? t('facility.field.daysWrong', { max: MAX_FORWARDING_DAYS })
                    : undefined
                }
              >
                <input
                  type="number"
                  min={1}
                  max={MAX_FORWARDING_DAYS}
                  value={draft.days}
                  dir="ltr"
                  aria-invalid={daysWrong}
                  onChange={(e) => set({ days: e.target.value })}
                />
              </Field>
            </>
          )}
          <Field label={t('profile.addressForm.line1')}>
            <input
              value={draft.line1}
              maxLength={120}
              autoComplete="off"
              dir="auto"
              onChange={(e) => set({ line1: e.target.value })}
            />
          </Field>
          <Field label={t('facility.field.line2')}>
            <input
              value={draft.line2}
              maxLength={120}
              autoComplete="off"
              dir="auto"
              onChange={(e) => set({ line2: e.target.value })}
            />
          </Field>
          <Field label={t('profile.addressForm.city')}>
            <input
              value={draft.city}
              maxLength={80}
              autoComplete="off"
              dir="auto"
              onChange={(e) => set({ city: e.target.value })}
            />
          </Field>
          <Field label={t('profile.addressForm.country')}>
            <select
              value={draft.country}
              onChange={(e) => set({ country: e.target.value, region: '' })}
            >
              {!countries.some((c) => c.code === draft.country) && (
                <option value={draft.country}>{draft.country || '—'}</option>
              )}
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('profile.addressForm.region')}>
            {country?.regions ? (
              <select value={draft.region} onChange={(e) => set({ region: e.target.value })}>
                <option value="">{t('profile.addressForm.regionPlaceholder')}</option>
                {country.regions.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.code} — {r.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={draft.region}
                maxLength={60}
                autoComplete="off"
                dir="auto"
                onChange={(e) => set({ region: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('profile.addressForm.postalCode')}>
            <input
              value={draft.postalCode}
              maxLength={20}
              autoComplete="off"
              dir="ltr"
              onChange={(e) => set({ postalCode: e.target.value })}
            />
          </Field>
          <Field label={t('facility.field.phone')}>
            <input
              type="tel"
              value={draft.phone}
              maxLength={40}
              autoComplete="off"
              dir="ltr"
              onChange={(e) => set({ phone: e.target.value })}
            />
          </Field>
          <Field
            label={t('facility.field.tax')}
            hint={t('facility.field.taxHint')}
            error={taxWrong ? t('facility.field.taxWrong') : undefined}
          >
            <input
              inputMode="decimal"
              value={draft.taxPercent}
              maxLength={5}
              autoComplete="off"
              dir="ltr"
              aria-invalid={taxWrong}
              onChange={(e) => set({ taxPercent: e.target.value })}
            />
          </Field>
        </div>
      </div>
    </DetailDrawer>
  );
}
