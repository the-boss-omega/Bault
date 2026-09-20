import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { useI18n, useT } from '../../shared/i18n';
import { formatDate, formatUsd } from '../../shared/money';
import { SUBMISSION_TONE, submissionStatusLabel } from '../../shared/grading';
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
} from '../../shared/ui/primitives';
import { IconBox, IconShipping } from '../../shared/ui/icons';

interface Submission {
  id: string;
  code: string;
  gradingBody: string;
  status: string;
  trackingNumber: string | null;
  externalReference: string | null;
  shippedAt: string | null;
  returnedAt: string | null;
  createdAt: string;
}

/** A grading request in the service queue — what a batch's contents are read from. */
interface QueuedGrading {
  id: string;
  code: string | null;
  type: string;
  status: string;
  itemDescription: string | null;
  typeFields: Record<string, unknown> | null;
}

interface ReadyRequest {
  id: string;
  code: string | null;
  itemId: string | null;
  typeFields: Record<string, unknown> | null;
  requesterUsername: string | null;
  itemDescription: string | null;
  serialNumber: string | null;
}

/**
 * The batch that physically goes to the grader.
 *
 * Graders are not a per-card service — cards accumulate and go out together in
 * one insured package. Bault modelled none of that: a grading request was
 * accepted and then, at some later point, completed with a grade, and in between
 * the card stayed `stored` and could be listed, sold or shipped while it was
 * sitting in another company's building.
 *
 * Shipping a submission from here is the moment that closes: every card in the
 * batch moves to `at_grader` in one transaction and stops being sellable.
 */
export function GradingSubmissions() {
  const t = useT();
  const { locale } = useI18n();
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  /**
   * The graders Bault sends to, from the tier catalogue. The grader used to be a
   * free-text box, so "psa" and "PSA " opened two separate batches for one
   * company, and a request could never be added to the second.
   */
  const [graders, setGraders] = useState<string[]>([]);
  const [body, setBody] = useState('');
  /** Grading requests in the queue, grouped by the batch they are in. */
  const [members, setMembers] = useState<Map<string, QueuedGrading[]>>(new Map());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [subs, queue] = await Promise.all([
        api.get<Submission[]>('/services/grading/submissions'),
        api.get<QueuedGrading[]>('/services/queue'),
      ]);
      setSubmissions(subs);
      const grouped = new Map<string, QueuedGrading[]>();
      for (const q of queue) {
        const id = q.type === 'third_party_grading' ? q.typeFields?.submissionId : undefined;
        if (typeof id !== 'string') continue;
        grouped.set(id, [...(grouped.get(id) ?? []), q]);
      }
      setMembers(grouped);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setSubmissions([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const { tiers } = await api.get<{ tiers: { gradingBody: string }[] }>('/services/grading/tiers');
        const bodies = [...new Set(tiers.map((tier) => tier.gradingBody))];
        setGraders(bodies);
        setBody((current) => current || bodies[0] || '');
      } catch {
        /* the open-batch control stays disabled with no grader to choose */
      }
    })();
  }, []);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      setMessage(ok);
      setError(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Panel title={t('grade.subs.title')} subtitle={t('grade.subs.subtitle')}>
      {error ? <ErrorState message={error} /> : message ? <SuccessNote>{message}</SuccessNote> : null}

      <div className="field-row">
        <label className="field">
          <span className="field-label">{t('grade.subs.body')}</span>
          <select value={body} onChange={(e) => setBody(e.target.value)} dir="ltr">
            {graders.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="gold"
          icon={<IconBox />}
          disabled={body.trim() === ''}
          onClick={() =>
            void act(
              () => api.post('/services/grading/submissions', { gradingBody: body.trim() }),
              t('grade.subs.opened'),
            )
          }
        >
          {t('grade.subs.open')}
        </Button>
      </div>

      {submissions === null ? (
        <SkeletonTable rows={3} columns={5} />
      ) : submissions.length === 0 ? (
        <EmptyState title={t('grade.subs.empty')} text={t('grade.subs.emptyText')} icon={<IconBox />} />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('grade.subs.col.code')}</th>
                <th scope="col">{t('grade.subs.col.body')}</th>
                <th scope="col">{t('grade.subs.col.contents')}</th>
                <th scope="col">{t('grade.subs.col.status')}</th>
                <th scope="col">{t('grade.subs.col.tracking')}</th>
                <th scope="col">{t('grade.subs.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => {
                const inside = members.get(s.id) ?? [];
                return (
                <tr key={s.id}>
                  <td data-label={t('grade.subs.col.code')} dir="ltr">
                    <code>{s.code}</code>
                  </td>
                  <td data-label={t('grade.subs.col.body')} dir="ltr">
                    {s.gradingBody}
                  </td>
                  <td data-label={t('grade.subs.col.contents')}>
                    {/* What is in the box. After "Add" a card left the waiting
                        list and appeared nowhere, so nobody could say what a
                        batch held before shipping it. */}
                    {inside.length === 0 ? (
                      <span className="hint">{t('grade.subs.nothingIn')}</span>
                    ) : (
                      <>
                        {t('grade.subs.cards', { count: inside.length })}
                        <span className="dt-sub">
                          {inside.map((q) => q.itemDescription ?? q.code ?? '').join(' · ')}
                        </span>
                      </>
                    )}
                  </td>
                  <td data-label={t('grade.subs.col.status')}>
                    <StatusBadge tone={SUBMISSION_TONE[s.status] ?? 'neutral'}>
                      {submissionStatusLabel(t, s.status)}
                    </StatusBadge>
                    {s.shippedAt && (
                      <span className="hint" dir="ltr">
                        {' '}
                        {formatDate(s.shippedAt, locale)}
                      </span>
                    )}
                  </td>
                  <td data-label={t('grade.subs.col.tracking')} dir="ltr">
                    {s.trackingNumber ?? '—'}
                  </td>
                  <td className="td-actions">
                    {/* Two different things were both called "Close": hiding
                        this panel, and marking a shipped batch returned. */}
                    {s.status === 'open' && (
                      <Button size="sm" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                        {openId === s.id ? t('grade.subs.hide') : t('grade.subs.manage')}
                      </Button>
                    )}
                    {s.status === 'shipped' && (
                      <Button
                        size="sm"
                        onClick={() =>
                          void act(
                            () => api.post(`/services/grading/submissions/${s.id}/close`),
                            t('grade.subs.closed'),
                          )
                        }
                      >
                        {t('grade.subs.markReturned')}
                      </Button>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {openId && (
        <OpenSubmission
          submission={submissions?.find((s) => s.id === openId) ?? null}
          onChanged={() => void load()}
          onDone={(m) => {
            setMessage(m);
            setOpenId(null);
            void load();
          }}
          onError={setError}
        />
      )}
    </Panel>
  );
}

/**
 * One open batch: what is in it, what could still go into it, and shipping it.
 *
 * `readyFor` only offers requests that are accepted, aimed at THIS grader, not
 * already in a batch, and — where the tier demands it — approved. All four are
 * server-side rules; showing an ineligible card here and failing on the click
 * would just move the refusal later.
 */
function OpenSubmission({
  submission,
  onChanged,
  onDone,
  onError,
}: {
  submission: Submission | null;
  onChanged: () => void;
  onDone: (m: string) => void;
  onError: (m: string) => void;
}) {
  const t = useT();
  const [ready, setReady] = useState<ReadyRequest[] | null>(null);
  const [tracking, setTracking] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);

  const body = submission?.gradingBody;

  const loadReady = useCallback(async () => {
    if (!body) return;
    try {
      setReady(
        await api.get<ReadyRequest[]>(
          `/services/grading/submissions/ready?gradingBody=${encodeURIComponent(body)}`,
        ),
      );
    } catch (e) {
      onError((e as Error).message);
      setReady([]);
    }
  }, [body, onError]);

  useEffect(() => {
    void loadReady();
  }, [loadReady]);

  if (!submission) return null;

  async function add(requestId: string) {
    try {
      await api.post(`/services/grading/submissions/${submission!.id}/add`, { requestId });
      await loadReady();
      onChanged();
      setAdded((n) => n + 1);
    } catch (e) {
      onError((e as Error).message);
    }
  }

  async function ship() {
    setBusy(true);
    try {
      const result = await api.post<{ itemCount: number }>(
        `/services/grading/submissions/${submission!.id}/ship`,
        { trackingNumber: tracking.trim(), externalReference: reference.trim(), notes: notes.trim() },
      );
      onDone(t('grade.subs.shipped', { count: result.itemCount }));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack stack--tight stack-top">
      <h3 className="drawer-heading">{t('grade.subs.waiting', { body: submission.gradingBody })}</h3>
      {added > 0 && <SuccessNote>{t('grade.subs.addedNote', { count: added })}</SuccessNote>}

      {ready === null ? (
        <SkeletonTable rows={2} columns={3} />
      ) : ready.length === 0 ? (
        <p className="hint">{t('grade.subs.noneWaiting')}</p>
      ) : (
        <ul className="check-list list-unbounded">
          {ready.map((r) => {
            const declared = Number(r.typeFields?.declaredMinor ?? 0);
            return (
              <li key={r.id}>
                <span>
                  {r.itemDescription ?? '—'}
                  <span className="hint" dir="ltr">
                    {' '}
                    {r.serialNumber ?? ''} · {r.requesterUsername ?? ''}
                    {declared > 0 ? ` · ${formatUsd(declared)}` : ''}
                  </span>
                </span>
                <Button size="sm" onClick={() => void add(r.id)}>
                  {t('grade.subs.add')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="field-row">
        <label className="field">
          <span className="field-label">{t('grade.subs.tracking')}</span>
          <input value={tracking} dir="ltr" style={{ width: '12rem' }} onChange={(e) => setTracking(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t('grade.subs.reference')}</span>
          <input
            value={reference}
            dir="ltr"
            style={{ width: '10rem' }}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('grade.subs.notes')}</span>
          <input value={notes} style={{ width: '12rem' }} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      <p className="field-hint">{t('grade.subs.shipNote')}</p>

      <div className="actions">
        <Button
          size="sm"
          variant="gold"
          icon={<IconShipping />}
          disabled={busy || tracking.trim() === '' || notes.trim() === ''}
          onClick={() => void ship()}
        >
          {t('grade.subs.ship')}
        </Button>
      </div>
    </div>
  );
}
