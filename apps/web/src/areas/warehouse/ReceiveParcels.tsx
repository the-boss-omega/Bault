import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import { useMediaQuery } from '../../shared/hooks';
import { isValidUsername, normalizeUsername } from '../../shared/names';
import { parcelStatusLabel, type InboundAddress } from '../../shared/parcels';
import { Docket, type BenchOutcome } from '../../shared/ui/Docket';
import { PhotoInput, photoKeys, type PhotoRef } from '../../shared/ui/PhotoInput';
import { Button, ErrorState, Field, Panel, ScanField, StatusBadge } from '../../shared/ui/primitives';
import { IconPlus } from '../../shared/ui/icons';
import { code as bdiCode, quiet, stamped } from './Benches';
import { OcrReview } from './OcrReview';

export type BenchFacility = InboundAddress & { placeholder?: boolean };

export function facilityAddress(f: BenchFacility): string {
  return [...(f.lines ?? []), [f.city, f.region, f.postalCode].filter(Boolean).join(' '), f.country]
    .filter((part) => part && part.trim())
    .join(', ');
}

interface ReceivedParcel {
  id: string;
  code: string;
  status: string;
}

export function ReceiveParcels({
  onReceived,
  onRead,
}: {
  onReceived: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  onRead?: () => void;
}) {
  const { t, locale } = useI18n();
  const precisePointer = useMediaQuery('(pointer: fine)');
  const [facilities, setFacilities] = useState<BenchFacility[]>([]);
  const [facilitiesError, setFacilitiesError] = useState<string | null>(null);
  const [facilityCode, setFacilityCode] = useState('');
  const [carrier, setCarrier] = useState('');
  const [addressedTo, setAddressedTo] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [internationalOrigin, setInternationalOrigin] = useState(false);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<PhotoRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BenchOutcome | null>(null);
  const [toRead, setToRead] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);

  const loadFacilities = useCallback(async () => {
    try {
      const list = await api.get<BenchFacility[]>('/me/inbound-addresses');
      setFacilities(list);
      setFacilitiesError(null);
      const preferred = list.find((f) => f.role === 'primary') ?? list[0];
      if (preferred) setFacilityCode((current) => current || preferred.code);
    } catch (e) {
      setFacilitiesError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadFacilities();
  }, [loadFacilities]);

  const labelOk = addressedTo.trim() === '' || isValidUsername(normalizeUsername(addressedTo));
  const said = Boolean(
    addressedTo.trim() || trackingNumber.trim() || notes.trim() || photos.length,
  );
  const ready = facilityCode !== '' && said && labelOk;
  const facility = facilities.find((f) => f.code === facilityCode);
  const missing = [
    ...(facilityCode === '' ? [t('warehouse.receive.missingFacility')] : []),
    ...(!said ? [t('warehouse.receive.missingClue')] : []),
    ...(!labelOk ? [t('warehouse.receive.missingLabel')] : []),
  ];

  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setOutcome(null);
      setNext(null);
    };

  async function receive() {
    setBusy(true);
    const result: { rows: ReceivedParcel[] | null } = { rows: null };
    try {
      await onReceived(async () => {
        try {
          result.rows = await api.post<ReceivedParcel[]>('/parcels/receive/batch', {
            parcels: [
              {
                facilityCode,
                addressedTo: addressedTo.trim() || undefined,
                carrier: carrier.trim() || undefined,
                trackingNumber: trackingNumber.trim() || undefined,
                internationalOrigin,
                notes: notes.trim() || undefined,
                photoKeys: photoKeys(photos),
              },
            ],
          });
        } catch (e) {
          setOutcome({ tone: 'error', label: t('bench.notDone'), detail: (e as Error).message });
          throw e;
        }
      }, t('parcelQueue.received'));
      if (result.rows) {
        const [made] = result.rows;
        setToRead(made && photos.length > 0 ? made.id : null);
        setOutcome({
          tone: 'success',
          label: t('bench.received'),
          detail: stamped(
            made ? [made.code, made.status ? parcelStatusLabel(t, made.status) : ''].filter(Boolean).join(' · ') : '',
            locale,
          ),
        });
        setNext(made ? t(made.status === 'unclaimed' ? 'warehouse.receive.nextUnclaimed' : 'warehouse.receive.next', { code: made.code }) : null);
        setAddressedTo('');
        setTrackingNumber('');
        setNotes('');
        setInternationalOrigin(false);
        setPhotos([]);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel id="receive-arrival" title={t('parcelQueue.receive.title')} subtitle={t('parcelQueue.receive.subtitle')}>
      {facilitiesError && (
        <ErrorState
          title={t('warehouse.receive.facilitiesFailed')}
          message={facilitiesError}
          onRetry={() => void loadFacilities()}
          retryLabel={t('ui.retry')}
        />
      )}
      {!facilitiesError && facility?.placeholder && (
        <div className="drawer-note drawer-note--hold">
          <span>{t('warehouse.receive.noAddressNote', { name: facility.name })}</span>
        </div>
      )}
      <div className="request-form request-form--bench">
        <div className="stack stack--tight request-form-fields">
          <div className="form-grid">
            <Field
              label={t('parcelQueue.receive.facility')}
              hint={
                facility?.placeholder
                  ? t('warehouse.receive.noAddress')
                  : facility && facilityAddress(facility)
                    ? t('warehouse.receive.address', { address: facilityAddress(facility) })
                    : t('parcelQueue.receive.facilityHint')
              }
            >
              <select value={facilityCode} onChange={(e) => edit(setFacilityCode)(e.target.value)}>
                {facilities.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.placeholder ? t('warehouse.receive.optionNoAddress', { name: f.name }) : f.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label={t('parcelQueue.receive.label')}
              hint={t('parcelQueue.receive.labelHint')}
              error={labelOk ? undefined : t('warehouse.intake.ownerUsernameInvalid')}
            >
              <input
                value={addressedTo}
                onChange={(e) => edit(setAddressedTo)(e.target.value)}
                aria-invalid={!labelOk}
                autoFocus={precisePointer}
                spellCheck={false}
                autoComplete="off"
                dir="ltr"
              />
            </Field>

            <Field label={t('inbound.register.carrier')}>
              <input
                value={carrier}
                onChange={(e) => edit(setCarrier)(e.target.value)}
                dir="auto"
              />
            </Field>

            <ScanField
              label={t('inbound.register.tracking')}
              value={trackingNumber}
              onChange={edit(setTrackingNumber)}
              onScan={() => {
                if (ready && !busy) void receive();
              }}
            />

            <Field label={t('warehouse.notes')}>
              <input value={notes} onChange={(e) => edit(setNotes)(e.target.value)} dir="auto" />
            </Field>
          </div>

          <PhotoInput
            purpose="parcel"
            value={photos}
            onChange={edit(setPhotos)}
            label={t('parcelQueue.receive.photos')}
            hint={t('parcelQueue.receive.photosHint')}
          />

          <label className="check">
            <input
              type="checkbox"
              checked={internationalOrigin}
              onChange={(e) => edit(setInternationalOrigin)(e.target.checked)}
            />
            {t('inbound.register.international')}
          </label>
        </div>

        <Docket
          kicker={t('bench.kicker.arrival')}
          title={
            addressedTo.trim() ? (
              bdiCode(addressedTo.trim())
            ) : (
              <span className="drawer-tag-quiet">{t('parcelQueue.receive.label')}</span>
            )
          }
          lines={[
            {
              label: t('parcelQueue.receive.facility'),
              value: facility ? (
                facility.placeholder ? (
                  <>
                    {facility.name}{' '}
                    <StatusBadge tone="warning" plain>
                      {t('warehouse.receive.noAddressBadge')}
                    </StatusBadge>
                  </>
                ) : (
                  facility.name
                )
              ) : (
                quiet
              ),
            },
            {
              label: t('inbound.register.carrier'),
              value: carrier.trim() ? <bdi dir="auto">{carrier.trim()}</bdi> : quiet,
            },
            {
              label: t('inbound.register.tracking'),
              value: trackingNumber.trim() ? bdiCode(trackingNumber.trim()) : quiet,
            },
            {
              label: t('bench.photos'),
              value: photos.length > 0 ? photos.length.toLocaleString('en-US') : quiet,
            },
            ...(notes.trim()
              ? [{ label: t('warehouse.notes'), value: <bdi dir="auto">{notes.trim()}</bdi> }]
              : []),
            ...(internationalOrigin
              ? [{ label: t('bench.origin'), value: t('bench.outsideUS') }]
              : []),
          ]}
          outcome={outcome}
        />

        <div className="row request-form-actions">
          <Button
            variant="primary"
            icon={<IconPlus />}
            loading={busy}
            disabled={!ready}
            onClick={() => void receive()}
          >
            {t('parcelQueue.receive.submit')}
          </Button>
          {!ready && !busy && missing.length > 0 && (
            <span className="field-hint">{t('warehouse.missing', { list: missing.join('; ') })}</span>
          )}
          {next && <span className="field-hint" role="status">{next}</span>}
        </div>
      </div>
      {toRead && <OcrReview key={toRead} subject="parcel" id={toRead} onSaved={onRead} />}
    </Panel>
  );
}
