import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import { ITEM_CLASSES, itemClassOption } from '../../shared/itemClasses';
import { isValidUsername, normalizeUsername } from '../../shared/names';
import type { ParcelQueueRow } from '../../shared/parcels';
import { BarcodeLabel, BarcodePrintAllButton } from '../../shared/Barcode';
import { PhotoInput, photoKeys, type PhotoRef } from '../../shared/ui/PhotoInput';
import { Button, Field, IconButton } from '../../shared/ui/primitives';
import { IconBox, IconClose, IconPlus } from '../../shared/ui/icons';

/** Where the directed stow wants the next unit to go. */
export interface StowSuggestion {
  id: string;
  serialNumber: string;
  barcode: string;
  zone: string;
  itemCount: number;
  facilityCode: string | null;
}

/**
 * One unit coming out of the box.
 *
 * This replaced a single description plus a QUANTITY stepper, and the reason is
 * what a box actually contains. Quantity books N copies of ONE description — the
 * right instrument for a run of identical commons and the wrong one for the
 * ordinary case, which is a Rayquaza ex, a sealed pack and a graded Gold Star in
 * the same carton. Each needs its own class, its own condition, its own serial
 * and its own photographs, and typing them through a form that cleared itself
 * between each meant re-entering the owner and the parcel every time and never
 * seeing the box's contents as a list before committing any of it.
 */
interface UnitDraft {
  /** Local only — a React key must not be the array index on a list with removals. */
  key: string;
  typeClass: string;
  description: string;
  conditionGrade: string;
  /**
   * Optional pre-assigned serial. Left blank the API mints one, which is the
   * norm. It matters for a card that already has a catalogue photograph on
   * file: photos are stored as /images/<SERIAL>, so booking it in under that
   * same serial is what makes its picture appear.
   */
  serialNumber: string;
  photos: PhotoRef[];
}

let seq = 0;
const blankUnit = (): UnitDraft => ({
  key: `unit-${(seq += 1)}`,
  typeClass: ITEM_CLASSES[0]?.key ?? 'trading_card',
  description: '',
  conditionGrade: '',
  serialNumber: '',
  photos: [],
});

/**
 * The receive bench — emptying a box onto the shelves.
 *
 * THE BOX LEADS. Choosing a parcel fills in the owner and locks it, because the
 * API refuses items booked into a parcel belonging to somebody else — better to
 * make that impossible to express than to explain it in an error. The running
 * count of what has come out of the box is here, and so is the button that
 * closes it out, at the end of the work rather than on another screen.
 *
 * THE SYSTEM PICKS THE SHELF. The default is `autoStow`: the API answers with
 * the emptiest suitable shelf in the building the parcel is actually in, and the
 * panel shows which one so the operator knows where to walk. An operator already
 * standing somewhere else switches to Scan and scans that shelf instead — their
 * claim is better than the system's, because they can see the shelf.
 *
 * NOTHING IS TYPED THAT CAN BE SCANNED. The shelf field takes the Code 128
 * barcode printed on the shelf label, which is what a scanner emits.
 */
export function IntakeBench({
  initialParcelId,
  onLog,
  onDone,
  onParcelClosed,
}: {
  initialParcelId: string;
  onLog: (line: string) => void;
  onDone: () => Promise<void>;
  onParcelClosed: () => void;
}) {
  const { t } = useI18n();

  // Shared by every unit in the run, and asked once.
  const [ownerUsername, setOwnerUsername] = useState('');
  const [parcelId, setParcelId] = useState(initialParcelId);
  const [stowMode, setStowMode] = useState<'auto' | 'scan'>('auto');
  const [scanBin, setScanBin] = useState('');

  const [units, setUnits] = useState<UnitDraft[]>([blankUnit()]);
  const [isLot, setIsLot] = useState(false);
  const [lotSize, setLotSize] = useState(2);

  const [suggestion, setSuggestion] = useState<StowSuggestion | null>(null);
  const [stowError, setStowError] = useState<string | null>(null);
  const [labels, setLabels] = useState<{ id: string; barcode: string; description?: string }[]>([]);
  const [openParcels, setOpenParcels] = useState<ParcelQueueRow[]>([]);
  const [emptyReason, setEmptyReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  const loadParcels = useCallback(async () => {
    try {
      const queue = await api.get<ParcelQueueRow[]>('/parcels');
      setOpenParcels(queue.filter((p) => p.status === 'opened' && p.ownerUsername));
    } catch {
      /* the parcel link is optional; hand intake still works without it */
    }
  }, []);

  useEffect(() => {
    void loadParcels();
  }, [loadParcels]);

  // Arriving from "Book contents": the box that was pressed is the box this is about.
  useEffect(() => {
    if (initialParcelId) setParcelId(initialParcelId);
  }, [initialParcelId]);

  const parcel = openParcels.find((p) => p.id === parcelId) ?? null;

  useEffect(() => {
    if (parcel?.ownerUsername) setOwnerUsername(parcel.ownerUsername);
  }, [parcel?.ownerUsername]);

  const facilityCode = parcel?.facilityCode ?? '';
  // A lot is one record for many things, so it is a property of the WHOLE
  // submission and only ever meaningful for a single unit.
  const single = units.length === 1;
  const firstClass = itemClassOption(units[0]?.typeClass ?? '');
  const lotAllowed = single && (firstClass?.lotEligible ?? true);
  const lotMin = firstClass?.lotMinSize;
  const lotWillSplit = isLot && lotAllowed && lotMin !== undefined && lotSize < lotMin;

  // Oversized shelving is asked for when ANY unit in the run needs it — one
  // suggestion serves the submission, and the wrong kind of shelf for one unit
  // is worse than a larger shelf for the rest.
  const oversized = units.some((u) => itemClassOption(u.typeClass)?.oversized ?? false);

  /**
   * Ask where this goes. Re-asked whenever the answer could change — the classes
   * decide the kind of shelving, the parcel decides the building — and after
   * every submission, because the shelf just handed out is now fuller.
   */
  const askForBin = useCallback(async () => {
    if (stowMode !== 'auto') return;
    try {
      const query = new URLSearchParams();
      if (facilityCode) query.set('facilityCode', facilityCode);
      if (oversized) query.set('oversized', 'true');
      setSuggestion(await api.get<StowSuggestion>(`/custody/bins/suggest?${query.toString()}`));
      setStowError(null);
    } catch (e) {
      setSuggestion(null);
      setStowError((e as Error).message);
    }
  }, [stowMode, facilityCode, oversized]);

  useEffect(() => {
    void askForBin();
  }, [askForBin]);

  const normalizedOwner = normalizeUsername(ownerUsername);
  const ownerOk = isValidUsername(normalizedOwner);
  const stowReady = stowMode === 'scan' ? scanBin.trim() !== '' : suggestion !== null;
  // A unit counts once it says what it is. An entirely blank trailing row is
  // ignored rather than refused — it is the one nobody has reached yet.
  const filled = units.filter((u) => u.description.trim() || u.serialNumber.trim() || u.photos.length > 0);
  const ready = ownerOk && stowReady && filled.length > 0 && !busy;

  const patch = (key: string, next: Partial<UnitDraft>) =>
    setUnits((prev) => prev.map((u) => (u.key === key ? { ...u, ...next } : u)));

  async function submit() {
    setBusy(true);
    try {
      const shared = {
        ownerUsername: normalizedOwner,
        binId: stowMode === 'scan' ? scanBin.trim() : undefined,
        autoStow: stowMode === 'auto',
        parcelId: parcelId || undefined,
      };
      const payload = filled.map((u) => ({
        ...shared,
        typeClass: u.typeClass,
        description: u.description.trim() || undefined,
        conditionGrade: u.conditionGrade.trim() || undefined,
        serialNumber: u.serialNumber.trim() || undefined,
        photoKeys: photoKeys(u.photos),
        // Only ever on a single-unit submission — see `lotAllowed`.
        isLot: single && isLot && lotAllowed,
        lotSize: single && isLot && lotAllowed ? lotSize : undefined,
      }));

      const created = await api.post<{ id: string; barcode: string }[]>('/intake/items/batch', {
        units: payload,
      });
      setLabels(
        created.map((made, index) => ({ ...made, description: filled[index]?.description })),
      );
      onLog(t('intake.bulkDone', { count: created.length }));
      setUnits([blankUnit()]);
      setIsLot(false);
      // The shelf just used is one unit fuller and the box that many emptier;
      // both numbers on screen would otherwise be stale.
      await Promise.all([askForBin(), loadParcels()]);
      await onDone();
    } catch (e) {
      onLog(t('warehouse.log.intakeError', { message: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Close the box out. The API refuses a parcel that produced nothing unless a
   * reason is given, so the field appears exactly when that is the case.
   */
  async function closeParcel() {
    if (!parcel) return;
    setClosing(true);
    try {
      await api.post(`/parcels/${parcel.id}/process`, {
        emptyReason: emptyReason.trim() || undefined,
      });
      onLog(t('warehouse.intake.parcelClosed', { code: parcel.code }));
      setParcelId('');
      setEmptyReason('');
      onParcelClosed();
      await loadParcels();
      await onDone();
    } catch (e) {
      onLog(t('warehouse.log.intakeError', { message: (e as Error).message }));
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="stack stack--tight">
      {/* Shared by every unit in the box — asked once. */}
      <div className="form-grid">
        <Field label={t('warehouse.intake.parcel')} hint={t('warehouse.intake.parcelHint')}>
          <select value={parcelId} onChange={(e) => setParcelId(e.target.value)}>
            <option value="">{t('warehouse.intake.noParcel')}</option>
            {openParcels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.ownerUsername}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t('warehouse.intake.ownerUsername')}
          htmlFor="intake-owner"
          hint={t('warehouse.intake.ownerUsernameHint')}
          error={
            ownerUsername.length > 0 && !ownerOk ? t('warehouse.intake.ownerUsernameInvalid') : undefined
          }
        >
          <input
            id="intake-owner"
            value={ownerUsername}
            onChange={(e) => setOwnerUsername(e.target.value)}
            aria-invalid={ownerUsername.length > 0 && !ownerOk}
            disabled={parcelId !== ''}
            dir="ltr"
          />
        </Field>

        <Field label={t('warehouse.intake.stowMode')} hint={t('warehouse.intake.stowHint')}>
          <select value={stowMode} onChange={(e) => setStowMode(e.target.value as 'auto' | 'scan')}>
            <option value="auto">{t('warehouse.intake.stow.auto')}</option>
            <option value="scan">{t('warehouse.intake.stow.scan')}</option>
          </select>
        </Field>

        {stowMode === 'auto' ? (
          <div className="field">
            <span className="field-label">{t('warehouse.intake.stowTarget')}</span>
            {suggestion ? (
              <>
                <strong dir="ltr">{suggestion.serialNumber}</strong>
                <span className="field-hint">
                  {t('warehouse.intake.stowTargetHint', {
                    zone: suggestion.zone,
                    count: suggestion.itemCount,
                  })}
                </span>
              </>
            ) : (
              <span className="field-error">{stowError ?? t('warehouse.intake.stowSearching')}</span>
            )}
          </div>
        ) : (
          <Field label={t('warehouse.intake.stowScan')} hint={t('warehouse.intake.stowScanHint')}>
            <input
              value={scanBin}
              onChange={(e) => setScanBin(e.target.value)}
              placeholder="BIN-XXXXXXXX"
              dir="ltr"
            />
          </Field>
        )}
      </div>

      {/* One row per unit. */}
      <ul className="parcel-rows">
        {units.map((unit, index) => (
          <li key={unit.key} className="parcel-row">
            <div className="parcel-row-head">
              <span className="parcel-row-index" aria-hidden="true">
                {index + 1}
              </span>
              {units.length > 1 && (
                <IconButton
                  label={t('warehouse.intake.removeUnit', { index: index + 1 })}
                  onClick={() => setUnits((prev) => prev.filter((u) => u.key !== unit.key))}
                >
                  <IconClose />
                </IconButton>
              )}
            </div>

            <div className="form-grid">
              <Field
                label={t('warehouse.intake.typeClass')}
                hint={
                  itemClassOption(unit.typeClass)?.oversized
                    ? t('warehouse.intake.oversizedHint')
                    : undefined
                }
              >
                <select
                  value={unit.typeClass}
                  onChange={(e) => patch(unit.key, { typeClass: e.target.value })}
                >
                  {ITEM_CLASSES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {t(c.labelKey)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t('warehouse.intake.description')}>
                <input
                  value={unit.description}
                  onChange={(e) => patch(unit.key, { description: e.target.value })}
                />
              </Field>

              <Field label={t('warehouse.intake.condition')}>
                <input
                  value={unit.conditionGrade}
                  onChange={(e) => patch(unit.key, { conditionGrade: e.target.value })}
                />
              </Field>

              <Field
                label={t('warehouse.intake.serialNumber')}
                hint={t('warehouse.intake.serialNumberHint')}
              >
                <input
                  value={unit.serialNumber}
                  onChange={(e) => patch(unit.key, { serialNumber: e.target.value })}
                  placeholder={t('warehouse.intake.serialNumberPlaceholder')}
                  dir="ltr"
                />
              </Field>
            </div>

            <PhotoInput
              purpose="item_intake"
              value={unit.photos}
              onChange={(photos) => patch(unit.key, { photos })}
              label={t('warehouse.intake.photos')}
              hint={t('warehouse.intake.photosHint')}
            />
          </li>
        ))}
      </ul>

      <div className="row">
        <Button
          variant="secondary"
          icon={<IconPlus />}
          onClick={() => setUnits((prev) => [...prev, blankUnit()])}
        >
          {t('warehouse.intake.addUnit')}
        </Button>

        {/* A lot is ONE record standing for many things, so it can only describe
            a submission of one. Hidden entirely once there is a second row,
            rather than being offered and then ignored. */}
        {lotAllowed && (
          <label className="check">
            <input type="checkbox" checked={isLot} onChange={(e) => setIsLot(e.target.checked)} />
            {t('intake.isLot')}
          </label>
        )}
        {lotAllowed && isLot && (
          <label className="check">
            {t('intake.lotSize')}
            <input
              type="number"
              min={1}
              value={lotSize}
              onChange={(e) => setLotSize(Math.max(1, Number(e.target.value)))}
              dir="ltr"
              style={{ width: '6rem' }}
            />
          </label>
        )}

        <span className="spacer" />
        <Button variant="gold" icon={<IconPlus />} loading={busy} disabled={!ready} onClick={() => void submit()}>
          {filled.length > 1
            ? t('warehouse.intake.submitMany', { count: filled.length })
            : t('warehouse.intake.submit')}
        </Button>
      </div>

      {lotWillSplit && (
        <p className="field-hint">{t('intake.lotTooSmall', { min: lotMin ?? 0, count: lotSize })}</p>
      )}

      {/* The box being worked through, and the end of the work. The count is the
          reconciliation the workflow never had: an operator can see that nothing
          has come out of this parcel before they close it. */}
      {parcel && (
        <div className="stack stack--tight">
          <p className="hint">
            {t('warehouse.intake.parcelProgress', { code: parcel.code, count: parcel.itemCount })}
          </p>
          {parcel.itemCount === 0 && (
            <Field label={t('warehouse.intake.emptyReason')} hint={t('warehouse.intake.emptyReasonHint')}>
              <input value={emptyReason} onChange={(e) => setEmptyReason(e.target.value)} />
            </Field>
          )}
          <div className="row">
            <span className="spacer" />
            <Button
              variant="secondary"
              icon={<IconBox />}
              disabled={closing || (parcel.itemCount === 0 && emptyReason.trim() === '')}
              onClick={() => void closeParcel()}
            >
              {t('warehouse.intake.closeParcel')}
            </Button>
          </div>
        </div>
      )}

      {/*
        THE END OF THE RUN: the labels for what was just booked in.
        Every item needs one stuck on it before it goes to its shelf, and the
        barcode is what every later scan reads — so the print control is the last
        thing on the bench rather than something to go and find.

        Print all is a SINGLE dialog for the whole run. Booking in a box of twelve
        used to mean twelve trips to the print dialog, twelve confirmations, and
        no way for an operator who missed one to tell which. The per-label button
        stays for the reprint of one that jammed.
      */}
      {labels.length > 0 && (
        <div className="stack stack--tight intake-labels">
          <div className="row">
            <div>
              <h3 className="panel-title" style={{ fontSize: 15 }}>
                {t('warehouse.intake.lastLabels')}
              </h3>
              <p className="hint">{t('warehouse.intake.labelsHint')}</p>
            </div>
            <span className="spacer" />
            <BarcodePrintAllButton
              labels={labels.map((l) => ({ value: l.barcode, caption: l.description || l.barcode }))}
            />
          </div>

          <ul className="card-grid">
            {labels.map((l) => (
              <li key={l.id} className="card">
                <BarcodeLabel value={l.barcode} caption={l.description || l.barcode} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
