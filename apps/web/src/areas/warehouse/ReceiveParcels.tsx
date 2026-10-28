import { useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import { useMediaQuery } from '../../shared/hooks';
import { isValidUsername, normalizeUsername } from '../../shared/names';
import type { InboundAddress } from '../../shared/parcels';
import { PhotoInput, photoKeys, type PhotoRef } from '../../shared/ui/PhotoInput';
import { Button, Field, Panel } from '../../shared/ui/primitives';
import { IconPlus } from '../../shared/ui/icons';


export function ReceiveParcels({
  onReceived,
}: {
  onReceived: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const { t } = useI18n();
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

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<InboundAddress[]>('/me/inbound-addresses');
        setFacilities(list);
        const preferred = list.find((f) => f.role === 'primary') ?? list[0];
        if (preferred) setFacilityCode(preferred.code);
      } catch {
      }
    })();
  }, []);

  const labelOk = addressedTo.trim() === '' || isValidUsername(normalizeUsername(addressedTo));
  const said = Boolean(addressedTo.trim() || trackingNumber.trim() || notes.trim() || photos.length);
  const ready = facilityCode !== '' && said && labelOk;

  async function receive() {
    setBusy(true);
    try {
      await onReceived(
        () =>
          api.post('/parcels/receive/batch', {
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
          }),
        t('parcelQueue.received'),
      );
      setAddressedTo('');
      setTrackingNumber('');
      setNotes('');
      setInternationalOrigin(false);
      setPhotos([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('parcelQueue.receive.title')} subtitle={t('parcelQueue.receive.subtitle')}>
      <div className="stack stack--tight">
        <div className="form-grid">
          <Field label={t('parcelQueue.receive.facility')} hint={t('parcelQueue.receive.facilityHint')}>
            <select value={facilityCode} onChange={(e) => setFacilityCode(e.target.value)}>
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
              onChange={(e) => setAddressedTo(e.target.value)}
              aria-invalid={!labelOk}
              autoFocus={precisePointer}
              spellCheck={false}
              autoComplete="off"
              dir="ltr"
            />
          </Field>

          <Field label={t('inbound.register.carrier')}>
            <input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          </Field>

          <Field label={t('inbound.register.tracking')}>
            <input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              dir="ltr"
            />
          </Field>

          <Field label={t('warehouse.notes')}>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        <PhotoInput
          purpose="parcel"
          value={photos}
          onChange={setPhotos}
          label={t('parcelQueue.receive.photos')}
          hint={t('parcelQueue.receive.photosHint')}
        />

        <div className="row">
          <label className="check">
            <input
              type="checkbox"
              checked={internationalOrigin}
              onChange={(e) => setInternationalOrigin(e.target.checked)}
            />
            {t('inbound.register.international')}
          </label>
          <span className="spacer" />
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
