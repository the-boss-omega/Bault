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
  const [body, setBody] = useState('PSA');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSubmissions(await api.get<Submission[]>('/services/grading/submissions'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setSubmissions([]);
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
          <input value={body} dir="ltr" style={{ width: '7rem' }} onChange={(e) => setBody(e.target.value)} />
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
        <div className="dt-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('grade.subs.col.code')}</th>
                <th scope="col">{t('grade.subs.col.body')}</th>
                <th scope="col">{t('grade.subs.col.status')}</th>
                <th scope="col">{t('grade.subs.col.tracking')}</th>
                <th scope="col">{t('grade.subs.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id}>
                  <td dir="ltr">
                    <code>{s.code}</code>
                  </td>
                  <td dir="ltr">{s.gradingBody}</td>
                  <td>
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
                  <td dir="ltr">{s.trackingNumber ?? '—'}</td>
                  <td>
                    {s.status === 'open' && (
                      <Button size="sm" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                        {openId === s.id ? t('ui.close') : t('grade.subs.manage')}
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
                        {t('grade.subs.close')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
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
    <div className="stack stack--tight" style={{ marginBlockStart: 'var(--sp-4)' }}>
      <h3 className="drawer-heading">{t('grade.subs.waiting', { body: submission.gradingBody })}</h3>

      {ready === null ? (
        <SkeletonTable rows={2} columns={3} />
      ) : ready.length === 0 ? (
        <p className="hint">{t('grade.subs.noneWaiting')}</p>
      ) : (
        <ul className="check-list" style={{ maxHeight: 'none' }}>
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
