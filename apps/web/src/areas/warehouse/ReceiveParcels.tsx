import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import { useMediaQuery } from '../../shared/hooks';
import { isValidUsername, normalizeUsername } from '../../shared/names';
import type { InboundAddress } from '../../shared/parcels';
import { PhotoInput, photoKeys, type PhotoRef } from '../../shared/ui/PhotoInput';
import { Button, ErrorState, Field, Panel, SuccessNote } from '../../shared/ui/primitives';
import { IconPlus } from '../../shared/ui/icons';

/**
 * Booking one arrival in, with photographs of how it turned up.
 *
 * This briefly grew a list of rows so a courier's whole delivery could be
 * received at once, and the rows were on the wrong form. Receiving a parcel is a
 * scan and a label — one field's worth of work per box — whereas a BOX holds
 * several different units, each needing its own class, condition, serial and
 * photographs. The rows moved to the intake bench, where that is the shape of
 * the work; see `IntakeBench`.
 *
 * It still posts to `/parcels/receive/batch` with a single entry. The route is
 * what makes the submission atomic, it costs nothing to keep, and a bench that
 * later wants to scan a stack has it waiting.
 */


export function ReceiveParcels({
  onReceived,
}: {
  onReceived: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const { t } = useI18n();
  /** A mouse or a trackpad, rather than a finger — see the autoFocus below. */
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
  /**
   * The facility list failing used to be swallowed: the select stayed empty and
   * Receive stayed disabled with nothing on screen to say why.
   */
  const [facilityError, setFacilityError] = useState<string | null>(null);
  /** The result of the last receive, shown next to the button that did it. */
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const loadFacilities = useCallback(async () => {
    try {
      const list = await api.get<InboundAddress[]>('/me/inbound-addresses');
      setFacilities(list);
      setFacilityError(null);
      const preferred = list.find((f) => f.role === 'primary') ?? list[0];
      if (preferred) setFacilityCode((current) => current || preferred.code);
    } catch (e) {
      setFacilityError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadFacilities();
  }, [loadFacilities]);

  // The label is typed as written and may resolve to nothing; what it must not
  // be is malformed, because then it names nobody and nothing can be looked up.
  const labelOk = addressedTo.trim() === '' || isValidUsername(normalizeUsername(addressedTo));
  const said = Boolean(addressedTo.trim() || trackingNumber.trim() || notes.trim() || photos.length);
  const ready = facilityCode !== '' && said && labelOk;

  async function receive() {
    setBusy(true);
    const done = t('parcelQueue.received');
    // The console reports a failure itself and does not rethrow, so the form is
    // cleared only when the receive actually went through.
    let received = false;
    try {
      await onReceived(
        async () => {
          try {
            await api.post('/parcels/receive/batch', {
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
            received = true;
            setNote({ ok: true, text: done });
          } catch (e) {
            setNote({ ok: false, text: (e as Error).message });
            throw e;
          }
        },
        done,
      );
      if (!received) return;
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
        {facilityError && (
          <ErrorState message={facilityError} onRetry={() => void loadFacilities()} retryLabel={t('ui.retry')} />
        )}
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
            {/*
              The next action, focused.

              A box has landed and the first thing an operator does is read the
              name off it. On a bench worked standing up with one hand on a
              scanner, the cursor being already in the right field is the
              difference between a keyboard flow and a mouse one.

              Gated on a fine pointer: on a touch device `autoFocus` opens the
              keyboard over the screen before anybody has decided to type, which
              is the reason the guidelines warn against it.

              `spellCheck` off — this is a username, and a red squiggle under
              somebody's account name is noise on a field that must be typed
              EXACTLY as written.
            */}
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

        {/* Evidence of how the box turned up, taken before it is opened — which
            is the only moment it can be taken. */}
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
          <Button variant="gold" icon={<IconPlus />} loading={busy} disabled={!ready} onClick={() => void receive()}>
            {t('parcelQueue.receive.submit')}
          </Button>
        </div>
        {note && (note.ok ? <SuccessNote>{note.text}</SuccessNote> : <ErrorState message={note.text} />)}
      </div>
    </Panel>
  );
}
