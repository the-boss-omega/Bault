import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../shared/api';
import { formatAge, formatDate, formatDateTime, formatUsd } from '../../shared/money';
import { useI18n, type MessageKey } from '../../shared/i18n';
import { useNavigation, useRoute } from '../../shared/routing';
import {
  WALLET_REQUEST_STATUSES,
  WALLET_REQUEST_TONE,
  fundingSourceLabel,
  statusLabel,
  typeLabel,
  type WalletRequest,
  type WalletRequestDetail,
} from '../../shared/walletRequests';
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
import { ConfirmationModal, DetailDrawer } from '../../shared/ui/DetailDrawer';
import { DrawerTag } from '../../shared/ui/DrawerTag';
import { Code } from '../../shared/ui/Serial';
import { IconArrowDown, IconArrowUp, IconReceipt } from '../../shared/ui/icons';

export function reviewerActions(status: string): readonly string[] {
  switch (status) {
    case 'submitted':
      return ['review', 'approve', 'reject'];
    case 'pending_review':
      return ['approve', 'reject'];
    case 'approved':
      return ['processing', 'complete', 'reject'];
    case 'processing':
      return ['complete', 'reject'];
    default:
      return [];
  }
}

/** What the person at the desk is to do with a request: decide it, see it through, or nothing (it is closed). */
type Need = 'decide' | 'carry' | 'settled';

const NEEDS: readonly Need[] = ['decide', 'carry', 'settled'];

const NEED_LABEL: Record<Need, MessageKey> = {
  decide: 'admin.requests.need.decide',
  carry: 'admin.requests.need.carry',
  settled: 'admin.requests.need.settled',
};

const NEED_OF: Record<string, Need> = {
  submitted: 'decide',
  pending_review: 'decide',
  approved: 'carry',
  processing: 'carry',
  paying: 'carry',
  completed: 'settled',
  rejected: 'settled',
  cancelled: 'settled',
  payout_failed: 'settled',
};

/** A status this page has not heard of is shown as work in hand, not filed with what is closed. */
const needOf = (status: string): Need => NEED_OF[status] ?? 'carry';

/** One of the buttons that are pressed: the way on is the main one, to turn a request down is the dangerous one. */
const ACTION_VARIANT: Record<string, 'primary' | 'secondary' | 'danger'> = {
  review: 'secondary',
  approve: 'primary',
  processing: 'secondary',
  complete: 'primary',
  reject: 'danger',
};

/**
 * The requests as a desk works them: the ones that need a decision first, then those in hand, then those that
 * are closed. What is waiting is in the order it came (the longest-waiting first, as a queue is served); what is
 * closed is the latest first, as a history is read.
 */
function groupByNeed(rows: readonly WalletRequest[]): { need: Need; rows: WalletRequest[] }[] {
  const buckets: Record<Need, WalletRequest[]> = { decide: [], carry: [], settled: [] };
  for (const row of rows) buckets[needOf(row.status)].push(row);
  const oldestFirst = (a: WalletRequest, b: WalletRequest) =>
    a.createdAt.localeCompare(b.createdAt);
  buckets.decide.sort(oldestFirst);
  buckets.carry.sort(oldestFirst);
  buckets.settled.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return NEEDS.map((need) => ({ need, rows: buckets[need] }));
}

const customerOf = (request: WalletRequest) => request.customerName || request.email || '—';

export function WalletRequestsSection({
  currentUserId,
  onMsg,
  onError,
}: {
  currentUserId: string;
  onMsg: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useI18n();
  const route = useRoute();
  const { openRecord, closeRecord } = useNavigation(route);
  const openId = route.params.request ?? null;

  const [requests, setRequests] = useState<WalletRequest[] | null>(null);
  const [detail, setDetail] = useState<WalletRequestDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  // What the last thing done in the drawer came to is told in the drawer: the page's own line is behind its backdrop.
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rejecting, setRejecting] = useState<WalletRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [completing, setCompleting] = useState<WalletRequest | null>(null);
  const [payoutReference, setPayoutReference] = useState('');
  const [busy, setBusy] = useState(false);
  const roll = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string | null>(null);

  const filtered = typeFilter !== 'all' || statusFilter !== 'all' || from !== '' || to !== '';

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    try {
      setRequests(
        await api.get<WalletRequest[]>('/admin/wallet-requests' + (query ? '?' + query : '')),
      );
    } catch (e) {
      onError((e as Error).message);
      setRequests([]);
    }
  }, [typeFilter, statusFilter, from, to, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  // A request is opened by the address: a link to it opens it, and the way back closes it.
  const fetchDetail = useCallback(
    (id: string) => api.get<WalletRequestDetail>('/admin/wallet-requests/' + id),
    [],
  );

  useEffect(() => {
    setDetail(null);
    setDetailError(null);
    setNotice(null);
    if (!openId) return;
    let current = true;
    void fetchDetail(openId)
      .then((d) => current && setDetail(d))
      .catch((e: Error) => current && setDetailError(e.message));
    return () => {
      current = false;
    };
  }, [openId, fetchDetail]);

  // The keyboard goes back to the line the request was opened from; the line may be in another group by now.
  useEffect(() => {
    if (openId || !returnTo.current) return;
    const link = roll.current?.querySelector<HTMLElement>(`[data-request="${returnTo.current}"]`);
    returnTo.current = null;
    link?.focus();
  }, [openId, requests]);

  function open(id: string) {
    returnTo.current = id;
    openRecord('request', id);
  }

  async function act(request: WalletRequest, action: string, body?: Record<string, unknown>) {
    setBusy(true);
    const inDrawer = openId === request.id;
    try {
      const done = await api.post<{ status?: string } | null>(
        '/admin/wallet-requests/' + request.id + '/' + action,
        body ?? {},
      );
      const text = t('admin.requests.actionDone', {
        code: request.code,
        status: done?.status
          ? statusLabel(t, done.status)
          : t(('admin.requests.' + action) as MessageKey),
      });
      onMsg(text);
      if (inDrawer) setNotice({ ok: true, text });
      try {
        await load();
        if (inDrawer) setDetail(await fetchDetail(request.id));
      } catch (e) {
        // It is done; what could not be read again afterwards is told where it is read.
        if (inDrawer) setDetailError((e as Error).message);
      }
    } catch (e) {
      if (inDrawer) setNotice({ ok: false, text: (e as Error).message });
      else onError((e as Error).message);
    } finally {
      setBusy(false);
      setRejecting(null);
      setCompleting(null);
      setRejectReason('');
      setPayoutReference('');
    }
  }

  async function reconcile() {
    setBusy(true);
    try {
      const r = await api.post<{
        checked: number;
        succeeded: number;
        failed: number;
        pending: number;
      }>('/admin/payouts/reconcile', {});
      onMsg(t('admin.requests.reconciled', { ...r }));
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function clearFilters() {
    setTypeFilter('all');
    setStatusFilter('all');
    setFrom('');
    setTo('');
  }

  const rows = requests ?? [];
  const groups = useMemo(() => groupByNeed(requests ?? []), [requests]);

  return (
    <>
      <Panel
        title={t('admin.requests.heading', { count: rows.length })}
        subtitle={t('admin.requests.subtitle')}
        tools={
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reconcile()}>
            {t('admin.requests.reconcile')}
          </Button>
        }
      >
        <div className="filter-bar" role="group" aria-label={t('admin.requests.filters')}>
          <Field label={t('admin.requests.filterType')} className="field--compact">
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">{t('admin.requests.filterAll')}</option>
              <option value="cash_in">{typeLabel(t, 'cash_in')}</option>
              <option value="cash_out">{typeLabel(t, 'cash_out')}</option>
            </select>
          </Field>
          <Field label={t('admin.requests.filterStatus')} className="field--compact">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">{t('admin.requests.filterAll')}</option>
              {WALLET_REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(t, s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('admin.requests.filterFrom')} className="field--compact">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('admin.requests.filterTo')} className="field--compact">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          {filtered && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              {t('wallet.clearFilters')}
            </Button>
          )}
        </div>

        {requests === null ? (
          <SkeletonTable rows={5} columns={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={filtered ? t('admin.requests.empty') : t('admin.requests.emptyAll')}
            icon={<IconReceipt />}
            action={
              filtered ? (
                <Button size="sm" variant="secondary" onClick={clearFilters}>
                  {t('wallet.clearFilters')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="dt-wrap dt-wrap--stack" ref={roll}>
            <table className="data-table data-table--desk">
              <thead>
                <tr>
                  <th scope="col">{t('wallet.requests.col.code')}</th>
                  <th scope="col">{t('wallet.requests.col.customer')}</th>
                  <th scope="col" className="td-end">
                    {t('wallet.requests.col.amount')}
                  </th>
                  <th scope="col">{t('wallet.requests.col.created')}</th>
                  <th scope="col">{t('wallet.requests.col.status')}</th>
                </tr>
              </thead>
              {groups.map(({ need, rows: group }) => {
                if (group.length === 0 && (need !== 'decide' || filtered)) return null;
                return (
                  <tbody key={need} className="roll-group">
                    <tr className="roll-group-head">
                      <th scope="rowgroup" colSpan={5}>
                        <div className="roll-group-line">
                          <span className="roll-group-name">{t(NEED_LABEL[need])}</span>
                          <span className="roll-group-count">{group.length}</span>
                          {need !== 'settled' && <GroupSums rows={group} />}
                        </div>
                      </th>
                    </tr>
                    {group.length === 0 ? (
                      <tr className="roll-group-none">
                        <td colSpan={5}>{t('admin.requests.need.decideNone')}</td>
                      </tr>
                    ) : (
                      group.map((request) => (
                        <RequestLine
                          key={request.id}
                          request={request}
                          need={need}
                          selected={request.id === openId}
                          onOpen={open}
                        />
                      ))
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </Panel>

      {openId && (
        <WalletRequestDrawer
          key={openId}
          request={detail}
          error={detailError}
          notice={notice}
          isOwnRequest={detail?.userId === currentUserId}
          busy={busy}
          onClose={() => closeRecord('request')}
          onRetry={() =>
            void fetchDetail(openId)
              .then((d) => {
                setDetail(d);
                setDetailError(null);
              })
              .catch((e: Error) => setDetailError(e.message))
          }
          onAct={(action) => {
            if (detail) void act(detail, action);
          }}
          onRequestReject={() => setRejecting(detail)}
          onRequestComplete={() => setCompleting(detail)}
        />
      )}

      {rejecting && (
        <ConfirmationModal
          title={t('admin.requests.rejectTitle')}
          body={
            <Field
              label={t('admin.requests.rejectReasonLabel')}
              hint={t('admin.requests.rejectReasonHint')}
            >
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                aria-describedby="reject-reason-hint"
              />
            </Field>
          }
          confirmLabel={t('admin.requests.reject')}
          cancelLabel={t('ui.cancel')}
          tone="danger"
          busy={busy || rejectReason.trim().length === 0}
          onConfirm={() => void act(rejecting, 'reject', { reason: rejectReason.trim() })}
          onCancel={() => {
            setRejecting(null);
            setRejectReason('');
          }}
        />
      )}

      {completing && (
        <ConfirmationModal
          title={t('admin.requests.completeTitle')}
          body={
            <>
              <p>
                {t('admin.requests.completeBody', {
                  code: completing.code,
                  amount: formatUsd(completing.amount),
                  customer:
                    completing.customerName || completing.username || completing.email || '—',
                })}
              </p>
              {completing.type === 'cash_out' && (
                <Field
                  label={t('admin.requests.payoutReferenceLabel')}
                  hint={t('admin.requests.payoutReferenceHint')}
                >
                  <input
                    type="text"
                    dir="ltr"
                    value={payoutReference}
                    onChange={(e) => setPayoutReference(e.target.value)}
                  />
                </Field>
              )}
            </>
          }
          confirmLabel={t('admin.requests.complete')}
          cancelLabel={t('ui.cancel')}
          busy={busy}
          onConfirm={() =>
            void act(
              completing,
              'complete',
              payoutReference.trim() ? { payoutReference: payoutReference.trim() } : undefined,
            )
          }
          onCancel={() => {
            setCompleting(null);
            setPayoutReference('');
          }}
        />
      )}
    </>
  );
}

/** What the group has in it, by the kind of money: the sum a desk is about to move is what it weighs first. */
function GroupSums({ rows }: { rows: readonly WalletRequest[] }) {
  const { t } = useI18n();
  const sums = (['cash_in', 'cash_out'] as const)
    .map((type) => ({
      type,
      total: rows.filter((r) => r.type === type).reduce((sum, r) => sum + r.amount, 0),
    }))
    .filter((s) => s.total > 0);
  if (sums.length === 0) return null;
  return (
    <span className="roll-group-sums">
      {sums.map((s) => (
        <span key={s.type}>
          {typeLabel(t, s.type)}{' '}
          <span className="num" dir="ltr">
            {formatUsd(s.total)}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * A request in the roll: the direction the money goes (a glyph and the word), its number, whose it is and
 * what it is for, the sum, how long it has been waiting, and where it stands. The line opens the request, by its
 * number as a link and by the whole line to a pointer.
 */
function RequestLine({
  request,
  need,
  selected,
  onOpen,
}: {
  request: WalletRequest;
  need: Need;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const classes = ['is-clickable', 'roll-line'];
  if (selected) classes.push('is-selected');
  if (need === 'decide') classes.push('is-attention');
  if (request.status === 'payout_failed') classes.push('is-alert');

  const what: ReactNode =
    request.type === 'cash_in' ? (
      fundingSourceLabel(t, request.fundingSource)
    ) : request.beneficiaryName ? (
      <bdi dir="auto">{request.beneficiaryName}</bdi>
    ) : null;

  return (
    <tr className={classes.join(' ')} onClick={() => onOpen(request.id)}>
      <td data-label={t('wallet.requests.col.code')} className="dt-primary roll-cell--request">
        <div className="roll-request">
          <span className="roll-glyph" aria-hidden="true">
            {request.type === 'cash_in' ? <IconArrowDown /> : <IconArrowUp />}
          </span>
          <div className="roll-account-text">
            <button
              type="button"
              className="register-link"
              data-request={request.id}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(request.id);
              }}
            >
              <bdi dir="ltr">{request.code}</bdi>
            </button>
            <span className="dt-sub">
              {typeLabel(t, request.type)}
              {what ? <> · {what}</> : null}
            </span>
          </div>
        </div>
      </td>
      <td data-label={t('wallet.requests.col.customer')} className="roll-cell--customer">
        <bdi dir="auto">{customerOf(request)}</bdi>
        {request.username && (
          <span className="dt-sub" dir="ltr">
            @{request.username}
          </span>
        )}
      </td>
      <td data-label={t('wallet.requests.col.amount')} className="td-end num roll-cell--amount">
        {formatUsd(request.amount)}
      </td>
      <td data-label={t('wallet.requests.col.created')} className="td-date roll-cell--created">
        <div className="roll-when">
          <span>{formatDate(request.createdAt, locale)}</span>
          {need !== 'settled' && (
            <span className="dt-sub">{formatAge(request.createdAt, locale)}</span>
          )}
        </div>
      </td>
      <td data-label={t('wallet.requests.col.status')} className="roll-cell--status">
        <StatusBadge tone={WALLET_REQUEST_TONE[request.status] ?? 'neutral'}>
          {statusLabel(t, request.status)}
        </StatusBadge>
      </td>
    </tr>
  );
}

/**
 * A request, opened: the tag it is (what kind, whose, how much, where it stands, and everything it was written
 * with), what the next step does to the money before it is pressed, and the register of what has been done to it.
 * The steps are in the foot, the way on first.
 */
function WalletRequestDrawer({
  request,
  error,
  notice,
  isOwnRequest,
  busy,
  onClose,
  onRetry,
  onAct,
  onRequestReject,
  onRequestComplete,
}: {
  request: WalletRequestDetail | null;
  error: string | null;
  notice: { ok: boolean; text: string } | null;
  isOwnRequest: boolean;
  busy: boolean;
  onClose: () => void;
  onRetry: () => void;
  onAct: (action: string) => void;
  onRequestReject: () => void;
  onRequestComplete: () => void;
}) {
  const { t, locale } = useI18n();
  const actions = request && !isOwnRequest ? reviewerActions(request.status) : [];

  const lines: { label: ReactNode; value: ReactNode }[] = [];
  if (request) {
    if (request.username)
      lines.push({
        label: t('admin.users.col.username'),
        value: <Code value={`@${request.username}`} />,
      });
    if (request.email)
      lines.push({
        label: t('admin.users.col.email'),
        value: <span dir="ltr">{request.email}</span>,
      });
    if (request.type === 'cash_in') {
      lines.push({
        label: t('wallet.request.fundingSource'),
        value: fundingSourceLabel(t, request.fundingSource),
      });
    } else {
      lines.push({
        label: t('wallet.request.destination'),
        value: request.destinationAccount ? <Code value={request.destinationAccount} /> : '—',
      });
      lines.push({
        label: t('wallet.request.beneficiary'),
        value: request.beneficiaryName ? <bdi dir="auto">{request.beneficiaryName}</bdi> : '—',
      });
    }
    if (request.reference)
      lines.push({
        label: t('wallet.request.reference'),
        value: <bdi dir="auto">{request.reference}</bdi>,
      });
    if (request.documentKey)
      lines.push({
        label: t('wallet.request.document'),
        value: <Code value={request.documentKey} />,
      });
    lines.push({
      label: t('wallet.requests.col.created'),
      value: <span className="date">{formatDateTime(request.createdAt, locale)}</span>,
    });
    if (request.settledLedgerId)
      lines.push({
        label: t('wallet.requests.settledLedger'),
        // The ledger shows an entry by the start of its id; the whole of it is in the entry.
        value: <Code value={request.settledLedgerId.slice(0, 8)} />,
      });
    if (request.payout)
      lines.push({
        label: t('admin.requests.payoutStatus'),
        value: (
          <span dir="ltr">
            {request.payout.status} · {formatUsd(request.payout.amount)} · {request.payout.provider}
          </span>
        ),
      });
    if (request.payoutReference)
      lines.push({
        label: t('admin.requests.payoutReference'),
        value: <Code value={request.payoutReference} />,
      });
  }

  return (
    <DetailDrawer
      title={request?.code ?? t('wallet.requests.detail')}
      subtitle={request ? typeLabel(t, request.type) : undefined}
      onClose={onClose}
      notice={
        notice &&
        (notice.ok ? (
          <SuccessNote>{notice.text}</SuccessNote>
        ) : (
          <ErrorState message={notice.text} />
        ))
      }
      footer={
        <>
          {actions.map((action) => (
            <Button
              key={action}
              variant={ACTION_VARIANT[action] ?? 'secondary'}
              disabled={busy}
              onClick={() => {
                if (action === 'reject') onRequestReject();
                else if (action === 'complete') onRequestComplete();
                else onAct(action);
              }}
            >
              {t(('admin.requests.' + action) as MessageKey)}
            </Button>
          ))}
          <Button variant="ghost" onClick={onClose}>
            {t('ui.close')}
          </Button>
        </>
      }
    >
      {error && <ErrorState message={error} onRetry={onRetry} retryLabel={t('ui.retry')} />}

      {request && (
        <>
          {isOwnRequest && (
            <SuccessNote tone="warning">{t('admin.requests.ownRequest')}</SuccessNote>
          )}

          <DrawerTag
            kicker={typeLabel(t, request.type)}
            title={<bdi dir="auto">{customerOf(request)}</bdi>}
            amount={formatUsd(request.amount)}
            lines={lines}
            status={
              <StatusBadge tone={WALLET_REQUEST_TONE[request.status] ?? 'neutral'}>
                {statusLabel(t, request.status)}
              </StatusBadge>
            }
            note={<span dir="ltr">{request.currency}</span>}
          >
            {request.notes?.trim() && (
              <div className="ticket-note ticket-note--whole">
                <span className="slip-label">{t('wallet.request.notes')}</span>
                <p>{request.notes.trim()}</p>
              </div>
            )}
            {request.rejectionReason && (
              <div className="ticket-note ticket-note--whole">
                <span className="slip-label">{t('wallet.requests.rejectionReason')}</span>
                <p>{request.rejectionReason}</p>
              </div>
            )}
          </DrawerTag>

          {(WALLET_REQUEST_STATUSES as readonly string[]).includes(request.status) && (
            <p className="desk-next">{t(`admin.requests.next.${request.status}` as MessageKey)}</p>
          )}

          <Panel
            title={t('wallet.requests.history')}
            subtitle={t('wallet.requests.historyNote')}
            flush
          >
            <ul className="timeline">
              {request.history.map((event) => (
                <li key={event.id}>
                  <p className="dt-primary">
                    {event.fromStatus
                      ? t('wallet.requests.event', {
                          from: statusLabel(t, event.fromStatus),
                          to: statusLabel(t, event.toStatus),
                        })
                      : t('wallet.requests.eventInitial', { to: statusLabel(t, event.toStatus) })}
                  </p>
                  <p className="dt-sub">
                    {formatDateTime(event.occurredAt, locale)}
                    {event.actorRole && (
                      <>
                        {' · '}
                        <bdi dir="ltr">{event.actorRole}</bdi>
                      </>
                    )}
                  </p>
                  {event.reason && <p className="card-desc">{event.reason}</p>}
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </DetailDrawer>
  );
}
