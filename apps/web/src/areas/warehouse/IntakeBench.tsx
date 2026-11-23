import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import { ITEM_CLASSES, itemClassOption } from '../../shared/itemClasses';
import { isValidUsername, normalizeUsername } from '../../shared/names';
import type { ParcelQueueRow } from '../../shared/parcels';
import { BarcodeLabel, BarcodePrintAllButton } from '../../shared/Barcode';
import { Docket, type BenchOutcome } from '../../shared/ui/Docket';
import { PhotoInput, photoKeys, type PhotoRef } from '../../shared/ui/PhotoInput';
import { Button, Field, IconButton, ScanField } from '../../shared/ui/primitives';
import { IconBox, IconClose, IconPlus } from '../../shared/ui/icons';
import { code as bdiCode, quiet, stamped } from './Benches';

export interface StowSuggestion {
  id: string;
  serialNumber: string;
  barcode: string;
  zone: string;
  itemCount: number;
  facilityCode: string | null;
}

type StowMode = 'auto' | 'scan' | 'later';

export const LATER_REASONS = [
  { key: 'shelfFull', labelKey: 'warehouse.intake.laterReason.shelfFull' },
  { key: 'oversized', labelKey: 'warehouse.intake.laterReason.oversized' },
  { key: 'grading', labelKey: 'warehouse.intake.laterReason.grading' },
  { key: 'other', labelKey: 'warehouse.intake.laterReason.other' },
] as const;

type LaterReason = (typeof LATER_REASONS)[number]['key'];

interface UnitDraft {
  key: string;
  typeClass: string;
  description: string;
  conditionGrade: string;
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
  const { t, locale } = useI18n();

  const [ownerUsername, setOwnerUsername] = useState('');
  const [parcelId, setParcelId] = useState(initialParcelId);
  const [stowMode, setStowMode] = useState<StowMode>('auto');
  const [scanBin, setScanBin] = useState('');
  const [laterReason, setLaterReason] = useState<LaterReason>('shelfFull');
  const [laterOther, setLaterOther] = useState('');

  const [units, setUnits] = useState<UnitDraft[]>([blankUnit()]);
  const [isLot, setIsLot] = useState(false);
  const [lotSize, setLotSize] = useState(2);

  const [suggestion, setSuggestion] = useState<StowSuggestion | null>(null);
  const [stowError, setStowError] = useState<string | null>(null);
  const [rescueZone, setRescueZone] = useState('');
  const [rescuing, setRescuing] = useState(false);
  const [labels, setLabels] = useState<{ id: string; barcode: string; description?: string }[]>([]);
  const [openParcels, setOpenParcels] = useState<ParcelQueueRow[]>([]);
  const [emptyReason, setEmptyReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [outcome, setOutcome] = useState<BenchOutcome | null>(null);

  const loadParcels = useCallback(async () => {
    try {
      const queue = await api.get<ParcelQueueRow[]>('/parcels');
      setOpenParcels(queue.filter((p) => p.status === 'opened' && p.ownerUsername));
    } catch {}
  }, []);

  useEffect(() => {
    void loadParcels();
  }, [loadParcels]);

  useEffect(() => {
    if (!initialParcelId) return;
    setParcelId(initialParcelId);
    void loadParcels();
  }, [initialParcelId, loadParcels]);

  const parcel = openParcels.find((p) => p.id === parcelId) ?? null;

  useEffect(() => {
    if (parcel?.ownerUsername) setOwnerUsername(parcel.ownerUsername);
  }, [parcel?.ownerUsername]);

  const facilityCode = parcel?.facilityCode ?? '';
  const single = units.length === 1;
  const firstClass = itemClassOption(units[0]?.typeClass ?? '');
  const lotAllowed = single && (firstClass?.lotEligible ?? true);
  const lotMin = firstClass?.lotMinSize;
  const lotWillSplit = isLot && lotAllowed && lotMin !== undefined && lotSize < lotMin;

  const oversized = units.some((u) => itemClassOption(u.typeClass)?.oversized ?? false);

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

  async function createBinHere() {
    setRescuing(true);
    try {
      const created = await api.post<{ serialNumber: string; zone: string }>('/custody/bins', {
        zone: rescueZone.trim(),
        facilityCode: facilityCode || undefined,
        oversized,
      });
      onLog(t('warehouse.log.binCreated', { serial: created.serialNumber, zone: created.zone }));
      setRescueZone('');
      await askForBin();
    } catch (e) {
      setStowError((e as Error).message);
    } finally {
      setRescuing(false);
    }
  }

  const normalizedOwner = normalizeUsername(ownerUsername);
  const ownerOk = isValidUsername(normalizedOwner);
  const laterText =
    laterReason === 'other'
      ? laterOther.trim()
      : t(LATER_REASONS.find((r) => r.key === laterReason)!.labelKey);
  const stowReady =
    stowMode === 'scan'
      ? scanBin.trim() !== ''
      : stowMode === 'later'
        ? laterText !== ''
        : suggestion !== null;
  const filled = units.filter(
    (u) => u.description.trim() || u.serialNumber.trim() || u.photos.length > 0,
  );
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
        ...(stowMode === 'later' ? { placement: 'later' as const, placementReason: laterText } : {}),
        parcelId: parcelId || undefined,
      };
      const payload = filled.map((u) => ({
        ...shared,
        typeClass: u.typeClass,
        description: u.description.trim() || undefined,
        conditionGrade: u.conditionGrade.trim() || undefined,
        serialNumber: u.serialNumber.trim() || undefined,
        photoKeys: photoKeys(u.photos),
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
      setOutcome({
        tone: 'success',
        label: t('bench.bookedIn'),
        detail: stamped(
          `${created.length.toLocaleString()} → ${shelfName}`,
          locale,
        ),
      });
      setUnits([blankUnit()]);
      setIsLot(false);
      await Promise.all([askForBin(), loadParcels()]);
      await onDone();
    } catch (e) {
      const message = (e as Error).message;
      onLog(t('warehouse.log.intakeError', { message }));
      setOutcome({ tone: 'error', label: t('bench.notDone'), detail: message });
    } finally {
      setBusy(false);
    }
  }

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

  // The intake as it will be recorded: whose, from which box, onto which shelf, and a line for each unit that has been described.
  const shelfName =
    stowMode === 'scan'
      ? scanBin.trim()
      : stowMode === 'later'
        ? t('warehouse.intake.shelfLater')
        : (suggestion?.serialNumber ?? '');
  const unitLines = filled.map((u, index) => {
    const option = itemClassOption(u.typeClass);
    const kind = option ? t(option.labelKey) : u.typeClass;
    return {
      label: (
        <>
          {index + 1}. <bdi dir="auto">{u.description.trim() || kind}</bdi>
        </>
      ),
      value: [kind, u.conditionGrade.trim(), u.serialNumber.trim()].filter(Boolean).join(' · '),
    };
  });

  return (
    <div className="stack stack--tight">
      <div className="request-form request-form--bench">
        <div className="stack stack--tight request-form-fields">
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
                ownerUsername.length > 0 && !ownerOk
                  ? t('warehouse.intake.ownerUsernameInvalid')
                  : undefined
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
              <select
                value={stowMode}
                onChange={(e) => setStowMode(e.target.value as StowMode)}
              >
                <option value="auto">{t('warehouse.intake.stow.auto')}</option>
                <option value="scan">{t('warehouse.intake.stow.scan')}</option>
                <option value="later">{t('warehouse.intake.stow.later')}</option>
              </select>
            </Field>

            {stowMode === 'later' && (
              <Field label={t('warehouse.intake.laterReason')} hint={t('warehouse.intake.laterHint')}>
                <select
                  value={laterReason}
                  onChange={(e) => setLaterReason(e.target.value as LaterReason)}
                >
                  {LATER_REASONS.map((r) => (
                    <option key={r.key} value={r.key}>
                      {t(r.labelKey)}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {stowMode === 'later' && laterReason === 'other' && (
              <Field label={t('warehouse.intake.laterOther')}>
                <input
                  value={laterOther}
                  onChange={(e) => setLaterOther(e.target.value)}
                  maxLength={200}
                  dir="auto"
                />
              </Field>
            )}

            {stowMode === 'scan' && (
              <ScanField
                label={t('warehouse.intake.stowScan')}
                hint={t('warehouse.intake.stowScanHint')}
                value={scanBin}
                onChange={setScanBin}
                placeholder="BIN-XXXXXXXX"
              />
            )}
          </div>

          {stowMode === 'auto' && !suggestion && (
            <div className="field">
              <span className="field-error">
                {stowError ?? t('warehouse.intake.stowSearching')}
              </span>
              {stowError && (
                <div className="stow-rescue">
                  <label className="field">
                    <span className="field-label">{t('warehouse.intake.stowNewZone')}</span>
                    <input
                      value={rescueZone}
                      onChange={(e) => setRescueZone(e.target.value)}
                      placeholder={t('warehouse.intake.stowNewZonePlaceholder')}
                    />
                  </label>
                  <Button
                    variant="secondary"
                    icon={<IconPlus />}
                    disabled={!rescueZone.trim() || rescuing}
                    onClick={() => void createBinHere()}
                  >
                    {t(
                      oversized
                        ? 'warehouse.intake.stowNewOversized'
                        : 'warehouse.intake.stowNewBin',
                    )}
                  </Button>
                  <span className="field-hint">
                    {t('warehouse.intake.stowNewHint', { facility: facilityCode || '—' })}
                  </span>
                </div>
              )}
            </div>
          )}

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
                      dir="auto"
                    />
                  </Field>

                  <Field label={t('warehouse.intake.condition')}>
                    <input
                      value={unit.conditionGrade}
                      onChange={(e) => patch(unit.key, { conditionGrade: e.target.value })}
                      dir="auto"
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

                {lotAllowed && (
                  <div className="row">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={isLot}
                        onChange={(e) => setIsLot(e.target.checked)}
                      />
                      {t('intake.isLot')}
                    </label>
                    {isLot && (
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
                  </div>
                )}
                {lotWillSplit && (
                  <p className="field-hint">
                    {t('intake.lotTooSmall', { min: lotMin ?? 0, count: lotSize })}
                  </p>
                )}

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
          </div>
        </div>

        <Docket
          kicker={t('bench.units')}
          amount={filled.length > 0 ? filled.length.toLocaleString() : '—'}
          lines={[
            { label: t('bench.owner'), value: ownerOk ? bdiCode(`@${normalizedOwner}`) : quiet },
            {
              label: t('warehouse.intake.parcel'),
              value: parcel ? bdiCode(parcel.code) : t('warehouse.intake.noParcel'),
            },
            {
              label: t('bench.shelf'),
              value:
                stowMode === 'later'
                  ? `${shelfName} · ${laterText || '—'}`
                  : shelfName
                    ? bdiCode(shelfName)
                    : quiet,
            },
            ...(isLot && single && lotAllowed
              ? [{ label: t('bench.lot'), value: lotSize.toLocaleString() }]
              : []),
            ...unitLines,
          ]}
          note={
            stowMode === 'auto' && suggestion
              ? t('warehouse.intake.stowTargetHint', {
                  zone: suggestion.zone,
                  count: suggestion.itemCount,
                })
              : undefined
          }
          outcome={outcome}
        />

        <div className="row request-form-actions">
          <Button
            variant="primary"
            icon={<IconPlus />}
            loading={busy}
            disabled={!ready}
            onClick={() => void submit()}
          >
            {filled.length > 1
              ? t('warehouse.intake.submitMany', { count: filled.length })
              : t('warehouse.intake.submit')}
          </Button>
        </div>
      </div>

      {parcel && (
        <div className="stack stack--tight">
          <p className="hint">
            {t('warehouse.intake.parcelProgress', { code: parcel.code, count: parcel.itemCount })}
          </p>
          {parcel.itemCount === 0 && (
            <Field
              label={t('warehouse.intake.emptyReason')}
              hint={t('warehouse.intake.emptyReasonHint')}
            >
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
              labels={labels.map((l) => ({
                value: l.barcode,
                caption: l.description || l.barcode,
              }))}
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
