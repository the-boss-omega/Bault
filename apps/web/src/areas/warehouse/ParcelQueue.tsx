import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n, type TranslateFn } from '../../shared/i18n';
import { formatDate } from '../../shared/money';
import { Code } from '../../shared/ui/Serial';
import { isValidUsername, normalizeUsername } from '../../shared/names';
import {
  PARCEL_CONDITIONS,
  PARCEL_TONE,
  parcelStatusLabel,
  type ParcelQueueRow,
} from '../../shared/parcels';
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
import { IconBox, IconInbox, IconShipping } from '../../shared/ui/icons';
import { PhotoInput, photoKeys, type PhotoRef } from '../../shared/ui/PhotoInput';

/**
 * The warehouse's inbound bench.
 *
 * A parcel moves left to right: received → opened → its contents booked in →
 * processed, with two side exits (unclaimed, disposed) and one detour
 * (forwarded, when it landed at a site that stores nothing). Every control here
 * is one of those moves, and the row only ever offers the moves that are legal
 * for its current status — the API enforces the same table, so a button that
 * would 409 is never drawn.
 *
 * An opened parcel now offers Book contents rather than Process. That is the
 * step that was missing from the bench: the work of unpacking a box happens on
 * the intake form, and an operator who reached this row was told, in a hint,
 * to go and find it. Pressing it opens the intake form already pointed at this
 * box, and the box is closed out from there — at the end of the work, next to
 * the count of what came out of it.
 */
export function ParcelQueue({
  onChanged,
  onBookContents,
}: {
  onChanged?: () => Promise<void> | void;
  onBookContents?: (parcelId: string) => void;
}) {
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
                  <th scope="col" className="td-end">
                    {t('parcelQueue.col.units')}
                  </th>
                  <th scope="col">{t('parcelQueue.col.status')}</th>
                  <th scope="col">{t('parcelQueue.col.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  /*
                    An UNCLAIMED parcel is somebody's unopened property that
                    nobody can attribute, held rather than opened. It is the one
                    row on this bench that needs a person, and it used to be an
                    ordinary row distinguished by a small red dot in a pill.

                    It takes the register's state rail — the same 3px leading
                    rule a frozen item takes in the vault — so a bench with one
                    of these on it says so from across the room.
                  */
                  <tr key={row.id} className={row.status === 'unclaimed' ? 'is-alert' : undefined}>
                    <td>
                      <Code value={row.code} />
                      {row.trackingNumber && (
                        <span className="dt-sub">
                          <Code value={row.trackingNumber} />
                        </span>
                      )}
                    </td>
                    <td>
                      {row.ownerUsername ? (
                        <Code value={`@${row.ownerUsername}`} />
                      ) : (
                        /* The label as written, even — especially — when it
                           resolves to nothing. It is the only clue to whose
                           property this is, so it is quoted rather than
                           corrected, and marked as unresolved rather than muted
                           into looking like an empty cell. */
                        <span className="unresolved">
                          <Code value={row.addressedTo || t('parcelQueue.noLabel')} />
                          <span className="dt-sub">{t('parcelQueue.noAccount')}</span>
                        </span>
                      )}
                    </td>
                    <td>
                      {row.facilityName ?? '—'}
                      {row.facilityRole === 'forwarding' && !row.forwardedAt && (
                        <span className="dt-sub">{t('parcelQueue.needsForwarding')}</span>
                      )}
                    </td>
                    <td className="td-tight">
                      <span className="ltr-run">
                        {row.receivedAt ? formatDate(row.receivedAt, locale) : '—'}
                      </span>
                    </td>
                    {/* What has actually come out of the box so far. Before this
                        the only way to find out was to leave the page. */}
                    <td className="td-end num">{row.itemCount.toLocaleString()}</td>
                    <td>
                      <StatusBadge tone={PARCEL_TONE[row.status] ?? 'neutral'}>
                        {parcelStatusLabel(t, row.status)}
                      </StatusBadge>
                      {row.internationalOrigin && (
                        <span className="dt-sub">{t('parcelQueue.international')}</span>
                      )}
                    </td>
                    <td>
                      <ParcelActions row={row} onAct={act} onBookContents={onBookContents} t={t} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Panel>
  );
}

/* ============================================================
   Per-row actions
   ============================================================ */

function ParcelActions({
  row,
  onAct,
  onBookContents,
  t,
}: {
  row: ParcelQueueRow;
  onAct: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  onBookContents?: (parcelId: string) => void;
  t: TranslateFn;
}) {
  const [opening, setOpening] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [condition, setCondition] = useState(PARCEL_CONDITIONS[0]?.key ?? 'sound');
  const [conditionNotes, setConditionNotes] = useState('');
  /**
   * What the arrival check actually saw.
   *
   * A box recorded as `contents_damaged` used to be a sentence with nothing
   * attached — the operator's word against the customer's, weeks later. The
   * pictures go on the parcel, and its owner can see them.
   */
  const [conditionPhotos, setConditionPhotos] = useState<PhotoRef[]>([]);
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
          <Field label={t('parcelQueue.receive.label')}>
            <input value={claimUsername} onChange={(e) => setClaimUsername(e.target.value)} dir="ltr" />
          </Field>
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
          <Field label={t('parcelQueue.open.condition')}>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              {PARCEL_CONDITIONS.map((c) => (
                <option key={c.key} value={c.key}>
                  {t(c.labelKey)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('parcelQueue.open.notes')} className="field--grow">
            <input value={conditionNotes} onChange={(e) => setConditionNotes(e.target.value)} />
          </Field>
        </div>

        <PhotoInput
          purpose="parcel"
          value={conditionPhotos}
          onChange={setConditionPhotos}
          label={t('parcelQueue.open.photos')}
          hint={t('parcelQueue.open.photosHint')}
        />
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
                    photoKeys: photoKeys(conditionPhotos),
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

  /**
   * status === 'opened' — the box is on the bench with its lid off.
   *
   * The only move offered is the next piece of physical work: take the contents
   * out and book them in. Closing the box out lives at the end of that, on the
   * intake bench, where the operator can see how many units came out of it —
   * and the API refuses to close one that produced nothing unless somebody
   * states, in writing, that it really arrived empty.
   */
  return (
    <div className="actions">
      <Button size="sm" variant="gold" icon={<IconBox />} onClick={() => onBookContents?.(row.id)}>
        {t('parcelQueue.action.bookContents')}
      </Button>
      <span className="field-hint">
        {row.itemCount > 0
          ? t('parcelQueue.bookedSoFar', { count: row.itemCount })
          : t('parcelQueue.nothingBooked')}
      </span>
    </div>
  );
}
