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
  const [payoutReference, setPayoutReference] = useState('');
  const [busy, setBusy] = useState(false);

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
      setPayoutReference('');
    }
  }

  async function reconcile() {
    setBusy(true);
    try {
      const r = await api.post<{ checked: number; succeeded: number; failed: number; pending: number }>(
        '/admin/payouts/reconcile',
        {},
      );
      onMsg(t('admin.requests.reconciled', { ...r }));
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
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
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reconcile()}>
              {t('admin.requests.reconcile')}
            </Button>
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
                    <td className="dt-primary">
                      <bdi dir="ltr">{request.code}</bdi>
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
                    <td className="td-end num">{formatUsd(request.amount)}</td>
                    <td>
                      <StatusBadge tone={WALLET_REQUEST_TONE[request.status] ?? 'neutral'}>
                        {statusLabel(t, request.status)}
                      </StatusBadge>
                    </td>
                    <td className="td-date">{formatDate(request.createdAt, locale)}</td>
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
                  customer: completing.customerName || completing.username || completing.email || '—',
                })}
              </p>
              {completing.type === 'cash_out' && (
                <Field label={t('admin.requests.payoutReferenceLabel')} hint={t('admin.requests.payoutReferenceHint')}>
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
          <span className="date">{formatDateTime(request.createdAt, locale)}</span>
        </DetailRow>
        {request.rejectionReason && (
          <DetailRow label={t('wallet.requests.rejectionReason')}>{request.rejectionReason}</DetailRow>
        )}
        {request.settledLedgerId && (
          <DetailRow label={t('wallet.requests.settledLedger')}>
            <code dir="ltr">{request.settledLedgerId}</code>
          </DetailRow>
        )}
        {request.payout && (
          <DetailRow label={t('admin.requests.payoutStatus')}>
            <span dir="ltr">
              {request.payout.status} · {formatUsd(request.payout.amount)} · {request.payout.provider}
            </span>
          </DetailRow>
        )}
        {request.payoutReference && (
          <DetailRow label={t('admin.requests.payoutReference')}>
            <code dir="ltr">{request.payoutReference}</code>
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
