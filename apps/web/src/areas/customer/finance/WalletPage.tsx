import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../../shared/api';
import { formatDate, formatDateTime, formatLedgerAmount, formatUsd } from '../../../shared/money';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { useRoute, useNavigation } from '../../../shared/routing';
import { Amount, Code } from '../../../shared/ui/Serial';
import {
  WALLET_REQUEST_TONE,
  canCancel as canCancelRequest,
  fundingSourceLabel,
  matchesRequestSearch,
  statusLabel as requestStatusLabel,
  typeLabel as requestTypeLabel,
  type WalletRequest,
  type WalletRequestDetail,
} from '../../../shared/walletRequests';
import { WalletRequestForm } from './WalletRequestForms';
import { TopUpPanel } from './MoneyPanels';
import { InTransit, StatementSlip } from './StatementSlip';
import {
  Button,
  ContextTabs,
  DetailRow,
  EmptyState,
  ErrorState,
  Panel,
  SkeletonBlock,
  SkeletonTable,
  StatusBadge,
  SuccessNote,
  TabPanel,
  ViewAllLink,
} from '../../../shared/ui/primitives';
import { ConfirmationModal, DetailDrawer } from '../../../shared/ui/DetailDrawer';
import {
  IconCalendar,
  IconChart,
  IconDownload,
  IconFilter,
  IconMarketplace,
  IconPlus,
  IconReceipt,
  IconServices,
  IconShield,
  IconTag,
  IconUpload,
} from '../../../shared/ui/icons';

interface Money {
  amount: number;
  currency: string;
}

interface LedgerRow {
  id: string;
  type: string;
  amount: number;
  direction: string;
  currency: string;
  referenceType: string | null;
  referenceId: string | null;
  occurredAt: string;
}

interface PendingTotals {
  cashInMinor: number;
  cashOutMinor: number;
  count: number;
}

const TABS = ['overview', 'transactions', 'cash-in', 'cash-out', 'requests'] as const;
type WalletTab = (typeof TABS)[number];

const TYPE_META: Record<string, { label: MessageKey; icon: ReactNode }> = {
  credit_topup: { label: 'wallet.type.credit_topup', icon: <IconPlus /> },
  sale_credit: { label: 'wallet.type.sale_credit', icon: <IconTag /> },
  interest: { label: 'wallet.type.interest', icon: <IconChart /> },
  purchase: { label: 'wallet.type.purchase', icon: <IconMarketplace /> },
  fee: { label: 'wallet.type.fee', icon: <IconReceipt /> },
  service_charge: { label: 'wallet.type.service_charge', icon: <IconServices /> },
  withdrawal: { label: 'wallet.type.withdrawal', icon: <IconUpload /> },
  shipping_refund: { label: 'wallet.type.shipping_refund', icon: <IconPlus /> },
  service_refund: { label: 'wallet.type.service_refund', icon: <IconPlus /> },
  payout_reversal: { label: 'wallet.type.payout_reversal', icon: <IconPlus /> },
  escrow_hold: { label: 'wallet.type.escrow_hold', icon: <IconShield /> },
  escrow_release: { label: 'wallet.type.escrow_release', icon: <IconPlus /> },
  escrow_refund: { label: 'wallet.type.escrow_refund', icon: <IconPlus /> },
  chargeback: { label: 'wallet.type.chargeback', icon: <IconUpload /> },
};

function typeLabel(t: TranslateFn, type: string): string {
  const meta = TYPE_META[type];
  return meta ? t(meta.label) : type.replace(/_/g, ' ');
}

const REF_LABEL: Record<string, MessageKey> = {
  charge: 'wallet.ref.charge',
  transaction: 'wallet.ref.transaction',
  withdrawal: 'wallet.ref.withdrawal',
  external_payment: 'wallet.ref.external_payment',
  listing: 'wallet.ref.listing',
  escrow_deal: 'wallet.ref.escrow_deal',
  service_request: 'wallet.ref.service_request',
  shipment: 'wallet.ref.shipment',
  wallet_request: 'wallet.ref.wallet_request',
};

function refLabel(t: TranslateFn, referenceType: string): string {
  const key = REF_LABEL[referenceType];
  return key ? t(key) : referenceType.replace(/_/g, ' ');
}

const RANGES = [
  { key: 'all', days: null, label: 'wallet.range.all' as MessageKey },
  { key: '7', days: 7, label: 'wallet.range.7' as MessageKey },
  { key: '30', days: 30, label: 'wallet.range.30' as MessageKey },
  { key: '90', days: 90, label: 'wallet.range.90' as MessageKey },
];

export function WalletPage() {
  const { t, locale } = useI18n();
  const route = useRoute();
  const { goTab, openRecord, closeRecord } = useNavigation(route);

  const [balance, setBalance] = useState<Money | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [requests, setRequests] = useState<WalletRequest[] | null>(null);
  const [pending, setPending] = useState<PendingTotals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [rangeFilter, setRangeFilter] = useState('all');

  const tab: WalletTab = (TABS as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as WalletTab)
    : 'overview';

  const load = useCallback(async () => {
    try {
      const [b, l, r, p] = await Promise.all([
        api.get<Money>('/finance/wallet'),
        api.get<LedgerRow[]>('/finance/ledger'),
        api.get<WalletRequest[]>('/finance/wallet-requests'),
        api.get<PendingTotals>('/finance/wallet/pending'),
      ]);
      setBalance(b);
      setLedger(l);
      setRequests(r);
      setPending(p);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setLedger((current) => current ?? []);
      setRequests((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => (ledger ?? []).find((row) => row.id === route.params.transaction) ?? null,
    [ledger, route.params.transaction],
  );

  const balanceAfter = useMemo(() => runningBalances(ledger ?? []), [ledger]);

  const flows = useMemo(() => {
    const rows = ledger ?? [];
    const inflow = rows.filter((r) => r.direction === 'credit').reduce((sum, r) => sum + r.amount, 0);
    const outflow = rows.filter((r) => r.direction === 'debit').reduce((sum, r) => sum + r.amount, 0);
    return { inflow, outflow, count: rows.length };
  }, [ledger]);

  const tabs = TABS.map((key) => ({ key, label: t(`wallet.tab.${key}` as MessageKey) }));

  return (
    <>
      {balance ? (
        <StatementSlip
          amount={balance.amount}
          flows={flows}
          expanded={tab === 'overview' && ledger !== null}
          t={t}
        />
      ) : (
        <SkeletonBlock className="skel-hero" />
      )}

      {status && <SuccessNote>{status}</SuccessNote>}
      {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}

      <ContextTabs
        label={t('wallet.title')}
        tabs={tabs}
        active={tab}
        onSelect={(key) => goTab(key)}
        actions={
          <>
            <Button variant="gold" icon={<IconPlus />} onClick={() => goTab('cash-in')}>
              {t('wallet.action.cashIn')}
            </Button>
            <Button variant="secondary" icon={<IconUpload />} onClick={() => goTab('cash-out')}>
              {t('wallet.action.cashOut')}
            </Button>
          </>
        }
      />

      {tab === 'overview' && (
        <TabPanel tab="overview">
          <OverviewTab
            pending={pending}
            ledger={ledger}
            balanceAfter={balanceAfter}
            locale={locale}
            t={t}
            onOpen={(id) => openRecord('transaction', id)}
            onViewAll={() => goTab('transactions')}
            selectedId={route.params.transaction ?? null}
          />
        </TabPanel>
      )}

      {tab === 'transactions' && (
        <TabPanel tab="transactions">
          <TransactionsTab
            ledger={ledger}
            balanceAfter={balanceAfter}
            locale={locale}
            t={t}
            onOpen={(id) => openRecord('transaction', id)}
            selectedId={route.params.transaction ?? null}
            type={typeFilter}
            setType={setTypeFilter}
            range={rangeFilter}
            setRange={setRangeFilter}
          />
        </TabPanel>
      )}

      {tab === 'cash-in' && (
        <TabPanel tab="cash-in">
          <TopUpPanel onError={setError} onStatus={setStatus} onChanged={() => void load()} />

          <Panel title={t('wallet.cashIn.title')} subtitle={t('wallet.cashIn.subtitle')}>
            <WalletRequestForm
              type="cash_in"
              availableMinor={balance?.amount ?? 0}
              existingRequests={requests ?? []}
              onSubmitted={async () => {
                await load();
                goTab('requests');
              }}
            />
          </Panel>
        </TabPanel>
      )}

      {tab === 'cash-out' && (
        <TabPanel tab="cash-out">
          <Panel title={t('wallet.cashOut.title')} subtitle={t('wallet.cashOut.subtitle')}>
            <WalletRequestForm
              type="cash_out"
              availableMinor={balance?.amount ?? 0}
              existingRequests={requests ?? []}
              onSubmitted={async () => {
                await load();
                goTab('requests');
              }}
            />
          </Panel>
        </TabPanel>
      )}

      {tab === 'requests' && (
        <TabPanel tab="requests">
          <RequestsTab
            requests={requests}
            locale={locale}
            t={t}
            onOpen={(id) => openRecord('request', id)}
            selectedId={route.params.request ?? null}
          />
        </TabPanel>
      )}

      {selected && (
        <TransactionDrawer
          row={selected}
          locale={locale}
          t={t}
          onClose={() => closeRecord('transaction')}
        />
      )}

      {route.params.request && (
        <RequestDrawer
          requestId={route.params.request}
          locale={locale}
          t={t}
          onClose={() => closeRecord('request')}
          onChanged={load}
        />
      )}
    </>
  );
}

function OverviewTab({
  ledger,
  balanceAfter,
  pending,
  locale,
  t,
  onOpen,
  onViewAll,
  selectedId,
}: {
  ledger: LedgerRow[] | null;
  balanceAfter: ReadonlyMap<string, number>;
  pending: PendingTotals | null;
  locale: string;
  t: TranslateFn;
  onOpen: (id: string) => void;
  onViewAll: () => void;
  selectedId: string | null;
}) {
  const recent = (ledger ?? []).slice(0, 6);

  return (
    <>
      {pending && pending.count > 0 && (
        <InTransit cashIn={pending.cashInMinor} cashOut={pending.cashOutMinor} t={t} />
      )}

      <Panel
        title={t('wallet.recent')}
        flush
        footer={
          recent.length > 0 ? <ViewAllLink onClick={onViewAll}>{t('wallet.viewAll')}</ViewAllLink> : undefined
        }
      >
        <TransactionTable
          rows={recent}
          balanceAfter={balanceAfter}
          loading={ledger === null}
          locale={locale}
          t={t}
          onOpen={onOpen}
          selectedId={selectedId}
          emptyTitle={t('wallet.empty.title')}
          emptyText={t('wallet.empty.overviewText')}
        />
      </Panel>
    </>
  );
}

function TransactionsTab({
  ledger,
  balanceAfter,
  locale,
  t,
  onOpen,
  selectedId,
  type,
  setType,
  range,
  setRange,
}: {
  ledger: LedgerRow[] | null;
  balanceAfter: ReadonlyMap<string, number>;
  locale: string;
  t: TranslateFn;
  onOpen: (id: string) => void;
  selectedId: string | null;
  type: string;
  setType: (next: string) => void;
  range: string;
  setRange: (next: string) => void;
}) {
  const types = useMemo(() => {
    const present = new Set((ledger ?? []).map((r) => r.type));
    return Array.from(present);
  }, [ledger]);

  const filtered = useMemo(() => {
    const rows = ledger ?? [];
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    const cutoff = days === null ? null : Date.now() - days * 86_400_000;
    return rows.filter((row) => {
      if (type !== 'all' && row.type !== type) return false;
      if (cutoff !== null && new Date(row.occurredAt).getTime() < cutoff) return false;
      return true;
    });
  }, [ledger, type, range]);

  const filtersActive = type !== 'all' || range !== 'all';

  return (
    <Panel
      title={t('wallet.allTransactions')}
      subtitle={t('wallet.countShown', { shown: filtered.length, total: (ledger ?? []).length })}
      flush
      tools={
        <>
          <label className="control">
            <IconFilter />
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t('ui.filters')}>
              <option value="all">{t('wallet.filter.allTypes')}</option>
              {types.map((value) => (
                <option key={value} value={value}>
                  {typeLabel(t, value)}
                </option>
              ))}
            </select>
          </label>
          <label className="control">
            <IconCalendar />
            <select value={range} onChange={(e) => setRange(e.target.value)} aria-label={t('ui.dateRange')}>
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {t(r.label)}
                </option>
              ))}
            </select>
          </label>
        </>
      }
    >
      <TransactionTable
        rows={filtered}
        balanceAfter={balanceAfter}
        loading={ledger === null}
        locale={locale}
        t={t}
        onOpen={onOpen}
        selectedId={selectedId}
        emptyTitle={t('wallet.empty.title')}
        emptyText={filtersActive ? t('wallet.empty.filteredText') : t('wallet.empty.overviewText')}
        emptyAction={
          filtersActive ? (
            <Button
              size="sm"
              onClick={() => {
                setType('all');
                setRange('all');
              }}
            >
              {t('wallet.clearFilters')}
            </Button>
          ) : undefined
        }
      />
    </Panel>
  );
}

function runningBalances(ledger: readonly LedgerRow[]): Map<string, number> {
  const out = new Map<string, number>();
  let running = 0;
  for (let i = ledger.length - 1; i >= 0; i -= 1) {
    const row = ledger[i]!;
    running += row.direction === 'credit' ? row.amount : -row.amount;
    out.set(row.id, running);
  }
  return out;
}

function TransactionTable({
  rows,
  balanceAfter,
  loading,
  locale,
  t,
  onOpen,
  selectedId,
  emptyTitle,
  emptyText,
  emptyAction,
}: {
  rows: readonly LedgerRow[];
  balanceAfter: ReadonlyMap<string, number>;
  loading: boolean;
  locale: string;
  t: TranslateFn;
  onOpen: (id: string) => void;
  selectedId: string | null;
  emptyTitle: string;
  emptyText: string;
  emptyAction?: ReactNode;
}) {
  if (loading) return <SkeletonTable rows={5} columns={5} />;
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} text={emptyText} action={emptyAction} />;
  }

  return (
    <div className="dt-wrap dt-wrap--stack">
      <table className="data-table data-table--ledger">
        <caption>{t('wallet.transactions')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('wallet.col.date')}</th>
            <th scope="col">{t('wallet.col.type')}</th>
            <th scope="col">{t('wallet.col.description')}</th>
            <th scope="col" className="td-end">
              {t('wallet.col.amount')}
            </th>
            <th scope="col" className="td-end">
              {t('wallet.col.balance')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const credit = row.direction === 'credit';
            return (
              <tr
                key={row.id}
                className={`is-clickable${row.id === selectedId ? ' is-selected' : ''}`}
                tabIndex={0}
                aria-label={t('wallet.rowLabel', {
                  type: typeLabel(t, row.type),
                  amount: formatLedgerAmount(row.amount, row.direction),
                  date: formatDate(row.occurredAt, locale),
                })}
                onClick={() => onOpen(row.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(row.id);
                  }
                }}
              >
                <td data-label={t('wallet.col.date')} className="td-tight">
                  <span className="date">{formatDate(row.occurredAt, locale)}</span>
                </td>
                <td data-label={t('wallet.col.type')}>
                  <span className="dt-primary">{typeLabel(t, row.type)}</span>
                </td>
                <td data-label={t('wallet.col.description')}>
                  {row.referenceType ? (
                    <>
                      <span>{refLabel(t, row.referenceType)}</span>
                      {row.referenceId && (
                        <span className="dt-sub">
                          <Code value={row.referenceId.slice(0, 8)} />
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="muted">{t('wallet.tx.noReference')}</span>
                  )}
                </td>
                <td data-label={t('wallet.col.amount')} className="td-end num">
                  <Amount tone={credit ? 'credit' : 'debit'}>
                    {formatLedgerAmount(row.amount, row.direction)}
                  </Amount>
                </td>
                <td data-label={t('wallet.col.balance')} className="td-end num">
                  <Amount>{formatUsd(balanceAfter.get(row.id) ?? 0)}</Amount>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TransactionDrawer({
  row,
  locale,
  t,
  onClose,
}: {
  row: LedgerRow;
  locale: string;
  t: TranslateFn;
  onClose: () => void;
}) {
  const credit = row.direction === 'credit';

  function downloadReceipt() {
    const lines = [
      'BAULT — TRANSACTION RECEIPT',
      '',
      `${t('wallet.col.type')}: ${typeLabel(t, row.type)}`,
      `${t('wallet.col.date')}: ${formatDateTime(row.occurredAt, locale)}`,
      `${t('wallet.tx.recordId')}: ${row.id}`,
      `${t('wallet.tx.reference')}: ${row.referenceId ?? '—'}`,
      `${t('wallet.tx.direction')}: ${credit ? t('wallet.direction.credit') : t('wallet.direction.debit')}`,
      `${t('wallet.col.amount')}: ${formatLedgerAmount(row.amount, row.direction)} ${row.currency}`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bault-receipt-${row.id.slice(0, 8)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <DetailDrawer
      title={t('wallet.tx.title')}
      subtitle={typeLabel(t, row.type)}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" icon={<IconDownload />} onClick={downloadReceipt}>
            {t('wallet.tx.downloadReceipt')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.close')}
          </Button>
        </>
      }
    >
      <dl className="detail-list">
        <DetailRow label={t('wallet.col.type')}>{typeLabel(t, row.type)}</DetailRow>
        <DetailRow label={t('wallet.col.date')}>
          <span className="date">{formatDateTime(row.occurredAt, locale)}</span>
        </DetailRow>
        <DetailRow label={t('wallet.tx.recordId')}>
          <code dir="ltr">{row.id}</code>
        </DetailRow>
        <DetailRow
          label={t('wallet.tx.reference')}
          sub={row.referenceType ? refLabel(t, row.referenceType) : undefined}
        >
          {row.referenceId ? <code dir="ltr">{row.referenceId}</code> : t('wallet.tx.noReference')}
        </DetailRow>
        <DetailRow label={t('wallet.tx.direction')}>
          <StatusBadge tone={credit ? 'success' : 'info'}>
            {credit ? t('wallet.direction.credit') : t('wallet.direction.debit')}
          </StatusBadge>
        </DetailRow>
        <DetailRow label={t('wallet.tx.status')} sub={t('wallet.tx.statusNote')}>
          <StatusBadge tone="success">{t('wallet.tx.settled')}</StatusBadge>
        </DetailRow>
        <DetailRow label={t('wallet.tx.currency')}>
          <span dir="ltr">{row.currency}</span>
        </DetailRow>
      </dl>

      <div className="detail-amount">
        <p className="detail-amount-label">{t('wallet.col.amount')}</p>
        <p className={`detail-amount-value ${credit ? 'amt-pos' : 'amt-neg'}`} dir="ltr">
          {formatLedgerAmount(row.amount, row.direction)}
        </p>
      </div>
    </DetailDrawer>
  );
}

function RequestsTab({
  requests,
  locale,
  t,
  onOpen,
  selectedId,
}: {
  requests: WalletRequest[] | null;
  locale: string;
  t: TranslateFn;
  onOpen: (id: string) => void;
  selectedId: string | null;
}) {
  const [query, setQuery] = useState('');

  const rows = useMemo(
    () => (requests ?? []).filter((r) => matchesRequestSearch(r, query)),
    [requests, query],
  );

  return (
    <Panel
      title={t('wallet.requests.title')}
      subtitle={t('wallet.requests.subtitle')}
      flush
      tools={
        <div className="search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('wallet.requests.searchPlaceholder')}
            aria-label={t('wallet.requests.searchPlaceholder')}
          />
        </div>
      }
    >
      {requests === null ? (
        <SkeletonTable rows={4} columns={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('wallet.requests.empty')}
          text={t('wallet.requests.emptyText')}
          icon={<IconReceipt />}
        />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <caption>{t('wallet.requests.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('wallet.requests.col.code')}</th>
                <th scope="col">{t('wallet.requests.col.type')}</th>
                <th scope="col" className="td-end">
                  {t('wallet.requests.col.amount')}
                </th>
                <th scope="col">{t('wallet.requests.col.status')}</th>
                <th scope="col">{t('wallet.requests.col.created')}</th>
                <th scope="col">{t('wallet.requests.col.updated')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((request) => (
                <tr
                  key={request.id}
                  className={'is-clickable' + (request.id === selectedId ? ' is-selected' : '')}
                  tabIndex={0}
                  onClick={() => onOpen(request.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(request.id);
                    }
                  }}
                >
                  <td data-label={t('wallet.requests.col.code')} className="dt-primary">
                    <Code value={request.code} />
                  </td>
                  <td data-label={t('wallet.requests.col.type')}>{requestTypeLabel(t, request.type)}</td>
                  <td data-label={t('wallet.requests.col.amount')} className="td-end num">
                    <span className={request.type === 'cash_in' ? 'amt-pos' : 'amt-neg'} dir="ltr">
                      {formatUsd(request.amount)}
                    </span>
                  </td>
                  <td data-label={t('wallet.requests.col.status')}>
                    <StatusBadge tone={WALLET_REQUEST_TONE[request.status] ?? 'neutral'}>
                      {requestStatusLabel(t, request.status)}
                    </StatusBadge>
                  </td>
                  <td data-label={t('wallet.requests.col.created')}>
                    <span className="date">{formatDate(request.createdAt, locale)}</span>
                  </td>
                  <td data-label={t('wallet.requests.col.updated')}>
                    <span className="date">{formatDate(request.updatedAt, locale)}</span>
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

function RequestDrawer({
  requestId,
  locale,
  t,
  onClose,
  onChanged,
}: {
  requestId: string;
  locale: string;
  t: TranslateFn;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<WalletRequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api.get<WalletRequestDetail>('/finance/wallet-requests/' + requestId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel() {
    setBusy(true);
    try {
      await api.post('/finance/wallet-requests/' + requestId + '/cancel', {});
      setConfirmCancel(false);
      await load();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DetailDrawer
        title={detail?.code ?? t('wallet.requests.detail')}
        subtitle={detail ? requestTypeLabel(t, detail.type) : undefined}
        onClose={onClose}
        footer={
          <>
            {detail && canCancelRequest(detail.status) && (
              <Button variant="danger" disabled={busy} onClick={() => setConfirmCancel(true)}>
                {t('wallet.requests.cancel')}
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              {t('ui.close')}
            </Button>
          </>
        }
      >
        {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}

        {detail && (
          <>
            <dl className="detail-list">
              <DetailRow label={t('wallet.requests.col.status')}>
                <StatusBadge tone={WALLET_REQUEST_TONE[detail.status] ?? 'neutral'}>
                  {requestStatusLabel(t, detail.status)}
                </StatusBadge>
              </DetailRow>
              <DetailRow label={t('wallet.requests.col.type')}>{requestTypeLabel(t, detail.type)}</DetailRow>
              <DetailRow label={t('wallet.requests.col.amount')}>
                <span dir="ltr">
                  {formatUsd(detail.amount)} {detail.currency}
                </span>
              </DetailRow>
              {detail.type === 'cash_in' ? (
                <DetailRow label={t('wallet.request.fundingSource')}>
                  {fundingSourceLabel(t, detail.fundingSource)}
                </DetailRow>
              ) : (
                <>
                  <DetailRow label={t('wallet.request.destination')}>
                    <code dir="ltr">{detail.destinationAccount ?? '—'}</code>
                  </DetailRow>
                  <DetailRow label={t('wallet.request.beneficiary')}>
                    {detail.beneficiaryName ?? '—'}
                  </DetailRow>
                </>
              )}
              <DetailRow label={t('wallet.request.reference')}>{detail.reference || '—'}</DetailRow>
              <DetailRow label={t('wallet.request.notes')}>{detail.notes || '—'}</DetailRow>
              <DetailRow label={t('wallet.requests.col.created')}>
                <span className="date">{formatDateTime(detail.createdAt, locale)}</span>
              </DetailRow>
              <DetailRow label={t('wallet.requests.col.updated')}>
                <span className="date">{formatDateTime(detail.updatedAt, locale)}</span>
              </DetailRow>
              {detail.rejectionReason && (
                <DetailRow label={t('wallet.requests.rejectionReason')}>{detail.rejectionReason}</DetailRow>
              )}
              {detail.settledLedgerId && (
                <DetailRow label={t('wallet.requests.settledLedger')}>
                  <code dir="ltr">{detail.settledLedgerId}</code>
                </DetailRow>
              )}
            </dl>

            <Panel title={t('wallet.requests.history')} subtitle={t('wallet.requests.historyNote')} flush>
              <ul className="timeline">
                {detail.history.map((event) => (
                  <li key={event.id}>
                    <p className="dt-primary">
                      {event.fromStatus
                        ? t('wallet.requests.event', {
                            from: requestStatusLabel(t, event.fromStatus),
                            to: requestStatusLabel(t, event.toStatus),
                          })
                        : t('wallet.requests.eventInitial', {
                            to: requestStatusLabel(t, event.toStatus),
                          })}
                    </p>
                    <p className="dt-sub">{formatDateTime(event.occurredAt, locale)}</p>
                    {event.reason && <p className="card-desc">{event.reason}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          </>
        )}
      </DetailDrawer>

      {confirmCancel && detail && (
        <ConfirmationModal
          title={t('wallet.requests.cancelTitle')}
          body={
            <p>
              {t('wallet.requests.cancelBody', {
                code: detail.code,
                amount: formatUsd(detail.amount),
              })}
            </p>
          }
          confirmLabel={t('wallet.requests.cancel')}
          cancelLabel={t('ui.cancel')}
          tone="danger"
          busy={busy}
          onConfirm={() => void cancel()}
          onCancel={() => setConfirmCancel(false)}
        />
      )}
    </>
  );
}
