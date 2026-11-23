import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { LabelSheetButton } from './LabelSheet';
import { ListSearch, NoMatch, matchesQuery } from './ListTools';

type ParcelSort = 'oldest' | 'newest' | 'status';
const STATUS_ORDER = ['unclaimed', 'received', 'opened', 'expected'];

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<ParcelSort>('oldest');

  const load = useCallback(async () => {
    try {
      setRows(await api.get<ParcelQueueRow[]>('/parcels'));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setRows((prev) => prev ?? []);
    }
  }, []);

  const shown = useMemo(() => {
    const list = (rows ?? []).filter((r) =>
      matchesQuery(q, r.code, r.trackingNumber, r.addressedTo, r.ownerUsername, r.facilityName),
    );
    const when = (r: ParcelQueueRow) => (r.receivedAt ? Date.parse(r.receivedAt) : Number.MAX_SAFE_INTEGER);
    return [...list].sort((a, b) => {
      if (sort === 'status') {
        const d = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
        if (d !== 0) return d;
      }
      return sort === 'newest' ? when(b) - when(a) : when(a) - when(b);
    });
  }, [rows, q, sort]);

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
        setMessage(null);
        setError((e as Error).message);
        throw e;
      }
    },
    [load, onChanged],
  );

  return (
    <Panel id="parcel-queue" title={t('parcelQueue.title')} subtitle={t('parcelQueue.subtitle')} flush>
        {(message || error) && (
          <div style={{ padding: 'var(--sp-4) var(--sp-6) 0' }}>
            {error ? <ErrorState message={error} /> : message ? <SuccessNote>{message}</SuccessNote> : null}
          </div>
        )}
        {loadError && (
          <div style={{ padding: 'var(--sp-4) var(--sp-6) 0' }}>
            <ErrorState
              title={t('warehouse.parcels.loadFailed')}
              message={loadError}
              onRetry={() => void load()}
              retryLabel={t('ui.retry')}
            />
          </div>
        )}
        {rows !== null && rows.length > 0 && (
          <ListSearch
            value={q}
            onChange={setQ}
            label={t('warehouse.parcels.search')}
            placeholder={t('warehouse.parcels.searchPlaceholder')}
            shown={shown.length}
            total={rows.length}
          >
            <select
              className="vault-sort"
              value={sort}
              aria-label={t('warehouse.list.sort')}
              onChange={(e) => setSort(e.target.value as ParcelSort)}
            >
              <option value="oldest">{t('warehouse.parcels.sort.oldest')}</option>
              <option value="newest">{t('warehouse.parcels.sort.newest')}</option>
              <option value="status">{t('warehouse.parcels.sort.status')}</option>
            </select>
          </ListSearch>
        )}

        {rows === null ? (
          <SkeletonTable rows={4} columns={6} />
        ) : rows.length === 0 ? (
          loadError ? null : (
            <EmptyState title={t('parcelQueue.empty')} text={t('parcelQueue.emptyText')} icon={<IconInbox />} />
          )
        ) : shown.length === 0 ? (
          <NoMatch onClear={() => setQ('')} />
        ) : (
          <div className="dt-wrap dt-wrap--stack">
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
                {shown.map((row) => (
                  <tr key={row.id} className={row.status === 'unclaimed' ? 'is-alert' : undefined}>
                    <td data-label={t('parcelQueue.col.parcel')} className="dt-primary">
                      <Code value={row.code} />
                      {row.trackingNumber && (
                        <span className="dt-sub">
                          <Code value={row.trackingNumber} />
                        </span>
                      )}
                      <span className="dt-sub">
                        <LabelSheetButton targets={{ kind: 'parcel', id: row.id, code: row.code }} />
                      </span>
                    </td>
                    <td data-label={t('parcelQueue.col.owner')}>
                      {row.ownerUsername ? (
                        <Code value={`@${row.ownerUsername}`} />
                      ) : (
                        <span className="unresolved">
                          <Code value={row.addressedTo || t('parcelQueue.noLabel')} />
                          <span className="dt-sub">{t('parcelQueue.noAccount')}</span>
                        </span>
                      )}
                    </td>
                    <td data-label={t('parcelQueue.col.where')}>
                      {row.facilityName ?? '—'}
                      {row.facilityRole === 'forwarding' && !row.forwardedAt && (
                        <span className="dt-sub">{t('parcelQueue.needsForwarding')}</span>
                      )}
                    </td>
                    <td data-label={t('parcelQueue.col.received')} className="td-tight">
                      <span className="date">
                        {row.receivedAt ? formatDate(row.receivedAt, locale) : '—'}
                      </span>
                    </td>
                    <td data-label={t('parcelQueue.col.units')} className="td-end num">
                      {row.itemCount.toLocaleString()}
                    </td>
                    <td data-label={t('parcelQueue.col.status')}>
                      <StatusBadge tone={PARCEL_TONE[row.status] ?? 'neutral'}>
                        {parcelStatusLabel(t, row.status)}
                      </StatusBadge>
                      {row.internationalOrigin && (
                        <span className="dt-sub">{t('parcelQueue.international')}</span>
                      )}
                    </td>
                    <td data-label={t('parcelQueue.col.actions')}>
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
  const [conditionPhotos, setConditionPhotos] = useState<PhotoRef[]>([]);
  const [claimUsername, setClaimUsername] = useState('');

  const needsForwarding = row.facilityRole === 'forwarding' && !row.forwardedAt;

  if (row.status === 'unclaimed') {
    if (!claiming) {
      return (
        <div className="actions">
          <Button size="sm" variant="primary" onClick={() => setClaiming(true)}>
            {t('parcelQueue.action.attribute')}
          </Button>
          {needsForwarding && (
            <Button
              size="sm"
              variant="secondary"
              icon={<IconShipping />}
              onClick={() =>
                void onAct(() => api.post(`/parcels/${row.id}/forward`), t('parcelQueue.forwarded')).catch(
                  () => undefined,
                )
              }
            >
              {t('parcelQueue.action.forward')}
            </Button>
          )}
        </div>
      );
    }
    const ok = isValidUsername(normalizeUsername(claimUsername));
    const typed = claimUsername.trim() !== '';
    return (
      <div className="fulfill-form">
        <div className="field-row">
          <Field
            label={t('warehouse.parcels.claimOwner')}
            hint={t('warehouse.parcels.claimHint', { label: row.addressedTo || t('parcelQueue.noLabel') })}
            error={typed && !ok ? t('warehouse.intake.ownerUsernameInvalid') : undefined}
          >
            <input
              value={claimUsername}
              onChange={(e) => setClaimUsername(e.target.value)}
              aria-invalid={typed && !ok}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
            />
          </Field>
        </div>
        <div className="actions">
          <Button
            size="sm"
            variant="primary"
            disabled={!ok}
            onClick={() =>
              void onAct(
                () =>
                  api.post(`/parcels/${row.id}/claim`, {
                    ownerUsername: normalizeUsername(claimUsername),
                  }),
                t('parcelQueue.claimed'),
              ).then(
                () => setClaiming(false),
                () => undefined,
              )
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
            variant="primary"
            icon={<IconShipping />}
            onClick={() =>
              void onAct(() => api.post(`/parcels/${row.id}/forward`), t('parcelQueue.forwarded')).catch(
                () => undefined,
              )
            }
          >
            {t('parcelQueue.action.forward')}
          </Button>
        </div>
      );
    }
    if (!opening) {
      return (
        <div className="actions">
          <Button size="sm" variant="primary" icon={<IconBox />} onClick={() => setOpening(true)}>
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
            variant="primary"
            disabled={!complete}
            onClick={() =>
              void onAct(
                () =>
                  api.post(`/parcels/${row.id}/open`, {
                    condition,
                    conditionNotes: conditionNotes.trim(),
                    photoKeys: photoKeys(conditionPhotos),
                  }),
                t('warehouse.parcels.openedNext', { code: row.code }),
              ).then(
                () => setOpening(false),
                () => undefined,
              )
            }
          >
            {t('parcelQueue.action.open')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpening(false)}>
            {t('ui.cancel')}
          </Button>
          {!complete && <span className="field-hint">{t('warehouse.parcels.openNeedsNotes')}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="actions">
      <Button
        size="sm"
        variant="primary"
        icon={<IconBox />}
        onClick={() => onBookContents?.(row.id)}
      >
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
