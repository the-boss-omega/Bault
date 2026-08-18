import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useT } from '../../shared/i18n';
import type { MessageKey, TranslateFn } from '../../shared/i18n';
import { serviceStatusLabel, serviceTypeLabel } from '../../shared/serviceLabels';
import { areaLabel, severityLabel, INSPECTION_SEVERITIES } from '../../shared/grading';
import { dollarsToCents } from '../../shared/money';
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
import { IconCheck, IconClose, IconServices } from '../../shared/ui/icons';

/** Service status → badge tone. Colour never carries the meaning alone. */
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
export function ServiceQueue({ onChanged }: { onChanged?: () => Promise<void> | void }) {
  const t = useT();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setQueue(await api.get<QueueItem[]>('/services/queue'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setQueue([]);
    }
  }, []);

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

      {queue === null ? (
        <SkeletonTable rows={4} columns={5} />
      ) : queue.length === 0 ? (
        <EmptyState title={t('queue.empty')} text={t('queue.emptyText')} icon={<IconServices />} />
      ) : (
        <div className="dt-wrap">
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
              {queue.map((q) => (
                <tr key={q.id}>
                  <td dir="ltr">
                    <code>{q.code ?? q.id.slice(0, 8)}</code>
                  </td>
                  <td className="dt-primary">{serviceTypeLabel(t, q.type)}</td>
                  <td dir="ltr">{q.requesterEmail ?? '—'}</td>
                  <td>{q.itemDescription ?? '—'}</td>
                  <td>
                    <StatusBadge tone={STATUS_TONE[q.status] ?? 'neutral'}>
                      {serviceStatusLabel(t, q.status)}
                    </StatusBadge>
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

  if (q.status === 'requested') {
    return (
      <div className="actions">
        <Button
          size="sm"
          variant="gold"
          icon={<IconCheck />}
          onClick={() => onAct(() => api.post(`/services/requests/${q.id}/accept`), t('queue.msg.approved'))}
        >
          {t('queue.action.approve')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={<IconClose />}
          onClick={() => onAct(() => api.post(`/services/requests/${q.id}/deny`), t('queue.msg.declined'))}
        >
          {t('queue.action.decline')}
        </Button>
      </div>
    );
  }

  // A condition inspection is one row PER AREA, so it cannot be a flat field
  // list like its neighbours and gets its own form.
  if (q.type === 'condition_inspection') return <InspectionFulfillment q={q} onAct={onAct} t={t} />;

  // status === 'in_progress' → close with the type-specific fulfillment form.
  return <FulfillmentForm q={q} onAct={onAct} t={t} />;
}

/**
 * Record what was found, one line per area the customer asked about.
 *
 * The areas are read off the REQUEST rather than offered as a free choice: the
 * customer paid to have specific areas looked at, and an operator answering a
 * different set is answering a different question. The API refuses a submission
 * that leaves any requested area unanswered, because a report that silently
 * omits the corners reads as "nothing wrong" when it means "nobody looked".
 */
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
          variant="gold"
          disabled={!complete}
          onClick={() =>
            onAct(() => api.post(`/services/inspection/${q.id}/complete`, payload()), t('queue.msg.inspectionDone'))
          }
        >
          {t('queue.fulfill.submit')}
        </Button>
        {!complete && <span className="field-hint">{t('queue.fulfill.required')}</span>}
      </div>
    </div>
  );
}

/**
 * One field of a fulfillment form. `money` fields are typed and shown in
 * dollars; they are converted to the minor units the API stores at submit time,
 * so no operator ever has to reason in cents.
 */
interface FieldSpec {
  name: string;
  label: MessageKey;
  kind: 'text' | 'number' | 'money' | 'checkbox';
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
  /**
   * A buyout QUOTE, not a completion.
   *
   * The request stays in progress afterwards: quoting is putting a number on
   * the table, and the customer still has to accept or decline it. That is why
   * this form posts to `/quote` rather than to a `/complete` like its
   * neighbours — the money only moves when the owner says yes.
   */
  buyout: {
    endpoint: (id) => `/services/buyout/${id}/quote`,
    ok: 'queue.msg.buyoutQuoted',
    fields: [
      { name: 'offerMinor', label: 'queue.fulfill.offerMinor', kind: 'money', initial: '100.00', width: '8rem' },
      { name: 'rationale', label: 'queue.fulfill.rationale', kind: 'text', initial: '', width: '16rem' },
      { name: 'itemVerified', label: 'queue.fulfill.itemVerified', kind: 'checkbox', initial: false },
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
  /**
   * De-slab records what the card looked like once it was OUT of the holder.
   * That field is not paperwork: the grade is cleared when this closes, and this
   * is what replaces it, so a card that came out with a bent corner says so.
   */
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
  /**
   * Closing this actually runs `breakLot` — every card in the lot becomes its
   * own item with its own serial, bin and intake charge. There is no undo, which
   * is why the verification tick is not decoration.
   */
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
      { name: 'saleAmountMinor', label: 'queue.fulfill.saleAmount', kind: 'money', initial: '1000.00', width: '8rem' },
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

  // Complete = every text field non-blank, every number/amount positive, every
  // confirmation checkbox ticked. The API enforces exactly the same rule.
  const complete = spec.fields.every((f) => {
    const v = values[f.name];
    if (f.kind === 'checkbox') return v === true;
    if (f.kind === 'number') return typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (f.kind === 'money') return typeof v === 'string' && dollarsToCents(v) !== null;
    return typeof v === 'string' && v.trim() !== '';
  });

  /** Dollars → minor units for every `money` field, everything else verbatim. */
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
            </label>
          ),
        )}
      </div>
      <div className="actions">
        <Button
          size="sm"
          variant="gold"
          disabled={!complete}
          onClick={() => onAct(() => api.post(spec.endpoint(q.id), payload()), t(spec.ok))}
        >
          {t('queue.fulfill.submit')}
        </Button>
        {!complete && <span className="field-hint">{t('queue.fulfill.required')}</span>}
      </div>
    </div>
  );
}
