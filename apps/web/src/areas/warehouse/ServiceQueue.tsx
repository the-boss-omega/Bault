import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useT } from '../../shared/i18n';
import type { MessageKey, TranslateFn } from '../../shared/i18n';
import { serviceStatusLabel, serviceTypeLabel } from '../../shared/serviceLabels';
import { areaLabel, severityLabel, INSPECTION_SEVERITIES } from '../../shared/grading';
import { dollarsToCents, formatUsd } from '../../shared/money';
import { PhotoInput, type PhotoRef } from '../../shared/ui/PhotoInput';
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
  requesterUsername?: string | null;
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
export function ServiceQueue({
  onChanged,
  isAdmin = false,
}: {
  onChanged?: () => Promise<void> | void;
  /** Admins also decide grading approvals from the queue. */
  isAdmin?: boolean;
}) {
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
              {queue.map((q) => (
                <tr key={q.id}>
                  <td data-label={t('queue.col.request')} dir="ltr">
                    <code>{q.code ?? q.id.slice(0, 8)}</code>
                  </td>
                  <td data-label={t('queue.col.service')} className="dt-primary">
                    {serviceTypeLabel(t, q.type)}
                  </td>
                  <td data-label={t('queue.col.customer')} dir="ltr">
                    {q.requesterUsername ? `@${q.requesterUsername}` : (q.requesterEmail ?? '—')}
                  </td>
                  <td data-label={t('queue.col.item')}>{q.itemDescription ?? '—'}</td>
                  <td data-label={t('queue.col.status')}>
                    <StatusBadge tone={STATUS_TONE[q.status] ?? 'neutral'}>
                      {serviceStatusLabel(t, q.status)}
                    </StatusBadge>
                  </td>
                  <td className="td-actions">
                    <QueueActions q={q} onAct={act} isAdmin={isAdmin} />
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
  isAdmin,
}: {
  q: QueueItem;
  onAct: (fn: () => Promise<unknown>, ok: string) => void;
  isAdmin: boolean;
}) {
  const t = useT();
  const fields = (q.typeFields ?? {}) as Record<string, unknown>;

  // Donation, remove-commons and warehouse-transfer rows are completed by the
  // collector's own confirmation, not by anything done at this bench. They used
  // to offer Approve, which led to "This request type closes automatically" and
  // a row that sat in the queue for good.
  if (!HAS_OPERATOR_STEP.has(q.type)) {
    return (
      <div className="stack stack--tight">
        <span className="hint">{t('queue.noStep')}</span>
        {q.status === 'requested' && (
          <ConfirmedDecline
            label={t('queue.action.dismiss')}
            prompt={t('queue.dismissPrompt')}
            onConfirm={() => onAct(() => api.post(`/services/requests/${q.id}/deny`), t('queue.msg.dismissed'))}
          />
        )}
      </div>
    );
  }

  if (q.status === 'requested') {
    return (
      <div className="stack stack--tight">
        {q.type === 'custom' && <CustomAsk fields={fields} />}
        <div className="actions">
          <Button
            size="sm"
            variant="gold"
            icon={<IconCheck />}
            onClick={() => onAct(() => api.post(`/services/requests/${q.id}/accept`), t('queue.msg.approved'))}
          >
            {t('queue.action.approve')}
          </Button>
          {/* A custom request is refused WITH a reason, which the collector is
              told; the bare deny is for requests whose refusal needs none. */}
          {q.type === 'custom' ? (
            <ReasonAction
              label={t('queue.action.decline')}
              onSubmit={(reason) =>
                onAct(() => api.post(`/services/custom/${q.id}/decline`, { reason }), t('queue.msg.declined'))
              }
            />
          ) : (
            <ConfirmedDecline
              label={t('queue.action.decline')}
              prompt={t('queue.declinePrompt')}
              onConfirm={() => onAct(() => api.post(`/services/requests/${q.id}/deny`), t('queue.msg.declined'))}
            />
          )}
        </div>
      </div>
    );
  }

  // A condition inspection is one row PER AREA, so it cannot be a flat field
  // list like its neighbours and gets its own form.
  if (q.type === 'condition_inspection') return <InspectionFulfillment q={q} onAct={onAct} t={t} />;
  if (q.type === 'custom') return <CustomStage q={q} fields={fields} onAct={onAct} />;
  if (q.type === 'professional_photography') return <PhotographyFulfillment q={q} onAct={onAct} />;

  if (q.type === 'third_party_grading') {
    // A card past the walkthrough threshold waits for a manager. Only an admin
    // can decide; an operator sees why the row can't move yet.
    if (fields.approvalRequired === true && fields.approvalState === 'pending') {
      return isAdmin ? (
        <GradingApproval q={q} onAct={onAct} />
      ) : (
        <StatusBadge tone="warning">{t('queue.grading.awaitingApproval')}</StatusBadge>
      );
    }
    return (
      <div className="stack stack--tight">
        <span className="hint">
          {typeof fields.submissionCode === 'string'
            ? t('queue.grading.inSubmission', { code: fields.submissionCode })
            : t('queue.grading.notInSubmission')}
        </span>
        <FulfillmentForm q={q} onAct={onAct} t={t} />
      </div>
    );
  }

  if (q.type === 'buyout' && fields.stage === 'quoted') {
    return (
      <div className="stack stack--tight">
        <StatusBadge tone="info">
          {t('queue.quoted.waiting', { amount: formatUsd(Number(fields.offerMinor ?? 0)) })}
        </StatusBadge>
        <details>
          <summary className="link-more">{t('queue.quoted.revise')}</summary>
          <FulfillmentForm q={q} onAct={onAct} t={t} />
        </details>
      </div>
    );
  }

  // status === 'in_progress' → close with the type-specific fulfillment form.
  return <FulfillmentForm q={q} onAct={onAct} t={t} />;
}

/**
 * A decline that asks once before it acts. A paid request was cancelled by a
 * single tap with nothing in between — and a denial does not refund.
 */
function ConfirmedDecline({ label, prompt, onConfirm }: { label: string; prompt: string; onConfirm: () => void }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button size="sm" variant="danger" icon={<IconClose />} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="stack stack--tight">
      <span className="field-error">{prompt}</span>
      <div className="actions">
        <Button size="sm" variant="danger" onClick={onConfirm}>
          {label}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
          {t('ui.cancel')}
        </Button>
      </div>
    </div>
  );
}

/** What the collector asked for, above whatever is done about it. */
function CustomAsk({ fields }: { fields: Record<string, unknown> }) {
  return (
    <div className="ask-notice">
      <IconAsk />
      <span>
        <strong>{String(fields.summary ?? '')}</strong>
        <br />
        {String(fields.detail ?? '')}
      </span>
    </div>
  );
}

/**
 * A custom request, by stage. Awaiting a quote: price it, or decline with a
 * reason. Quoted: wait for the collector (the quote can still be revised).
 * Accepted, which means paid for: record what was done. The quote form is never
 * shown once the collector has paid, because a second quote would be a second
 * charge.
 */
function CustomStage({
  q,
  fields,
  onAct,
}: {
  q: QueueItem;
  fields: Record<string, unknown>;
  onAct: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const t = useT();
  const [notes, setNotes] = useState('');
  const stage = typeof fields.stage === 'string' ? fields.stage : 'awaiting_quote';

  const decline = (
    <ReasonAction
      label={t('queue.action.decline')}
      onSubmit={(reason) =>
        onAct(() => api.post(`/services/custom/${q.id}/decline`, { reason }), t('queue.msg.declined'))
      }
    />
  );

  if (stage === 'accepted') {
    return (
      <div className="fulfill-form">
        <CustomAsk fields={fields} />
        <StatusBadge tone="success">
          {t('queue.custom.paid', { amount: formatUsd(Number(fields.priceMinor ?? 0)) })}
        </StatusBadge>
        <span className="hint">{String(fields.scope ?? '')}</span>
        <label className="field">
          <span className="field-label">{t('queue.custom.doneNotes')}</span>
          <input value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="actions">
          <Button
            size="sm"
            variant="gold"
            disabled={notes.trim().length < 5}
            onClick={() =>
              onAct(
                () => api.post(`/services/custom/${q.id}/complete`, { notes: notes.trim() }),
                t('queue.msg.customDone'),
              )
            }
          >
            {t('queue.custom.markDone')}
          </Button>
          {notes.trim().length < 5 && <span className="field-hint">{t('queue.custom.doneHint')}</span>}
        </div>
      </div>
    );
  }

  if (stage === 'quoted') {
    return (
      <div className="stack stack--tight">
        <StatusBadge tone="info">
          {t('queue.quoted.waiting', { amount: formatUsd(Number(fields.priceMinor ?? 0)) })}
        </StatusBadge>
        <details>
          <summary className="link-more">{t('queue.quoted.revise')}</summary>
          <FulfillmentForm q={q} onAct={onAct} t={t} />
        </details>
        <div className="actions">{decline}</div>
      </div>
    );
  }

  return (
    <div className="stack stack--tight">
      <FulfillmentForm q={q} onAct={onAct} t={t} />
      <div className="actions">{decline}</div>
    </div>
  );
}

/** A refusal that has to say why: the reason is sent to the collector. */
function ReasonAction({ label, onSubmit }: { label: string; onSubmit: (reason: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <Button size="sm" variant="danger" icon={<IconClose />} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
      <label className="field" style={{ flex: '1 1 200px' }}>
        <span className="field-label">{t('queue.reason')}</span>
        <input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </label>
      <Button
        size="sm"
        variant="danger"
        disabled={reason.trim().length < 5}
        style={{ alignSelf: 'end' }}
        onClick={() => onSubmit(reason.trim())}
      >
        {label}
      </Button>
      <Button size="sm" variant="ghost" style={{ alignSelf: 'end' }} onClick={() => setOpen(false)}>
        {t('ui.cancel')}
      </Button>
    </div>
  );
}

/** A manager's decision on a high-value grading request, with the reason on record. */
function GradingApproval({
  q,
  onAct,
}: {
  q: QueueItem;
  onAct: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const t = useT();
  const [reason, setReason] = useState('');
  const send = (approve: boolean) =>
    onAct(
      () => api.post(`/services/grading/${q.id}/approval`, { approve, reason: reason.trim() }),
      t(approve ? 'queue.grading.approved' : 'queue.grading.refused'),
    );
  return (
    <div className="fulfill-form">
      <StatusBadge tone="warning">{t('queue.grading.awaitingApproval')}</StatusBadge>
      <label className="field">
        <span className="field-label">{t('queue.reason')}</span>
        <input value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="actions">
        <Button size="sm" variant="gold" icon={<IconCheck />} disabled={!reason.trim()} onClick={() => send(true)}>
          {t('queue.grading.approve')}
        </Button>
        <Button size="sm" variant="danger" icon={<IconClose />} disabled={!reason.trim()} onClick={() => send(false)}>
          {t('queue.grading.refuse')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The shoot, uploaded. The collector receives what is attached here, so the
 * photograph is a real upload rather than a storage key typed into a box — a
 * typed key was never checked and could point at nothing.
 */
function PhotographyFulfillment({
  q,
  onAct,
}: {
  q: QueueItem;
  onAct: (fn: () => Promise<unknown>, ok: string) => void;
}) {
  const t = useT();
  const [photos, setPhotos] = useState<PhotoRef[]>([]);
  const [lighting, setLighting] = useState('');
  const [verified, setVerified] = useState(false);
  const [notes, setNotes] = useState('');
  const first = photos[0];
  const complete = first !== undefined && lighting.trim() !== '' && verified && notes.trim() !== '';
  return (
    <div className="fulfill-form">
      <PhotoInput purpose="service_media" value={photos} onChange={setPhotos} label={t('queue.fulfill.photos')} max={12} />
      <div className="field-row">
        <label className="field">
          <span className="field-label">{t('queue.fulfill.lighting')}</span>
          <input value={lighting} style={{ width: '10rem' }} onChange={(e) => setLighting(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
          {t('queue.fulfill.itemVerified')}
        </label>
        <label className="field">
          <span className="field-label">{t('queue.fulfill.notes')}</span>
          <input value={notes} style={{ width: '12rem' }} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <div className="actions">
        <Button
          size="sm"
          variant="gold"
          disabled={!complete}
          onClick={() =>
            first &&
            onAct(
              () =>
                api.post(`/services/photography/${q.id}/complete`, {
                  objectKey: first.objectKey,
                  shotCount: photos.length,
                  lighting,
                  itemVerified: verified,
                  notes,
                }),
              t('queue.msg.photographyDone'),
            )
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
  /**
   * A custom request is QUOTED, like a buyout, and for the same reason: nobody
   * knows what it costs until an operator reads what was asked for.
   *
   * `scope` is required and is not a note. The collector is about to agree to a
   * figure, and what they are agreeing to is this sentence — "we will do it for
   * $30" with nothing behind it is not something anybody can accept. The ask
   * itself is shown above the form so it can be read without leaving the row.
   */
  custom: {
    endpoint: (id) => `/services/custom/${id}/quote`,
    ok: 'queue.msg.customQuoted',
    fields: [
      { name: 'priceMinor', label: 'queue.fulfill.customPrice', kind: 'money', initial: '25.00', width: '8rem' },
      { name: 'scope', label: 'queue.fulfill.customScope', kind: 'text', initial: '', width: '20rem' },
    ],
  },
  video_review: {
    endpoint: (id) => `/services/video/${id}/complete`,
    ok: 'queue.msg.videoDone',
    fields: [
      { name: 'objectKey', label: 'queue.fulfill.videoLink', kind: 'text', initial: '', width: '14rem' },
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

/** Request types with work to do at this bench. The rest close themselves. */
const HAS_OPERATOR_STEP = new Set([
  ...Object.keys(FORMS),
  'condition_inspection',
  'custom',
  'professional_photography',
]);

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
  // A consignment is sold down the channel the collector chose, and the fee is
  // charged on that channel, so it is read from the request, never retyped.
  const channel = q.type === 'consignment' ? String(q.typeFields?.channel ?? '') : null;

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
    if (channel !== null) out.channel = channel;
    for (const f of spec!.fields) {
      if (f.kind !== 'money') continue;
      out[f.name] = dollarsToCents(String(values[f.name] ?? '')) ?? 0;
    }
    return out;
  }

  return (
    <div className="fulfill-form">
      {/*
        What the collector actually asked for.
        A custom row otherwise reads "A custom request" — the type, not the
        thing — and the operator is being asked to price something they cannot
        see without opening another screen.
      */}
      {q.type === 'custom' && <CustomAsk fields={(q.typeFields ?? {}) as Record<string, unknown>} />}
      <span className="hint">{t('queue.fulfill.legend')}</span>
      {channel !== null && <span className="hint">{t('queue.fulfill.channelIs', { channel })}</span>}
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
