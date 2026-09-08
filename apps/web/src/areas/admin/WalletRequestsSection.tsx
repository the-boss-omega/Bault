import { useCallback, useEffect, useState } from 'react';
import { api } from '../../shared/api';
import { formatDate, formatDateTime, formatUsd } from '../../shared/money';
import { useI18n, type MessageKey } from '../../shared/i18n';
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
  DetailRow,
  EmptyState,
  Field,
  Panel,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
} from '../../shared/ui/primitives';
import { ConfirmationModal, DetailDrawer } from '../../shared/ui/DetailDrawer';
import { IconReceipt } from '../../shared/ui/icons';

/**
 * Which reviewer actions the request's CURRENT status permits.
 *
 * The same adjacency the API enforces in `wallet-request.rules.ts`, so a button
 * never offers a transition the server would refuse. `cancelled` belongs to the
 * requester, not to a reviewer, and is deliberately absent.
 */
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

/**
 * Where authorized administrators process cash-in and cash-out requests
 * (Requirement 8).
 *
 * Everything a reviewer needs is on one screen: the filtered queue, the full
 * detail of the selected request, its immutable audit history, and only the
 * actions its current status allows.
 *
 * Two rules are made VISIBLE here, not merely enforced behind the screen:
 *
 *   - SEPARATION OF DUTIES. A request the signed-in admin raised themselves
 *     offers no actions at all, and says why. The API refuses those calls too;
 *     this is the explanation, not the enforcement.
 *   - COMPLETION IS THE MONEY. "Complete" is the only action that changes a
 *     balance. It is one of two behind a confirmation dialog, and that dialog
 *     names the amount, the customer, and the fact that it cannot be undone.
 */
export function WalletRequestsSection({
  currentUserId,
  onMsg,
  onError,
}: {
  currentUserId: string;
  onMsg: (m: string) => void;
  onError: (m: string) => void;
}) {
  const { t, locale } = useI18n();
  const [requests, setRequests] = useState<WalletRequest[] | null>(null);
  const [selected, setSelected] = useState<WalletRequestDetail | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rejecting, setRejecting] = useState<WalletRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [completing, setCompleting] = useState<WalletRequest | null>(null);
  const [busy, setBusy] = useState(false);

  // Filtering is server-side, so a reviewer works a real slice of the queue
  // rather than one page of it narrowed down in the browser.
  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (typeFilter !== 'all') params.set('type', typeFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    try {
      setRequests(await api.get<WalletRequest[]>('/admin/wallet-requests' + (query ? '?' + query : '')));
    } catch (e) {
      onError((e as Error).message);
      setRequests([]);
    }
  }, [typeFilter, statusFilter, from, to, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(
    async (id: string) => {
      try {
        setSelected(await api.get<WalletRequestDetail>('/admin/wallet-requests/' + id));
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [onError],
  );

  /** One reviewer action; refreshes the queue and the open drawer together. */
  async function act(request: WalletRequest, action: string, body?: Record<string, unknown>) {
    setBusy(true);
    try {
      await api.post('/admin/wallet-requests/' + request.id + '/' + action, body ?? {});
      onMsg(
        t('admin.requests.actionDone', {
          code: request.code,
          status: t(('admin.requests.' + action) as MessageKey),
        }),
      );
      await load();
      if (selected?.id === request.id) await openDetail(request.id);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      setRejecting(null);
      setCompleting(null);
      setRejectReason('');
    }
  }

  const rows = requests ?? [];

  return (
    <>
      <Panel
        title={t('admin.requests.heading', { count: rows.length })}
        subtitle={t('admin.requests.subtitle')}
        flush
        tools={
          <>
            <label className="control">
              <select
                value={typeFilter}
                aria-label={t('admin.requests.filterType')}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">{t('admin.requests.filterAll')}</option>
                <option value="cash_in">{typeLabel(t, 'cash_in')}</option>
                <option value="cash_out">{typeLabel(t, 'cash_out')}</option>
              </select>
            </label>
            <label className="control">
              <select
                value={statusFilter}
                aria-label={t('admin.requests.filterStatus')}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">{t('admin.requests.filterAll')}</option>
                {WALLET_REQUEST_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(t, s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="control">
              <input
                type="date"
                value={from}
                aria-label={t('admin.requests.filterFrom')}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="control">
              <input
                type="date"
                value={to}
                aria-label={t('admin.requests.filterTo')}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </>
        }
      >
        {requests === null ? (
          <SkeletonTable rows={5} columns={6} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('admin.requests.empty')} icon={<IconReceipt />} />
        ) : (
          <div className="dt-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('wallet.requests.col.code')}</th>
                  <th scope="col">{t('wallet.requests.col.customer')}</th>
                  <th scope="col">{t('wallet.requests.col.type')}</th>
                  <th scope="col" className="td-end">
                    {t('wallet.requests.col.amount')}
                  </th>
                  <th scope="col">{t('wallet.requests.col.status')}</th>
                  <th scope="col">{t('wallet.requests.col.created')}</th>
                  <th scope="col" className="td-tight" />
                </tr>
              </thead>
              <tbody>
                {rows.map((request) => (
                  <tr key={request.id} className={selected?.id === request.id ? 'is-selected' : undefined}>
                    <td dir="ltr" className="dt-primary">
                      {request.code}
                    </td>
                    <td>
                      {request.customerName || request.email || '—'}
                      {request.username && (
                        <span className="dt-sub" dir="ltr">
                          @{request.username}
                        </span>
                      )}
                    </td>
                    <td>{typeLabel(t, request.type)}</td>
                    <td className="td-end num" dir="ltr">
                      {formatUsd(request.amount)}
                    </td>
                    <td>
                      <StatusBadge tone={WALLET_REQUEST_TONE[request.status] ?? 'neutral'}>
                        {statusLabel(t, request.status)}
                      </StatusBadge>
                    </td>
                    <td dir="ltr">{formatDate(request.createdAt, locale)}</td>
                    <td className="td-tight">
                      <Button size="sm" variant="secondary" onClick={() => void openDetail(request.id)}>
                        {t('wallet.requests.detail')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected && (
        <WalletRequestDrawer
          request={selected}
          isOwnRequest={selected.userId === currentUserId}
          busy={busy}
          onClose={() => setSelected(null)}
          onAct={(action) => void act(selected, action)}
          onRequestReject={() => setRejecting(selected)}
          onRequestComplete={() => setCompleting(selected)}
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
          // A rejection without a reason is not a decision anyone can audit, so
          // Confirm stays unavailable until one is typed.
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
            <p>
              {t('admin.requests.completeBody', {
                code: completing.code,
                amount: formatUsd(completing.amount),
                customer: completing.customerName || completing.username || completing.email || '—',
              })}
            </p>
          }
          confirmLabel={t('admin.requests.complete')}
          cancelLabel={t('ui.cancel')}
          busy={busy}
          onConfirm={() => void act(completing, 'complete')}
          onCancel={() => setCompleting(null)}
        />
      )}
    </>
  );
}

function WalletRequestDrawer({
  request,
  isOwnRequest,
  busy,
  onClose,
  onAct,
  onRequestReject,
  onRequestComplete,
}: {
  request: WalletRequestDetail;
  isOwnRequest: boolean;
  busy: boolean;
  onClose: () => void;
  onAct: (action: string) => void;
  onRequestReject: () => void;
  onRequestComplete: () => void;
}) {
  const { t, locale } = useI18n();
  const actions = isOwnRequest ? [] : reviewerActions(request.status);

  return (
    <DetailDrawer
      title={request.code}
      subtitle={typeLabel(t, request.type)}
      onClose={onClose}
      footer={
        <>
          {actions.map((action) => (
            <Button
              key={action}
              variant={action === 'complete' ? 'gold' : action === 'reject' ? 'danger' : 'secondary'}
              disabled={busy}
              onClick={() => {
                // The two consequential ones go through a dialog; the rest are
                // ordinary queue movements and take effect immediately.
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
      {isOwnRequest && <SuccessNote tone="warning">{t('admin.requests.ownRequest')}</SuccessNote>}

      <dl className="detail-list">
        <DetailRow label={t('wallet.requests.col.status')}>
          <StatusBadge tone={WALLET_REQUEST_TONE[request.status] ?? 'neutral'}>
            {statusLabel(t, request.status)}
          </StatusBadge>
        </DetailRow>
        <DetailRow label={t('wallet.requests.col.customer')}>
          {request.customerName || request.email || '—'}
          {request.username ? ' (@' + request.username + ')' : ''}
        </DetailRow>
        <DetailRow label={t('wallet.requests.col.amount')}>
          <span dir="ltr">
            {formatUsd(request.amount)} {request.currency}
          </span>
        </DetailRow>
        {request.type === 'cash_in' ? (
          <DetailRow label={t('wallet.request.fundingSource')}>
            {fundingSourceLabel(t, request.fundingSource)}
          </DetailRow>
        ) : (
          <>
            <DetailRow label={t('wallet.request.destination')}>
              <code dir="ltr">{request.destinationAccount ?? '—'}</code>
            </DetailRow>
            <DetailRow label={t('wallet.request.beneficiary')}>{request.beneficiaryName ?? '—'}</DetailRow>
          </>
        )}
        <DetailRow label={t('wallet.request.reference')}>{request.reference || '—'}</DetailRow>
        <DetailRow label={t('wallet.request.document')}>
          {request.documentKey ? <code dir="ltr">{request.documentKey}</code> : '—'}
        </DetailRow>
        <DetailRow label={t('wallet.request.notes')}>{request.notes || '—'}</DetailRow>
        <DetailRow label={t('wallet.requests.col.created')}>
          <span dir="ltr">{formatDateTime(request.createdAt, locale)}</span>
        </DetailRow>
        {request.rejectionReason && (
          <DetailRow label={t('wallet.requests.rejectionReason')}>{request.rejectionReason}</DetailRow>
        )}
        {/* The proof that completion, and only completion, moved money. */}
        {request.settledLedgerId && (
          <DetailRow label={t('wallet.requests.settledLedger')}>
            <code dir="ltr">{request.settledLedgerId}</code>
          </DetailRow>
        )}
      </dl>

      <Panel title={t('wallet.requests.history')} subtitle={t('wallet.requests.historyNote')} flush>
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
              <p className="dt-sub" dir="ltr">
                {formatDateTime(event.occurredAt, locale)}
                {event.actorRole ? ' · ' + event.actorRole : ''}
              </p>
              {event.reason && <p className="card-desc">{event.reason}</p>}
            </li>
          ))}
        </ul>
      </Panel>
    </DetailDrawer>
  );
}
