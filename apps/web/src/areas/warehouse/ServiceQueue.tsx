import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../shared/api';
import { useT } from '../../shared/i18n';
import type { MessageKey, TranslateFn } from '../../shared/i18n';
import { serviceStatusLabel, serviceTypeLabel } from '../../shared/serviceLabels';
import { areaLabel, severityLabel, INSPECTION_SEVERITIES } from '../../shared/grading';
import { dollarsToCents, formatUsd } from '../../shared/money';
import { ListSearch, NoMatch, matchesQuery } from './ListTools';
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
  type StatusTone,
} from '../../shared/ui/primitives';
import { IconAsk, IconCheck, IconClose, IconServices } from '../../shared/ui/icons';

const STATUS_TONE: Record<string, StatusTone> = {
  requested: 'warning',
  in_progress: 'info',
  completed: 'success',
  cancelled: 'error',
};

interface QueueItem {
  id: string;
  code: string | null;
  type: string;
  status: string;
  itemId: string | null;
  requesterEmail: string | null;
  requesterUsername?: string | null;
  itemDescription: string | null;
  typeFields: Record<string, unknown> | null;
}

export function ServiceQueue({ onChanged }: { onChanged?: () => Promise<void> | void }) {
  const t = useT();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');

  const load = useCallback(async () => {
    try {
      setQueue(await api.get<QueueItem[]>('/services/queue'));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
      setQueue((prev) => prev ?? []);
    }
  }, []);

  const shown = useMemo(
    () =>
      (queue ?? []).filter(
        (r) =>
          (status === 'all' || r.status === status) &&
          matchesQuery(q, r.code, r.requesterUsername, r.requesterEmail, r.itemDescription, serviceTypeLabel(t, r.type)),
      ),
    [queue, q, status, t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setMessage(ok);
      setError(null);
      await load();
      await onChanged?.();
    } catch (e) {
      setMessage(null);
      setError((e as Error).message);
    }
  }

  return (
    <Panel title={t('queue.title')} subtitle={t('queue.subtitle')} flush>
      {(message || error) && (
        <div style={{ padding: 'var(--sp-4) var(--sp-6) 0' }}>
          {error ? <ErrorState message={error} /> : message ? <SuccessNote>{message}</SuccessNote> : null}
        </div>
      )}
      {loadError && (
        <div style={{ padding: 'var(--sp-4) var(--sp-6) 0' }}>
          <ErrorState
            title={t('queue.loadFailed')}
            message={loadError}
            onRetry={() => void load()}
            retryLabel={t('ui.retry')}
          />
        </div>
      )}
      {queue !== null && queue.length > 0 && (
        <ListSearch
          value={q}
          onChange={setQ}
          label={t('queue.search')}
          placeholder={t('queue.searchPlaceholder')}
          shown={shown.length}
          total={queue.length}
        >
          <select
            className="vault-sort"
            value={status}
            aria-label={t('queue.filter')}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">{t('queue.filter.all')}</option>
            <option value="requested">{serviceStatusLabel(t, 'requested')}</option>
            <option value="in_progress">{serviceStatusLabel(t, 'in_progress')}</option>
          </select>
        </ListSearch>
      )}

      {queue === null ? (
        <SkeletonTable rows={4} columns={5} />
      ) : queue.length === 0 ? (
        loadError ? null : <EmptyState title={t('queue.empty')} text={t('queue.emptyText')} icon={<IconServices />} />
      ) : shown.length === 0 ? (
        <NoMatch
          onClear={() => {
            setQ('');
            setStatus('all');
          }}
        />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('queue.col.request')}</th>
                <th scope="col">{t('queue.col.service')}</th>
                <th scope="col">{t('queue.col.customer')}</th>
                <th scope="col">{t('queue.col.item')}</th>
                <th scope="col">{t('queue.col.status')}</th>
                <th scope="col">{t('queue.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((q) => (
                <tr key={q.id}>
                  <td data-label={t('queue.col.request')}>
                    <code dir="ltr">{q.code ?? q.id.slice(0, 8)}</code>
                  </td>
                  <td data-label={t('queue.col.service')} className="dt-primary">
                    {serviceTypeLabel(t, q.type)}
                  </td>
                  <td data-label={t('queue.col.customer')}>
                    {q.requesterUsername ? (
                      <>
                        <bdi dir="ltr">@{q.requesterUsername}</bdi>
                        {q.requesterEmail && (
                          <span className="dt-sub">
                            <bdi dir="ltr">{q.requesterEmail}</bdi>
                          </span>
                        )}
                      </>
                    ) : q.requesterEmail ? (
                      <bdi dir="ltr">{q.requesterEmail}</bdi>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td data-label={t('queue.col.item')}>
                    <bdi dir="auto">{q.itemDescription ?? '—'}</bdi>
                  </td>
                  <td data-label={t('queue.col.status')}>
                    <StatusBadge tone={STATUS_TONE[q.status] ?? 'neutral'}>
                      {serviceStatusLabel(t, q.status)}
                    </StatusBadge>
                  </td>
                  <td data-label={t('queue.col.actions')}>
                    <QueueActions q={q} onAct={act} />
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

function QueueActions({
  q,
  onAct,
}: {
  q: QueueItem;
  onAct: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState<'decline' | 'cancel' | null>(null);
  const label = q.code ?? q.id.slice(0, 8);

  if (confirming) {
    const decline = confirming === 'decline';
    return (
      <div className="fulfill-form" role="group" aria-label={t(decline ? 'queue.action.decline' : 'queue.action.cancelRefund')}>
        <span className="hint">{t(decline ? 'queue.confirm.decline' : 'queue.confirm.cancel', { code: label })}</span>
        <div className="actions">
          <Button
            size="sm"
            variant="danger"
            icon={<IconClose />}
            onClick={() =>
              onAct(
                () => api.post(`/services/requests/${q.id}/deny`),
                t(decline ? 'queue.msg.declined' : 'queue.msg.cancelled'),
              )
            }
          >
            {t(decline ? 'queue.confirm.declineYes' : 'queue.confirm.cancelYes')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
            {t('queue.confirm.keep')}
          </Button>
        </div>
      </div>
    );
  }

  if (q.status === 'requested') {
    return (
      <div className="actions">
        <Button
          size="sm"
          variant="primary"
          icon={<IconCheck />}
          onClick={() => onAct(() => api.post(`/services/requests/${q.id}/accept`), t('queue.msg.approved'))}
        >
          {t('queue.action.approve')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={<IconClose />}
          onClick={() => setConfirming('decline')}
        >
          {t('queue.action.decline')}
        </Button>
      </div>
    );
  }

  return (
    <>
      {q.type === 'condition_inspection' ? (
        <InspectionFulfillment q={q} onAct={onAct} t={t} />
      ) : (
        <FulfillmentForm q={q} onAct={onAct} t={t} />
      )}
      <div className="actions">
        <Button
          size="sm"
          variant="danger"
          icon={<IconClose />}
          onClick={() => setConfirming('cancel')}
        >
          {t('queue.action.cancelRefund')}
        </Button>
      </div>
    </>
  );
}

function InspectionFulfillment({
  q,
  onAct,
  t,
}: {
  q: QueueItem;
  onAct: (fn: () => Promise<unknown>, ok: string) => void;
  t: TranslateFn;
}) {
  const asked = ((q.typeFields?.areas as string[] | undefined) ?? []).filter(Boolean);
  const [findings, setFindings] = useState<Record<string, { severity: string; note: string }>>(() =>
    Object.fromEntries(asked.map((a) => [a, { severity: 'clean', note: '' }])),
  );
  const [verified, setVerified] = useState(false);
  const [notes, setNotes] = useState('');

  if (asked.length === 0) return <span className="hint">{t('queue.fulfill.noAreas')}</span>;

  const complete =
    verified &&
    notes.trim() !== '' &&
    asked.every((a) => (findings[a]?.note ?? '').trim() !== '');

  function payload() {
    return {
      findings: asked.map((area) => ({
        area,
        severity: findings[area]?.severity ?? 'clean',
        note: findings[area]?.note ?? '',
      })),
      itemVerified: verified,
      notes,
    };
  }

  return (
    <div className="fulfill-form">
      <span className="hint">{t('queue.fulfill.inspectionLegend')}</span>
      {asked.map((area) => (
        <div key={area} className="field-row">
          <span className="field-label" style={{ minWidth: '6rem' }}>
            {areaLabel(t, area)}
          </span>
          <label className="field">
            <span className="field-label">{t('queue.fulfill.severity')}</span>
            <select
              value={findings[area]?.severity ?? 'clean'}
              onChange={(e) =>
                setFindings((p) => ({
                  ...p,
                  [area]: { severity: e.target.value, note: p[area]?.note ?? '' },
                }))
              }
            >
              {INSPECTION_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {severityLabel(t, s)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">{t('queue.fulfill.finding')}</span>
            <input
              value={findings[area]?.note ?? ''}
              style={{ width: '16rem' }}
              onChange={(e) =>
                setFindings((p) => ({
                  ...p,
                  [area]: { severity: p[area]?.severity ?? 'clean', note: e.target.value },
                }))
              }
            />
          </label>
        </div>
      ))}

      <div className="field-row">
        <label className="check">
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
          {t('queue.fulfill.itemVerified')}
        </label>
        <label className="field">
          <span className="field-label">{t('queue.fulfill.notes')}</span>
          <input value={notes} style={{ width: '14rem' }} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      <div className="actions">
        <Button
          size="sm"
          variant="primary"
          disabled={!complete}
          onClick={() =>
            onAct(() => api.post(`/services/inspection/${q.id}/complete`, payload()), t('queue.msg.inspectionDone'))
          }
        >
          {t('queue.fulfill.submit')}
        </Button>
        {!complete && (
          <span className="field-hint">
            {t('queue.fulfill.required')}
          </span>
        )}
      </div>
    </div>
  );
}

interface FieldSpec {
  name: string;
  label: MessageKey;
  kind: 'text' | 'number' | 'money' | 'checkbox';
  initial: string | number | boolean;
  width?: string;
}

const FORMS: Record<string, { endpoint: (id: string) => string; ok: MessageKey; fields: FieldSpec[] }> = {
  professional_photography: {
    endpoint: (id) => `/services/photography/${id}/complete`,
    ok: 'queue.msg.photographyDone',
    fields: [
      { name: 'objectKey', label: 'queue.fulfill.objectKey', kind: 'text', initial: '', width: '14rem' },
      { name: 'shotCount', label: 'queue.fulfill.shotCount', kind: 'number', initial: 6, width: '5rem' },
      { name: 'lighting', label: 'queue.fulfill.lighting', kind: 'text', initial: '', width: '10rem' },
      { name: 'itemVerified', label: 'queue.fulfill.itemVerified', kind: 'checkbox', initial: false },
      { name: 'notes', label: 'queue.fulfill.notes', kind: 'text', initial: '', width: '12rem' },
    ],
  },
  third_party_grading: {
    endpoint: (id) => `/services/grading/${id}/complete`,
    ok: 'queue.msg.gradingDone',
    fields: [
      { name: 'grade', label: 'queue.fulfill.grade', kind: 'text', initial: '', width: '7rem' },
      { name: 'gradingBody', label: 'queue.fulfill.gradingBody', kind: 'text', initial: 'PSA', width: '7rem' },
      {
        name: 'certificateNumber',
        label: 'queue.fulfill.certificateNumber',
        kind: 'text',
        initial: '',
        width: '10rem',
      },
      { name: 'itemVerified', label: 'queue.fulfill.itemVerified', kind: 'checkbox', initial: false },
      { name: 'notes', label: 'queue.fulfill.notes', kind: 'text', initial: '', width: '12rem' },
    ],
  },
  buyout: {
    endpoint: (id) => `/services/buyout/${id}/quote`,
    ok: 'queue.msg.buyoutQuoted',
    fields: [
      { name: 'offerMinor', label: 'queue.fulfill.offerMinor', kind: 'money', initial: '', width: '8rem' },
      { name: 'rationale', label: 'queue.fulfill.rationale', kind: 'text', initial: '', width: '16rem' },
      { name: 'itemVerified', label: 'queue.fulfill.itemVerified', kind: 'checkbox', initial: false },
    ],
  },
  custom: {
    endpoint: (id) => `/services/custom/${id}/quote`,
    ok: 'queue.msg.customQuoted',
    fields: [
      { name: 'priceMinor', label: 'queue.fulfill.customPrice', kind: 'money', initial: '', width: '8rem' },
      { name: 'scope', label: 'queue.fulfill.customScope', kind: 'text', initial: '', width: '20rem' },
    ],
  },
  video_review: {
    endpoint: (id) => `/services/video/${id}/complete`,
    ok: 'queue.msg.videoDone',
    fields: [
      { name: 'objectKey', label: 'queue.fulfill.objectKey', kind: 'text', initial: '', width: '14rem' },
      {
        name: 'durationSeconds',
        label: 'queue.fulfill.duration',
        kind: 'number',
        initial: 30,
        width: '5rem',
      },
      { name: 'itemVerified', label: 'queue.fulfill.itemVerified', kind: 'checkbox', initial: false },
      { name: 'notes', label: 'queue.fulfill.notes', kind: 'text', initial: '', width: '12rem' },
    ],
  },
  deslab: {
    endpoint: (id) => `/services/deslab/${id}/complete`,
    ok: 'queue.msg.deslabDone',
    fields: [
      {
        name: 'conditionAfter',
        label: 'queue.fulfill.conditionAfter',
        kind: 'text',
        initial: 'Raw',
        width: '10rem',
      },
      { name: 'itemVerified', label: 'queue.fulfill.itemVerified', kind: 'checkbox', initial: false },
      { name: 'notes', label: 'queue.fulfill.notes', kind: 'text', initial: '', width: '12rem' },
    ],
  },
  batch_split: {
    endpoint: (id) => `/services/lot-split/${id}/complete`,
    ok: 'queue.msg.lotSplitDone',
    fields: [
      { name: 'itemVerified', label: 'queue.fulfill.itemVerified', kind: 'checkbox', initial: false },
      { name: 'notes', label: 'queue.fulfill.notes', kind: 'text', initial: '', width: '14rem' },
    ],
  },
  consignment: {
    endpoint: (id) => `/services/consignment/${id}/complete`,
    ok: 'queue.msg.saleDone',
    fields: [
      { name: 'saleAmountMinor', label: 'queue.fulfill.saleAmount', kind: 'money', initial: '', width: '8rem' },
      { name: 'channel', label: 'queue.fulfill.channel', kind: 'text', initial: 'eBay', width: '8rem' },
      {
        name: 'externalReference',
        label: 'queue.fulfill.externalReference',
        kind: 'text',
        initial: '',
        width: '10rem',
      },
      { name: 'itemVerified', label: 'queue.fulfill.itemVerified', kind: 'checkbox', initial: false },
      { name: 'notes', label: 'queue.fulfill.notes', kind: 'text', initial: '', width: '12rem' },
    ],
  },
};

function FulfillmentForm({
  q,
  onAct,
  t,
}: {
  q: QueueItem;
  onAct: (fn: () => Promise<unknown>, ok: string) => void;
  t: TranslateFn;
}) {
  const spec = FORMS[q.type];
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() =>
    Object.fromEntries((spec?.fields ?? []).map((f) => [f.name, f.initial])),
  );

  if (!spec) return <span className="hint">{t('queue.fulfill.noForm')}</span>;
  const asksVerified = spec.fields.some((f) => f.name === 'itemVerified');

  const complete = spec.fields.every((f) => {
    const v = values[f.name];
    if (f.kind === 'checkbox') return v === true;
    if (f.kind === 'number') return typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (f.kind === 'money') return typeof v === 'string' && dollarsToCents(v) !== null;
    return typeof v === 'string' && v.trim() !== '';
  });

  function payload(): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = { ...values };
    for (const f of spec!.fields) {
      if (f.kind !== 'money') continue;
      out[f.name] = dollarsToCents(String(values[f.name] ?? '')) ?? 0;
    }
    return out;
  }

  return (
    <div className="fulfill-form">
      {q.type === 'custom' && (
        <div className="ask-notice">
          <IconAsk />
          <span className="ask-notice-text">
            <strong className="bidi ask-line">{String((q.typeFields as { summary?: string } | null)?.summary ?? '')}</strong>
            <span className="bidi ask-line">{String((q.typeFields as { detail?: string } | null)?.detail ?? '')}</span>
          </span>
        </div>
      )}
      <span className="hint">{t('queue.fulfill.legend')}</span>
      <div className="field-row">
        {spec.fields.map((f) =>
          f.kind === 'checkbox' ? (
            <label key={f.name} className="check">
              <input
                type="checkbox"
                checked={values[f.name] === true}
                onChange={(e) => setValues((p) => ({ ...p, [f.name]: e.target.checked }))}
              />
              {t(f.label)}
            </label>
          ) : (
            <label key={f.name} className="field">
              <span className="field-label">
                {t(f.label)}
                {f.kind === 'money' && ' ($)'}
              </span>
              <input
                aria-invalid={
                  f.kind === 'money' && String(values[f.name] ?? '').trim() !== '' && dollarsToCents(String(values[f.name])) === null
                    ? true
                    : undefined
                }
                type={f.kind === 'number' ? 'number' : 'text'}
                inputMode={f.kind === 'money' ? 'decimal' : undefined}
                value={String(values[f.name] ?? '')}
                dir={f.kind === 'text' ? undefined : 'ltr'}
                style={f.width ? { width: f.width } : undefined}
                onChange={(e) =>
                  setValues((p) => ({
                    ...p,
                    [f.name]: f.kind === 'number' ? Number(e.target.value) : e.target.value,
                  }))
                }
              />
              {f.kind === 'money' && String(values[f.name] ?? '').trim() !== '' && (
                <span className={dollarsToCents(String(values[f.name])) === null ? 'field-error' : 'field-hint'}>
                  {dollarsToCents(String(values[f.name])) === null
                    ? t('queue.fulfill.notAmount')
                    : formatUsd(dollarsToCents(String(values[f.name])) ?? 0)}
                </span>
              )}
            </label>
          ),
        )}
      </div>
      <div className="actions">
        <Button
          size="sm"
          variant="primary"
          disabled={!complete}
          onClick={() => onAct(() => api.post(spec.endpoint(q.id), payload()), t(spec.ok))}
        >
          {t('queue.fulfill.submit')}
        </Button>
        {!complete && (
          <span className="field-hint">
            {t(asksVerified ? 'queue.fulfill.required' : 'queue.fulfill.requiredFields')}
          </span>
        )}
      </div>
    </div>
  );
}
