import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import { useMediaQuery } from '../../shared/hooks';
import { isValidUsername, normalizeUsername } from '../../shared/names';
import type { InboundAddress } from '../../shared/parcels';
import { Docket, type BenchOutcome } from '../../shared/ui/Docket';
import { PhotoInput, photoKeys, type PhotoRef } from '../../shared/ui/PhotoInput';
import { Button, Field, Panel } from '../../shared/ui/primitives';
import { IconPlus } from '../../shared/ui/icons';
import { code as bdiCode, quiet, stamped } from './Benches';

interface ReceivedParcel {
  code: string;
  status: string;
}

/**
 * Receive what arrived at the door. The docket is the parcel as it will be recorded: the name on it exactly as it
 * was written (that is the only clue there is to whose it is), who brought it, how it can be traced, and how many
 * photographs of the box there are. After it is recorded the docket says what it was recorded as.
 */
export function ReceiveParcels({
  onReceived,
}: {
  onReceived: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const precisePointer = useMediaQuery('(pointer: fine)');
  const [facilities, setFacilities] = useState<InboundAddress[]>([]);
  const [facilityCode, setFacilityCode] = useState('');
  const [carrier, setCarrier] = useState('');
  const [addressedTo, setAddressedTo] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [internationalOrigin, setInternationalOrigin] = useState(false);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<PhotoRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BenchOutcome | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<InboundAddress[]>('/me/inbound-addresses');
        setFacilities(list);
        const preferred = list.find((f) => f.role === 'primary') ?? list[0];
        if (preferred) setFacilityCode(preferred.code);
      } catch {
        // No list of buildings: the bench cannot say where it was received, and does not receive.
      }
    })();
  }, []);

  const labelOk = addressedTo.trim() === '' || isValidUsername(normalizeUsername(addressedTo));
  const said = Boolean(
    addressedTo.trim() || trackingNumber.trim() || notes.trim() || photos.length,
  );
  const ready = facilityCode !== '' && said && labelOk;
  const facility = facilities.find((f) => f.code === facilityCode);

  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setOutcome(null);
    };

  async function receive() {
    setBusy(true);
    // What the server made of it: the bench tells whoever pressed the button, and clears itself only for a parcel that is in.
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
        setOutcome({
          tone: 'success',
          label: t('bench.received'),
          detail: stamped(made ? `${made.code} · ${made.status}` : '', locale),
        });
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
    <Panel title={t('parcelQueue.receive.title')} subtitle={t('parcelQueue.receive.subtitle')}>
      <div className="request-form request-form--bench">
        <div className="stack stack--tight request-form-fields">
          <div className="form-grid">
            <Field
              label={t('parcelQueue.receive.facility')}
              hint={t('parcelQueue.receive.facilityHint')}
            >
              <select value={facilityCode} onChange={(e) => edit(setFacilityCode)(e.target.value)}>
                {facilities.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.name}
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

            <Field label={t('inbound.register.tracking')}>
              <input
                value={trackingNumber}
                onChange={(e) => edit(setTrackingNumber)(e.target.value)}
                dir="ltr"
              />
            </Field>

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
            { label: t('parcelQueue.receive.facility'), value: facility ? facility.name : quiet },
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
              value: photos.length > 0 ? photos.length.toLocaleString() : quiet,
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
        </div>
      </div>
    </Panel>
  );
}
