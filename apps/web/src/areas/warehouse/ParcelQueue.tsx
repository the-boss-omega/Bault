import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n, type TranslateFn } from '../../shared/i18n';
import { formatDate } from '../../shared/money';
import { isValidUsername, normalizeUsername } from '../../shared/names';
import {
  PARCEL_CONDITIONS,
  PARCEL_TONE,
  parcelStatusLabel,
  type ParcelQueueRow,
} from '../../shared/parcels';
import type { InboundAddress } from '../../shared/parcels';
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
} from '../../shared/ui/primitives';
import { IconBox, IconInbox, IconPlus, IconShipping } from '../../shared/ui/icons';

/**
 * The warehouse's inbound bench.
 *
 * A parcel moves left to right: received → opened → processed, with two side
 * exits (unclaimed, disposed) and one detour (forwarded, when it landed at a
 * site that stores nothing). Every control here is one of those moves, and the
 * row only ever offers the moves that are legal for its current status — the API
 * enforces the same table, so a button that would 409 is never drawn.
 */
export function ParcelQueue({ onChanged }: { onChanged?: () => Promise<void> | void }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<ParcelQueueRow[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.get<ParcelQueueRow[]>('/parcels'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>, ok: string) => {
      try {
        await fn();
        setMessage(ok);
        setError(null);
        await load();
        await onChanged?.();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [load, onChanged],
  );

  return (
    <>
      <ReceiveParcelPanel onReceived={act} />

      <Panel title={t('parcelQueue.title')} subtitle={t('parcelQueue.subtitle')} flush>
        {(message || error) && (
          <div style={{ padding: 'var(--sp-4) var(--sp-6) 0' }}>
            {error ? <ErrorState message={error} /> : message ? <SuccessNote>{message}</SuccessNote> : null}
          </div>
        )}

        {rows === null ? (
          <SkeletonTable rows={4} columns={6} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('parcelQueue.empty')} text={t('parcelQueue.emptyText')} icon={<IconInbox />} />
        ) : (
          <div className="dt-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('parcelQueue.col.parcel')}</th>
                  <th scope="col">{t('parcelQueue.col.owner')}</th>
                  <th scope="col">{t('parcelQueue.col.where')}</th>
                  <th scope="col">{t('parcelQueue.col.received')}</th>
                  <th scope="col">{t('parcelQueue.col.status')}</th>
                  <th scope="col">{t('parcelQueue.col.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td dir="ltr">
                      <code>{row.code}</code>
                      {row.trackingNumber && <span className="dt-sub">{row.trackingNumber}</span>}
                    </td>
                    <td>
                      {row.ownerUsername ? (
                        <code dir="ltr">{row.ownerUsername}</code>
                      ) : (
                        /* The label as written, even — especially — when it
                           resolves to nothing. It is the only clue to whose
                           property this is. */
                        <span className="muted" dir="ltr">
                          {row.addressedTo || t('parcelQueue.noLabel')}
                        </span>
                      )}
                    </td>
                    <td>
                      {row.facilityName ?? '—'}
                      {row.facilityRole === 'forwarding' && !row.forwardedAt && (
                        <span className="dt-sub">{t('parcelQueue.needsForwarding')}</span>
                      )}
                    </td>
                    <td dir="ltr">{row.receivedAt ? formatDate(row.receivedAt, locale) : '—'}</td>
                    <td>
                      <StatusBadge tone={PARCEL_TONE[row.status] ?? 'neutral'}>
                        {parcelStatusLabel(t, row.status)}
                      </StatusBadge>
                      {row.internationalOrigin && (
                        <span className="dt-sub">{t('parcelQueue.international')}</span>
                      )}
                    </td>
                    <td>
                      <ParcelActions row={row} onAct={act} t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

/* ============================================================
   Receiving
   ============================================================ */

/**
 * Book a physical arrival in.
 *
 * The label is typed as written. It is normalised and looked up, and if it
 * resolves to nothing the parcel is still recorded — as `unclaimed`, with the
 * raw string kept. Refusing to record an arrival because its label is wrong
 * would mean the platform's answer to "somebody's property is on our shelf and
 * we don't know whose" is to have no record of it at all.
 */
function ReceiveParcelPanel({
  onReceived,
}: {
  onReceived: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [facilities, setFacilities] = useState<InboundAddress[]>([]);
  const [facilityCode, setFacilityCode] = useState('');
  const [addressedTo, setAddressedTo] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [internationalOrigin, setInternationalOrigin] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.get<InboundAddress[]>('/me/inbound-addresses');
        setFacilities(list);
        const preferred = list.find((f) => f.role === 'primary') ?? list[0];
        if (preferred) setFacilityCode(preferred.code);
      } catch {
        /* the panel still works if the list fails; the field is a free choice */
      }
    })();
  }, []);

  const normalized = normalizeUsername(addressedTo);
  const labelLooksValid = addressedTo.trim() === '' || isValidUsername(normalized);

  async function receive() {
    await onReceived(
      () =>
        api.post('/parcels/receive', {
          facilityCode,
          addressedTo: addressedTo.trim() || undefined,
          carrier: carrier.trim() || undefined,
          trackingNumber: trackingNumber.trim() || undefined,
          internationalOrigin,
          notes: notes.trim() || undefined,
        }),
      t('parcelQueue.received'),
    );
    setAddressedTo('');
    setTrackingNumber('');
    setNotes('');
    setInternationalOrigin(false);
  }

  return (
    <Panel title={t('parcelQueue.receive.title')} subtitle={t('parcelQueue.receive.subtitle')}>
      <div className="stack stack--tight">
        <div className="form-grid">
          <label className="field">
            <span className="field-label">{t('parcelQueue.receive.facility')}</span>
            <select value={facilityCode} onChange={(e) => setFacilityCode(e.target.value)}>
              {facilities.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('parcelQueue.receive.label')}</span>
            <input
              value={addressedTo}
              onChange={(e) => setAddressedTo(e.target.value)}
              aria-invalid={!labelLooksValid}
              dir="ltr"
            />
            <span className="field-hint">{t('parcelQueue.receive.labelHint')}</span>
          </label>
          <label className="field">
            <span className="field-label">{t('inbound.register.carrier')}</span>
            <input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{t('inbound.register.tracking')}</span>
            <input value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} dir="ltr" />
          </label>
          <label className="field">
            <span className="field-label">{t('warehouse.notes')}</span>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

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
          <Button variant="gold" icon={<IconPlus />} disabled={!facilityCode} onClick={() => void receive()}>
            {t('parcelQueue.receive.submit')}
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/* ============================================================
   Per-row actions
   ============================================================ */

function ParcelActions({
  row,
  onAct,
  t,
}: {
  row: ParcelQueueRow;
  onAct: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  t: TranslateFn;
}) {
  const [opening, setOpening] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [condition, setCondition] = useState(PARCEL_CONDITIONS[0]?.key ?? 'sound');
  const [conditionNotes, setConditionNotes] = useState('');
  const [claimUsername, setClaimUsername] = useState('');

  // A forwarding site holds nothing, so anything sitting there needs the second
  // leg before it can be opened at all.
  const needsForwarding = row.facilityRole === 'forwarding' && !row.forwardedAt;

  if (row.status === 'unclaimed') {
    if (!claiming) {
      return (
        <div className="actions">
          <Button size="sm" variant="gold" onClick={() => setClaiming(true)}>
            {t('parcelQueue.action.attribute')}
          </Button>
          {needsForwarding && (
            <Button
              size="sm"
              variant="secondary"
              icon={<IconShipping />}
              onClick={() => void onAct(() => api.post(`/parcels/${row.id}/forward`), t('parcelQueue.forwarded'))}
            >
              {t('parcelQueue.action.forward')}
            </Button>
          )}
        </div>
      );
    }
    const ok = isValidUsername(normalizeUsername(claimUsername));
    return (
      <div className="fulfill-form">
        <div className="field-row">
          <label className="field">
            <span className="field-label">{t('parcelQueue.receive.label')}</span>
            <input
              value={claimUsername}
              onChange={(e) => setClaimUsername(e.target.value)}
              dir="ltr"
              style={{ width: '10rem' }}
            />
          </label>
        </div>
        <div className="actions">
          <Button
            size="sm"
            variant="gold"
            disabled={!ok}
            onClick={() =>
              void onAct(
                () =>
                  api.post(`/parcels/${row.id}/claim`, {
                    ownerUsername: normalizeUsername(claimUsername),
                  }),
                t('parcelQueue.claimed'),
              ).then(() => setClaiming(false))
            }
          >
            {t('parcelQueue.action.attribute')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setClaiming(false)}>
            {t('ui.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  if (row.status === 'expected') {
    return <span className="hint">{t('parcelQueue.awaitingArrival')}</span>;
  }

  if (row.status === 'received') {
    if (needsForwarding) {
      return (
        <div className="actions">
          <Button
            size="sm"
            variant="gold"
            icon={<IconShipping />}
            onClick={() => void onAct(() => api.post(`/parcels/${row.id}/forward`), t('parcelQueue.forwarded'))}
          >
            {t('parcelQueue.action.forward')}
          </Button>
        </div>
      );
    }
    if (!opening) {
      return (
        <div className="actions">
          <Button size="sm" variant="gold" icon={<IconBox />} onClick={() => setOpening(true)}>
            {t('parcelQueue.action.open')}
          </Button>
        </div>
      );
    }
    const complete = conditionNotes.trim() !== '';
    return (
      <div className="fulfill-form">
        <span className="hint">{t('parcelQueue.open.legend')}</span>
        <div className="field-row">
          <label className="field">
            <span className="field-label">{t('parcelQueue.open.condition')}</span>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              {PARCEL_CONDITIONS.map((c) => (
                <option key={c.key} value={c.key}>
                  {t(c.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('parcelQueue.open.notes')}</span>
            <input
              value={conditionNotes}
              onChange={(e) => setConditionNotes(e.target.value)}
              style={{ width: '14rem' }}
            />
          </label>
        </div>
        <div className="actions">
          <Button
            size="sm"
            variant="gold"
            disabled={!complete}
            onClick={() =>
              void onAct(
                () =>
                  api.post(`/parcels/${row.id}/open`, {
                    condition,
                    conditionNotes: conditionNotes.trim(),
                  }),
                t('parcelQueue.opened'),
              ).then(() => setOpening(false))
            }
          >
            {t('parcelQueue.action.open')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpening(false)}>
            {t('ui.cancel')}
          </Button>
          {!complete && <span className="field-hint">{t('warehouse.required')}</span>}
        </div>
      </div>
    );
  }

  // status === 'opened' — book the contents in on the Intake tab, then close it out.
  return (
    <div className="actions">
      <Button
        size="sm"
        variant="gold"
        onClick={() => void onAct(() => api.post(`/parcels/${row.id}/process`), t('parcelQueue.processed'))}
      >
        {t('parcelQueue.action.process')}
      </Button>
      <span className="field-hint">{t('parcelQueue.processHint', { code: row.code })}</span>
    </div>
  );
}
