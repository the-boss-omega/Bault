import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useT } from '../../shared/i18n';
import type { MessageKey, TranslateFn } from '../../shared/i18n';
import { serviceStatusLabel, serviceTypeLabel } from '../../shared/serviceLabels';

/** Styling only: service status → badge variant class. */
const STATUS_BADGE: Record<string, string> = {
  requested: 'badge--pending',
  in_progress: 'badge--accepted',
  completed: 'badge--done',
  cancelled: 'badge--denied',
};

interface QueueItem {
  id: string;
  code: string | null;
  type: string;
  status: string;
  itemId: string | null;
  requesterEmail: string | null;
  itemDescription: string | null;
  typeFields: Record<string, unknown> | null;
}

/**
 * Operator service queue. Shows pending + accepted service requests. An operator
 * ACCEPTS or DENIES a pending request, then CLOSES an accepted one by filling the
 * type-specific STRUCTURED FULFILLMENT FORM (Requirement 5.4) — the same
 * customer-request → warehouse-form pattern the shipment flow uses. A request
 * cannot be closed until every required field is filled and the item is verified.
 */
export function ServiceQueue() {
  const t = useT();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setQueue(await api.get<QueueItem[]>('/services/queue'));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <fieldset>
      <legend>{t('queue.title')}</legend>
      {msg && <p role="status">{msg}</p>}
      {queue.length === 0 && <p className="hint">{t('queue.empty')}</p>}
      {queue.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('queue.col.request')}</th>
                <th>{t('queue.col.service')}</th>
                <th>{t('queue.col.customer')}</th>
                <th>{t('queue.col.item')}</th>
                <th>{t('queue.col.status')}</th>
                <th>{t('queue.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((q) => (
                <tr key={q.id}>
                  <td dir="ltr"><code>{q.code ?? q.id.slice(0, 8)}</code></td>
                  <td>{serviceTypeLabel(t, q.type)}</td>
                  <td dir="ltr">{q.requesterEmail ?? '—'}</td>
                  <td>{q.itemDescription ?? '—'}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[q.status] ?? ''}`}>
                      {serviceStatusLabel(t, q.status)}
                    </span>
                  </td>
                  <td>
                    <QueueActions q={q} onAct={act} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </fieldset>
  );
}

function QueueActions({ q, onAct }: { q: QueueItem; onAct: (fn: () => Promise<unknown>, ok: string) => void }) {
  const t = useT();

  if (q.status === 'requested') {
    return (
      <div className="field-row">
        <button className="btn btn--primary" onClick={() => onAct(() => api.post(`/services/requests/${q.id}/accept`), t('queue.msg.approved'))}>{t('queue.action.approve')}</button>
        <button className="btn btn--danger" onClick={() => onAct(() => api.post(`/services/requests/${q.id}/deny`), t('queue.msg.declined'))}>{t('queue.action.decline')}</button>
      </div>
    );
  }

  // status === 'in_progress' → close with the type-specific fulfillment form.
  return <FulfillmentForm q={q} onAct={onAct} t={t} />;
}

/** One field of a fulfillment form. */
interface FieldSpec {
  name: string;
  label: MessageKey;
  kind: 'text' | 'number' | 'checkbox';
  initial: string | number | boolean;
  width?: string;
}

/**
 * Per-service-type required fields. Every form ends with an explicit
 * `itemVerified` confirmation plus free-text notes, mirroring the shipment
 * fulfillment form. The API rejects an incomplete submission independently.
 */
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
      { name: 'certificateNumber', label: 'queue.fulfill.certificateNumber', kind: 'text', initial: '', width: '10rem' },
      { name: 'itemVerified', label: 'queue.fulfill.itemVerified', kind: 'checkbox', initial: false },
      { name: 'notes', label: 'queue.fulfill.notes', kind: 'text', initial: '', width: '12rem' },
    ],
  },
  consignment: {
    endpoint: (id) => `/services/consignment/${id}/complete`,
    ok: 'queue.msg.saleDone',
    fields: [
      { name: 'saleAmountMinor', label: 'queue.fulfill.saleAmount', kind: 'number', initial: 100000, width: '8rem' },
      { name: 'channel', label: 'queue.fulfill.channel', kind: 'text', initial: 'eBay', width: '8rem' },
      { name: 'externalReference', label: 'queue.fulfill.externalReference', kind: 'text', initial: '', width: '10rem' },
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

  // Complete = every text field non-blank, every number positive, every
  // confirmation checkbox ticked. The API enforces exactly the same rule.
  const complete = spec.fields.every((f) => {
    const v = values[f.name];
    if (f.kind === 'checkbox') return v === true;
    if (f.kind === 'number') return typeof v === 'number' && Number.isFinite(v) && v > 0;
    return typeof v === 'string' && v.trim() !== '';
  });

  return (
    <div className="fulfill-form">
      <span className="hint">{t('queue.fulfill.legend')}</span>
      <div className="field-row">
        {spec.fields.map((f) => (
          <label key={f.name}>
            {f.kind === 'checkbox' ? (
              <>
                <input
                  type="checkbox"
                  checked={values[f.name] === true}
                  onChange={(e) => setValues((p) => ({ ...p, [f.name]: e.target.checked }))}
                />
                {t(f.label)}
              </>
            ) : (
              <>
                {t(f.label)}
                <input
                  type={f.kind === 'number' ? 'number' : 'text'}
                  value={String(values[f.name] ?? '')}
                  dir={f.kind === 'number' ? 'ltr' : undefined}
                  style={f.width ? { width: f.width } : undefined}
                  onChange={(e) =>
                    setValues((p) => ({
                      ...p,
                      [f.name]: f.kind === 'number' ? Number(e.target.value) : e.target.value,
                    }))
                  }
                />
              </>
            )}
          </label>
        ))}
      </div>
      <div className="actions">
        <button
          className="btn btn--primary"
          disabled={!complete}
          onClick={() => onAct(() => api.post(spec.endpoint(q.id), values), t(spec.ok))}
        >
          {t('queue.fulfill.submit')}
        </button>
      </div>
      {!complete && <p className="hint">{t('queue.fulfill.required')}</p>}
    </div>
  );
}
