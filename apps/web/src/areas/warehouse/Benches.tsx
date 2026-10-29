import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../shared/api';
import { useI18n } from '../../shared/i18n';
import { DISPOSAL_CATEGORIES, DISPOSAL_OUTCOMES } from '../../shared/itemClasses';
import { formatTime } from '../../shared/money';
import { isValidUsername, normalizeUsername } from '../../shared/names';
import type { InboundAddress } from '../../shared/parcels';
import { boxLabel } from '../../shared/carriers';
import { Docket, type BenchOutcome } from '../../shared/ui/Docket';
import { Button, ErrorState, ScanField, StatusBadge } from '../../shared/ui/primitives';
import { IconAlert, IconPlus, IconScan, IconShipping } from '../../shared/ui/icons';

/** What a bench needs to know of a shelf to say where something is going: the console's own list of them. */
export interface BenchShelf {
  id: string;
  serialNumber: string;
  barcode: string;
  zone: string;
  oversized: boolean;
  active: boolean;
  itemCount: number;
  facilityId?: string | null;
  facilityCode: string | null;
}

/** A shelf as it was scanned or typed: its barcode, its serial or its number, whichever was read. */
export function shelfFor(shelves: readonly BenchShelf[], scanned: string): BenchShelf | undefined {
  const code = scanned.trim().toUpperCase();
  if (!code) return undefined;
  return shelves.find(
    (s) =>
      s.id.toUpperCase() === code ||
      s.barcode.toUpperCase() === code ||
      s.serialNumber.toUpperCase() === code,
  );
}

/** A code, read left to right whatever the page reads. */
export const code = (value: string) => <bdi dir="ltr">{value}</bdi>;

/** What has not been scanned or typed yet is a dash, never a value made up. */
export const quiet = <span className="drawer-tag-quiet">—</span>;

/** The result of the last press of a bench's button, with the time of day it came to. */
export function stamped(detail: string, locale: string): string {
  const time = formatTime(new Date().toISOString(), locale);
  return detail ? `${detail} · ${time}` : time;
}

/**
 * Move one item to another shelf: scan the item, scan the shelf, and the shelf is read back (its zone, its kind, what is on it
 * now) before anything is moved. A scanner ends with Enter: the first goes to the shelf, the second does it.
 */
export function RelocateBench({
  shelves,
  onLog,
  onDone,
}: {
  shelves: readonly BenchShelf[];
  onLog: (line: string) => void;
  onDone: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [item, setItem] = useState('');
  const [shelfCode, setShelfCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BenchOutcome | null>(null);
  const itemRef = useRef<HTMLInputElement>(null);
  const shelfRef = useRef<HTMLInputElement>(null);

  const shelf = useMemo(() => shelfFor(shelves, shelfCode), [shelves, shelfCode]);
  const ready = item.trim() !== '' && shelfCode.trim() !== '';

  async function relocate() {
    if (!ready || busy) return;
    const scanned = item.trim();
    const to = shelfCode.trim();
    setBusy(true);
    try {
      await api.post(`/custody/items/${encodeURIComponent(scanned)}/relocate`, { binId: to });
      onLog(t('warehouse.log.relocateDone', { item: scanned, bin: to }));
      setOutcome({
        tone: 'success',
        label: t('bench.moved'),
        detail: stamped(`${scanned} → ${shelf?.serialNumber ?? to}`, locale),
      });
      setItem('');
      setShelfCode('');
      itemRef.current?.focus();
      await onDone();
    } catch (e) {
      const message = (e as Error).message;
      onLog(t('warehouse.log.relocateError', { message }));
      setOutcome({ tone: 'error', label: t('bench.notDone'), detail: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="request-form request-form--bench">
      <div className="stack stack--tight request-form-fields">
        <ScanField
          label={t('warehouse.relocate.scanItem')}
          hint={t('warehouse.relocate.scanItemHint')}
          value={item}
          onChange={(value) => {
            setItem(value);
            setOutcome(null);
          }}
          onScan={() => shelfRef.current?.focus()}
          inputRef={itemRef}
          placeholder="SN-…"
        />
        <ScanField
          label={t('warehouse.relocate.scanShelf')}
          hint={t('warehouse.relocate.scanShelfHint')}
          value={shelfCode}
          onChange={(value) => {
            setShelfCode(value);
            setOutcome(null);
          }}
          onScan={() => void relocate()}
          inputRef={shelfRef}
          placeholder="BIN-XXXXXXXX"
        />
      </div>

      <Docket
        kicker={t('bench.kicker.move')}
        title={
          item.trim() ? (
            code(item.trim())
          ) : (
            <span className="drawer-tag-quiet">{t('bench.item')}</span>
          )
        }
        lines={[
          {
            label: t('bench.toShelf'),
            value: shelfCode.trim() ? code(shelf?.serialNumber ?? shelfCode.trim()) : quiet,
          },
          ...(shelf
            ? [
                { label: t('warehouse.bins.colZone'), value: shelf.zone },
                {
                  label: t('warehouse.bins.kind'),
                  value: t(
                    shelf.oversized
                      ? 'warehouse.bins.kind.oversized'
                      : 'warehouse.bins.kind.standard',
                  ),
                },
                { label: t('bench.onItNow'), value: shelf.itemCount.toLocaleString() },
                ...(shelf.active
                  ? []
                  : [
                      {
                        label: t('admin.col.status'),
                        value: (
                          <StatusBadge tone="warning">
                            {t('warehouse.status.outOfService')}
                          </StatusBadge>
                        ),
                      },
                    ]),
              ]
            : []),
        ]}
        outcome={outcome}
      />

      <div className="row request-form-actions">
        <Button
          variant="primary"
          icon={<IconScan />}
          loading={busy}
          disabled={!ready}
          onClick={() => void relocate()}
        >
          {t('warehouse.relocate.submit')}
        </Button>
      </div>
    </div>
  );
}

/** Put an item on hold, or take it off: one scan and either button. Enter, from a scanner, places the hold. */
export function HoldBench({
  onLog,
  onDone,
}: {
  onLog: (line: string) => void;
  onDone: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [item, setItem] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BenchOutcome | null>(null);
  const itemRef = useRef<HTMLInputElement>(null);

  async function act(hold: boolean) {
    const id = item.trim();
    if (!id || busy) return;
    setBusy(true);
    try {
      const path = `/custody/items/${encodeURIComponent(id)}/hold`;
      const res = hold
        ? await api.post<{ changed: boolean }>(path)
        : await api.del<{ changed: boolean }>(path);
      const said = t(
        res.changed
          ? hold
            ? 'warehouse.log.holdPlaced'
            : 'warehouse.log.holdReleased'
          : hold
            ? 'warehouse.log.holdAlready'
            : 'warehouse.log.holdNone',
        { item: id },
      );
      onLog(said);
      setOutcome({
        tone: res.changed ? 'success' : 'warning',
        label: res.changed ? t(hold ? 'bench.held' : 'bench.released') : t('bench.noChange'),
        detail: stamped(res.changed ? id : said, locale),
      });
      setItem('');
      itemRef.current?.focus();
      await onDone();
    } catch (e) {
      const message = (e as Error).message;
      onLog(t('warehouse.log.holdError', { message }));
      setOutcome({ tone: 'error', label: t('bench.notDone'), detail: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="request-form request-form--bench">
      <div className="stack stack--tight request-form-fields">
        <ScanField
          label={t('warehouse.hold.scanItem')}
          hint={t('warehouse.hold.scanItemHint')}
          value={item}
          onChange={(value) => {
            setItem(value);
            setOutcome(null);
          }}
          onScan={() => void act(true)}
          inputRef={itemRef}
          placeholder="SN-…"
        />
      </div>

      <Docket
        kicker={t('bench.kicker.hold')}
        title={
          item.trim() ? (
            code(item.trim())
          ) : (
            <span className="drawer-tag-quiet">{t('bench.item')}</span>
          )
        }
        outcome={outcome}
      />

      <div className="row request-form-actions">
        <Button
          variant="primary"
          icon={<IconAlert />}
          loading={busy}
          disabled={!item.trim()}
          onClick={() => void act(true)}
        >
          {t('warehouse.hold.place')}
        </Button>
        <Button variant="secondary" disabled={busy || !item.trim()} onClick={() => void act(false)}>
          {t('warehouse.hold.release')}
        </Button>
      </div>
    </div>
  );
}

/**
 * An arrival that did not go into a vault: who it was for, why it was not taken, what became of it, and what it
 * was, written as the record will be kept. The collector is told the moment it is filed, so the slip says what
 * will be filed.
 */
export function DisposalBench({ onLog }: { onLog: (line: string) => void }) {
  const { t, locale } = useI18n();
  const [ownerUsername, setOwnerUsername] = useState('');
  const [category, setCategory] = useState(DISPOSAL_CATEGORIES[0]?.key ?? 'gps_tracker');
  const [outcomeKey, setOutcomeKey] = useState(DISPOSAL_OUTCOMES[0]?.key ?? 'destroyed');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BenchOutcome | null>(null);

  const normalizedOwner = normalizeUsername(ownerUsername);
  const ownerOk = isValidUsername(normalizedOwner);
  const complete = ownerOk && description.trim() !== '' && notes.trim() !== '';
  const reason = DISPOSAL_CATEGORIES.find((c) => c.key === category);
  const became = DISPOSAL_OUTCOMES.find((o) => o.key === outcomeKey);

  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setOutcome(null);
  };

  async function record() {
    setBusy(true);
    try {
      const row = await api.post<{ code: string }>('/intake/disposals', {
        ownerUsername: normalizedOwner,
        category,
        outcome: outcomeKey,
        description: description.trim(),
        notes: notes.trim(),
      });
      onLog(t('warehouse.disposal.recorded', { code: row.code, owner: normalizedOwner }));
      setOutcome({
        tone: 'success',
        label: t('bench.recorded'),
        detail: stamped(`${row.code} · @${normalizedOwner}`, locale),
      });
      setDescription('');
      setNotes('');
    } catch (e) {
      const message = (e as Error).message;
      onLog(t('warehouse.disposal.error', { message }));
      setOutcome({ tone: 'error', label: t('bench.notDone'), detail: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="request-form request-form--bench">
      <div className="request-form-fields">
        <div className="form-grid">
          <label className="field">
            <span className="field-label">{t('warehouse.intake.ownerUsername')}</span>
            <input
              value={ownerUsername}
              onChange={(e) => edit(setOwnerUsername)(e.target.value)}
              aria-invalid={ownerUsername.length > 0 && !ownerOk}
              dir="ltr"
            />
          </label>

          <label className="field">
            <span className="field-label">{t('warehouse.disposal.category')}</span>
            <select value={category} onChange={(e) => edit(setCategory)(e.target.value)}>
              {DISPOSAL_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {t(c.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">{t('warehouse.disposal.outcome')}</span>
            <select value={outcomeKey} onChange={(e) => edit(setOutcomeKey)(e.target.value)}>
              {DISPOSAL_OUTCOMES.map((o) => (
                <option key={o.key} value={o.key}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">{t('warehouse.disposal.description')}</span>
            <input
              value={description}
              onChange={(e) => edit(setDescription)(e.target.value)}
              dir="auto"
            />
          </label>

          <label className="field">
            <span className="field-label">{t('warehouse.disposal.notes')}</span>
            <input value={notes} onChange={(e) => edit(setNotes)(e.target.value)} dir="auto" />
          </label>
        </div>
      </div>

      <Docket
        kicker={t('bench.kicker.notAccepted')}
        title={
          description.trim() ? (
            <bdi dir="auto">{description.trim()}</bdi>
          ) : (
            <span className="drawer-tag-quiet">{t('warehouse.disposal.description')}</span>
          )
        }
        lines={[
          {
            label: t('bench.owner'),
            value: ownerOk ? code(`@${normalizedOwner}`) : quiet,
          },
          { label: t('warehouse.disposal.category'), value: reason ? t(reason.labelKey) : quiet },
          { label: t('warehouse.disposal.outcome'), value: became ? t(became.labelKey) : quiet },
          {
            label: t('warehouse.notes'),
            value: notes.trim() ? <bdi dir="auto">{notes.trim()}</bdi> : quiet,
          },
        ]}
        outcome={outcome}
      />

      <div className="row request-form-actions">
        {!complete && <span className="field-hint">{t('warehouse.required')}</span>}
        <Button variant="danger" loading={busy} disabled={!complete} onClick={() => void record()}>
          {t('warehouse.disposal.submit')}
        </Button>
      </div>
    </div>
  );
}

/** A new shelf: the zone it is in, what kind it is and where it stands; its serial is minted, so it is not asked for. */
export function NewShelfBench({
  onLog,
  onCreated,
}: {
  onLog: (line: string) => void;
  onCreated: () => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [zone, setZone] = useState('');
  const [oversized, setOversized] = useState(false);
  const [facilityCode, setFacilityCode] = useState('');
  const [facilities, setFacilities] = useState<InboundAddress[]>([]);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BenchOutcome | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<InboundAddress[]>('/me/inbound-addresses');
        const storing = list.filter((f) => f.role === 'primary');
        setFacilities(storing);
        if (storing[0]) setFacilityCode(storing[0].code);
      } catch {
        // A bench with no list of buildings makes the shelf in the one it is in.
      }
    })();
  }, []);

  const facility = facilities.find((f) => f.code === facilityCode);

  async function create() {
    setBusy(true);
    try {
      const bin = await api.post<{ serialNumber: string; zone: string }>('/custody/bins', {
        zone,
        facilityCode: facilityCode || undefined,
        oversized,
      });
      onLog(t('warehouse.log.binCreated', { serial: bin.serialNumber, zone: bin.zone }));
      setOutcome({
        tone: 'success',
        label: t('bench.recorded'),
        detail: stamped(`${bin.serialNumber} · ${bin.zone}`, locale),
      });
      setZone('');
      setOversized(false);
      await onCreated();
    } catch (e) {
      const message = (e as Error).message;
      onLog(t('warehouse.log.binCreateError', { message }));
      setOutcome({ tone: 'error', label: t('bench.notDone'), detail: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="request-form request-form--bench">
      <div className="stack stack--tight request-form-fields">
        <label className="field">
          <span className="field-label">{t('warehouse.bins.zone')}</span>
          <input
            value={zone}
            onChange={(e) => {
              setZone(e.target.value);
              setOutcome(null);
            }}
            dir="auto"
          />
        </label>
        {facilities.length > 1 && (
          <label className="field">
            <span className="field-label">{t('warehouse.bins.facility')}</span>
            <select value={facilityCode} onChange={(e) => setFacilityCode(e.target.value)}>
              {facilities.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={oversized}
            onChange={(e) => setOversized(e.target.checked)}
          />
          {t('warehouse.bins.oversized')}
        </label>
      </div>

      <Docket
        kicker={t('bench.kicker.newShelf')}
        title={
          zone.trim() ? (
            <>
              {t('warehouse.bins.zone')} <bdi dir="auto">{zone.trim()}</bdi>
            </>
          ) : (
            <span className="drawer-tag-quiet">{t('warehouse.bins.zone')}</span>
          )
        }
        lines={[
          {
            label: t('warehouse.bins.kind'),
            value: t(oversized ? 'warehouse.bins.kind.oversized' : 'warehouse.bins.kind.standard'),
          },
          ...(facility ? [{ label: t('warehouse.bins.facility'), value: facility.name }] : []),
          { label: t('bench.serial'), value: t('bench.mintedOnCreate') },
        ]}
        outcome={outcome}
      />

      <div className="row request-form-actions">
        <Button
          variant="primary"
          icon={<IconPlus />}
          loading={busy}
          disabled={!zone.trim()}
          onClick={() => void create()}
        >
          {t('warehouse.bins.create')}
        </Button>
      </div>
    </div>
  );
}

interface ShipmentDetail {
  id: string;
  code: string | null;
  status: string;
  carrier: string | null;
  serviceKey: string | null;
  itemIds: string[];
  items?: {
    id: string;
    serialNumber: string | null;
    barcode: string | null;
    description: string | null;
  }[];
  directParcel?: { code: string; trackingNumber: string | null } | null;
  destinationAddress: string;
  boxSize: string | null;
}

const sameCode = (a: string | null | undefined, b: string) =>
  Boolean(a) && a!.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * Pack a shipment: load it, and the docket is its pick list. Each card that is scanned is ticked on it, a code that
 * is not in the shipment is shown on it as wrong with a way to take it back, and the figure is how many are done of
 * how many. The shipment goes only when every card has been scanned and nothing else has.
 */
export function FulfillmentBench({ onLog }: { onLog: (line: string) => void }) {
  const { t, locale } = useI18n();
  const [shipmentId, setShipmentId] = useState('');
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [scans, setScans] = useState<string[]>([]);
  const [scanInput, setScanInput] = useState('');
  const [carrier, setCarrier] = useState('DHL');
  const [weight, setWeight] = useState('500');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BenchOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const s = await api.get<ShipmentDetail>(`/shipping/shipments/${shipmentId}`);
      setDetail(s);
      setScans([]);
      setScanInput('');
      setError(null);
      setOutcome(null);
      if (s.carrier) setCarrier(s.carrier);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const direct =
    detail !== null && detail.itemIds.length === 0 && detail.serviceKey === 'direct_overnight';

  const expected = useMemo(
    () =>
      detail
        ? detail.itemIds.map(
            (id) =>
              detail.items?.find((i) => i.id === id) ?? {
                id,
                serialNumber: null,
                barcode: null,
                description: null,
              },
          )
        : [],
    [detail],
  );

  const itemFor = (scanned: string) =>
    expected.find(
      (i) =>
        sameCode(i.id, scanned) ||
        sameCode(i.barcode, scanned) ||
        sameCode(i.serialNumber, scanned),
    );
  const parcelMatches = (scanned: string) =>
    Boolean(detail?.directParcel) &&
    (sameCode(detail!.directParcel!.code, scanned) ||
      sameCode(detail!.directParcel!.trackingNumber, scanned));

  const scannedIds = new Set(
    scans.map((c) => itemFor(c)?.id).filter((id): id is string => Boolean(id)),
  );
  const strays = direct ? scans.filter((c) => !parcelMatches(c)) : scans.filter((c) => !itemFor(c));
  const allScanned = direct
    ? scans.length === 1 && strays.length === 0
    : expected.length > 0 && expected.every((i) => scannedIds.has(i.id)) && strays.length === 0;
  const complete = allScanned && carrier !== '' && weight !== '' && notes.trim() !== '';

  function addScan() {
    const scanned = scanInput.trim();
    setScanInput('');
    if (!scanned) return;
    if (direct) setScans([scanned]);
    else setScans((prev) => (prev.some((c) => sameCode(c, scanned)) ? prev : [...prev, scanned]));
  }

  async function completeShipment() {
    // A second press (or a second Enter from a scanner) while the first is on its way would send it twice, and the
    // refusal of the second would replace the docket's word that the first went.
    if (!detail || !complete || busy) return;
    setBusy(true);
    try {
      const res = await api.post<{ trackingNumber: string }>(
        `/shipping/shipments/${detail.id}/dispatch`,
        {
          ...(direct ? { scannedParcel: scans[0] } : { scannedItemIds: scans }),
          carrier,
          packageWeightGrams: Number(weight),
          fulfillmentNotes: notes,
        },
      );
      const name = detail.code ?? detail.id;
      onLog(t('warehouse.log.dispatchDone', { id: name, tracking: res.trackingNumber }));
      setOutcome({
        tone: 'success',
        label: t('bench.dispatched'),
        detail: stamped(`${name} · ${res.trackingNumber}`, locale),
      });
      setDetail(null);
      setShipmentId('');
      setNotes('');
      setScans([]);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      onLog(t('warehouse.log.dispatchError', { message }));
      setOutcome({ tone: 'error', label: t('bench.notDone'), detail: message });
    } finally {
      setBusy(false);
    }
  }

  // The pick list: a line for each thing to be scanned, and for anything scanned that should not have been.
  const pickLines: { label: ReactNode; value: ReactNode }[] = [];
  if (detail) {
    if (direct) {
      pickLines.push({
        label: code(detail.directParcel?.code ?? '—'),
        value:
          scans.length === 1 && strays.length === 0 ? (
            <StatusBadge tone="success">{t('warehouse.dispatch.scanned')}</StatusBadge>
          ) : (
            <StatusBadge>{t('warehouse.dispatch.notScanned')}</StatusBadge>
          ),
      });
    } else {
      for (const i of expected) {
        pickLines.push({
          label: (
            <>
              {code(i.serialNumber ?? i.id)}
              {i.description && <span className="docket-sub"> {i.description}</span>}
            </>
          ),
          value: (
            <StatusBadge tone={scannedIds.has(i.id) ? 'success' : 'neutral'}>
              {t(
                scannedIds.has(i.id)
                  ? 'warehouse.dispatch.scanned'
                  : 'warehouse.dispatch.notScanned',
              )}
            </StatusBadge>
          ),
        });
      }
    }
    for (const stray of strays) {
      pickLines.push({
        label: code(stray),
        value: (
          <>
            <StatusBadge tone="error">
              {t(direct ? 'warehouse.dispatch.wrongParcel' : 'warehouse.dispatch.notInShipment')}
            </StatusBadge>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setScans((prev) => prev.filter((c) => c !== stray))}
            >
              {t('warehouse.dispatch.removeScan', { code: stray })}
            </Button>
          </>
        ),
      });
    }
  }

  return (
    <div className="request-form request-form--bench">
      <div className="stack stack--tight request-form-fields">
        <ScanField
          label={t('warehouse.dispatch.shipmentId')}
          value={shipmentId}
          onChange={setShipmentId}
          onScan={() => shipmentId && void load()}
        />
        <div className="row">
          <Button
            variant={detail ? 'secondary' : 'primary'}
            icon={<IconShipping />}
            disabled={!shipmentId}
            onClick={() => void load()}
          >
            {t('warehouse.fulfill')}
          </Button>
        </div>

        {error && <ErrorState message={error} />}

        {detail && (
          <>
            {!direct && (
              <p className="field-hint">
                {detail.boxSize
                  ? t('warehouse.dispatch.packIn', { box: boxLabel(t, { key: detail.boxSize }) })
                  : t('warehouse.dispatch.anyBox')}
              </p>
            )}

            <ScanField
              label={t(direct ? 'warehouse.dispatch.scanParcel' : 'warehouse.dispatch.scan')}
              hint={
                direct
                  ? t('warehouse.dispatch.scanParcelHint', {
                      code: detail.directParcel?.code ?? '—',
                    })
                  : t('warehouse.dispatch.scanHint')
              }
              value={scanInput}
              onChange={setScanInput}
              onScan={addScan}
              placeholder={direct ? 'PKG-…' : 'SN-…'}
            />
            <Button variant="secondary" disabled={!scanInput.trim()} onClick={addScan}>
              {t('warehouse.dispatch.addScan')}
            </Button>

            <div className="form-grid">
              <label className="field">
                <span className="field-label">{t('warehouse.carrier')}</span>
                <input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
              </label>
              <label className="field">
                <span className="field-label">{t('warehouse.packageWeight')}</span>
                <input
                  type="number"
                  min={1}
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  dir="ltr"
                />
              </label>
              <label className="field">
                <span className="field-label">{t('warehouse.notes')}</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto" />
              </label>
            </div>

            {!complete && <p className="field-hint">{t('warehouse.required')}</p>}
          </>
        )}
      </div>

      <Docket
        kicker={t('bench.kicker.pickList')}
        title={
          detail ? (
            code(detail.code ?? detail.id)
          ) : (
            <span className="drawer-tag-quiet">{t('bench.noShipment')}</span>
          )
        }
        amount={detail && !direct ? `${scannedIds.size} / ${expected.length}` : undefined}
        lines={
          detail
            ? [
                {
                  label: t('grp.slip.goesTo'),
                  value: <bdi dir="auto">{detail.destinationAddress}</bdi>,
                },
                ...pickLines,
              ]
            : []
        }
        outcome={outcome}
      />

      <div className="row request-form-actions">
        {detail && (
          <Button
            variant="primary"
            loading={busy}
            disabled={!complete}
            onClick={() => void completeShipment()}
          >
            {t('warehouse.complete')}
          </Button>
        )}
      </div>
    </div>
  );
}
