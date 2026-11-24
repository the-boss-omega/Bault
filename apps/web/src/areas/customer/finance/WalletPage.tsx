import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../../shared/api';
import { formatDate, formatDateTime, formatLedgerAmount, formatUsd } from '../../../shared/money';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { useRoute, useNavigation } from '../../../shared/routing';
import { useChargeNames, type ChargeNames } from './chargeNames';
import { Amount, Code } from '../../../shared/ui/Serial';
import {
  WALLET_REQUEST_STATUSES,
  WALLET_REQUEST_TONE,
  canCancel as canCancelRequest,
  fundingSourceLabel,
  matchesRequestSearch,
  statusLabel as requestStatusLabel,
  typeLabel as requestTypeLabel,
  type WalletRequest,
  type WalletRequestDetail,
  type WalletRequestReceipt,
} from '../../../shared/walletRequests';
import { WalletRequestForm, type SubmittedRequest } from './WalletRequestForms';
import { TopUpPanel, cryptoReturnFrom } from './MoneyPanels';
import { paypalReturnFromSearch } from '../../../shared/paypalCheckout';
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
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { PhotoInput, RECEIPT_TYPES, type PhotoRef } from '../../../shared/ui/PhotoInput';
import {
  IconCalendar,
  IconChart,
  IconChevronDown,
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
  referenceId?: string | null;
  chargeAction?: string | null;
  chargeItemClass?: string | null;
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
  interest: 'wallet.ref.interest',
};

function refLabel(t: TranslateFn, referenceType: string): string {
  const key = REF_LABEL[referenceType];
  return key ? t(key) : referenceType.replace(/_/g, ' ');
}

function rowDescription(t: TranslateFn, row: LedgerRow, prices: ChargeNames): string {
  const name = row.chargeAction ? prices.get(row.chargeAction, row.chargeItemClass) : null;
  if (name) return name;
  return row.referenceType ? refLabel(t, row.referenceType) : t('wallet.tx.noReference');
}

const RANGES = [
  { key: 'all', days: null, label: 'wallet.range.all' as MessageKey },
  { key: '7', days: 7, label: 'wallet.range.7' as MessageKey },
  { key: '30', days: 30, label: 'wallet.range.30' as MessageKey },
  { key: '90', days: 90, label: 'wallet.range.90' as MessageKey },
];

const SORTS = [
  { key: 'newest', label: 'wallet.sort.newest' as MessageKey },
  { key: 'oldest', label: 'wallet.sort.oldest' as MessageKey },
  { key: 'largest', label: 'wallet.sort.largest' as MessageKey },
  { key: 'smallest', label: 'wallet.sort.smallest' as MessageKey },
];

function sortRows<T>(
  rows: readonly T[],
  sort: string,
  when: (row: T) => string,
  amount: (row: T) => number,
): T[] {
  const out = [...rows];
  if (sort === 'oldest') out.sort((a, b) => when(a).localeCompare(when(b)));
  else if (sort === 'largest') out.sort((a, b) => amount(b) - amount(a));
  else if (sort === 'smallest') out.sort((a, b) => amount(a) - amount(b));
  else out.sort((a, b) => when(b).localeCompare(when(a)));
  return out;
}

function SortControl({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (next: string) => void;
  t: TranslateFn;
}) {
  return (
    <label className="control">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('wallet.sort.label')}
      >
        {SORTS.map((s) => (
          <option key={s.key} value={s.key}>
            {t(s.label)}
          </option>
        ))}
      </select>
    </label>
  );
}

function SearchControl({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  return (
    <div className="search">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
      />
    </div>
  );
}

export function WalletPage() {
  const { t, locale } = useI18n();
  const route = useRoute();
  const { goTab, openRecord, closeRecord, setParams } = useNavigation(route);
  const paypalParam = route.params.paypal ?? '';
  const paymentParam = route.params.payment ?? '';
  const paypalReturn = useMemo(
    () =>
      paypalReturnFromSearch(
        new URLSearchParams({ paypal: paypalParam, payment: paymentParam }).toString(),
      ),
    [paypalParam, paymentParam],
  );
  const clearPayPalReturn = useCallback(
    () => setParams({ paypal: null, payment: null }),
    [setParams],
  );
  const cryptoParam = route.params.crypto ?? '';
  const cryptoReturn = useMemo(
    () => cryptoReturnFrom(cryptoParam, paymentParam),
    [cryptoParam, paymentParam],
  );
  const clearCryptoReturn = useCallback(
    () => setParams({ crypto: null, payment: null, charge: null }),
    [setParams],
  );

  const [balance, setBalance] = useState<Money | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[] | null>(null);
  const [requests, setRequests] = useState<WalletRequest[] | null>(null);
  const [pending, setPending] = useState<PendingTotals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [rangeFilter, setRangeFilter] = useState('all');
  const [txQuery, setTxQuery] = useState('');
  const [txSort, setTxSort] = useState('newest');
  const prices = useChargeNames();

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
    const inflow = rows
      .filter((r) => r.direction === 'credit')
      .reduce((sum, r) => sum + r.amount, 0);
    const outflow = rows
      .filter((r) => r.direction === 'debit')
      .reduce((sum, r) => sum + r.amount, 0);
    return { inflow, outflow, count: rows.length };
  }, [ledger]);

  const tabs = TABS.map((key) => ({ key, label: t(`wallet.tab.${key}` as MessageKey) }));

  async function submitted(created: SubmittedRequest) {
    await load();
    goTab('requests');
    setStatus(
      t('wallet.request.submittedNext', {
        code: created.code,
        amount: formatUsd(created.amountMinor),
      }),
    );
  }

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
      {error && (
        <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />
      )}

      <ContextTabs
        label={t('wallet.title')}
        tabs={tabs}
        active={tab}
        onSelect={(key) => goTab(key)}
        actions={
          tab === 'cash-in' || tab === 'cash-out' ? undefined : (
            <>
              <Button variant="primary" icon={<IconPlus />} onClick={() => goTab('cash-in')}>
                {t('wallet.action.cashIn')}
              </Button>
              <Button variant="secondary" icon={<IconUpload />} onClick={() => goTab('cash-out')}>
                {t('wallet.action.cashOut')}
              </Button>
            </>
          )
        }
      />

      {tab === 'overview' && (
        <TabPanel tab="overview">
          <OverviewTab
            pending={pending}
            ledger={ledger}
            balanceAfter={balanceAfter}
            prices={prices}
            locale={locale}
            t={t}
            onOpen={(id) => openRecord('transaction', id)}
            onViewAll={() => goTab('transactions')}
            onCashIn={() => goTab('cash-in')}
            selectedId={route.params.transaction ?? null}
          />
        </TabPanel>
      )}

      {tab === 'transactions' && (
        <TabPanel tab="transactions">
          <TransactionsTab
            ledger={ledger}
            balanceAfter={balanceAfter}
            prices={prices}
            locale={locale}
            t={t}
            onOpen={(id) => openRecord('transaction', id)}
            selectedId={route.params.transaction ?? null}
            type={typeFilter}
            setType={setTypeFilter}
            range={rangeFilter}
            setRange={setRangeFilter}
            query={txQuery}
            setQuery={setTxQuery}
            sort={txSort}
            setSort={setTxSort}
          />
        </TabPanel>
      )}

      {tab === 'cash-in' && (
        <TabPanel tab="cash-in">
          <TopUpPanel
            onError={setError}
            onStatus={setStatus}
            onChanged={() => void load()}
            paypalReturn={paypalReturn}
            onPayPalReturnHandled={clearPayPalReturn}
            cryptoReturn={cryptoReturn}
            onCryptoReturnHandled={clearCryptoReturn}
          />

          <CashInRequest t={t}>
            <WalletRequestForm
              type="cash_in"
              availableMinor={balance?.amount ?? 0}
              existingRequests={requests ?? []}
              onSubmitted={submitted}
            />
          </CashInRequest>
        </TabPanel>
      )}

      {tab === 'cash-out' && (
        <TabPanel tab="cash-out">
          <Panel title={t('wallet.cashOut.title')} subtitle={t('wallet.cashOut.subtitle')}>
            {balance === null ? (
              <SkeletonTable rows={3} columns={2} />
            ) : balance.amount <= 0 ? (
              <EmptyState
                title={t('wallet.cashOut.nothing')}
                text={t('wallet.cashOut.nothingText', { amount: formatUsd(balance.amount) })}
                icon={<IconUpload />}
                action={
                  <Button variant="secondary" icon={<IconPlus />} onClick={() => goTab('cash-in')}>
                    {t('wallet.action.cashIn')}
                  </Button>
                }
              />
            ) : (
              <WalletRequestForm
                type="cash_out"
                availableMinor={balance.amount}
                existingRequests={requests ?? []}
                onSubmitted={submitted}
              />
            )}
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
            onCashIn={() => goTab('cash-in')}
            selectedId={route.params.request ?? null}
          />
        </TabPanel>
      )}

      {selected && (
        <TransactionDrawer
          row={selected}
          balanceAfter={balanceAfter.get(selected.id) ?? null}
          chargeName={
            selected.chargeAction
              ? prices.get(selected.chargeAction, selected.chargeItemClass)
              : null
          }
          locale={locale}
          t={t}
          onClose={() => closeRecord('transaction')}
          onOpenRequest={(id) => setParams({ transaction: null, request: id }, { replace: false })}
        />
      )}

      {route.params.request && (
        <RequestDrawer
          requestId={route.params.request}
          locale={locale}
          t={t}
          onClose={() => closeRecord('request')}
          onChanged={load}
          onCancelled={(code) => setStatus(t('wallet.requests.cancelledCode', { code }))}
        />
      )}
    </>
  );
}

function CashInRequest({ t, children }: { t: TranslateFn; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) body.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
  }, [open]);
  return (
    <Panel title={t('wallet.cashIn.other')} subtitle={t('wallet.cashIn.otherText')}>
      {open ? (
        <div ref={body}>{children}</div>
      ) : (
        <Button
          variant="secondary"
          icon={<IconChevronDown />}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          {t('wallet.cashIn.otherOpen')}
        </Button>
      )}
    </Panel>
  );
}

function OverviewTab({
  ledger,
  balanceAfter,
  prices,
  pending,
  locale,
  t,
  onOpen,
  onViewAll,
  onCashIn,
  selectedId,
}: {
  ledger: LedgerRow[] | null;
  balanceAfter: ReadonlyMap<string, number>;
  prices: ChargeNames;
  pending: PendingTotals | null;
  locale: string;
  t: TranslateFn;
  onOpen: (id: string) => void;
  onViewAll: () => void;
  onCashIn: () => void;
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
          recent.length > 0 ? (
            <ViewAllLink onClick={onViewAll}>{t('wallet.viewAll')}</ViewAllLink>
          ) : undefined
        }
      >
        <TransactionTable
          rows={recent}
          balanceAfter={balanceAfter}
          prices={prices}
          loading={ledger === null}
          locale={locale}
          t={t}
          onOpen={onOpen}
          selectedId={selectedId}
          emptyTitle={t('wallet.empty.title')}
          emptyText={t('wallet.empty.overviewText')}
          emptyAction={
            <Button size="sm" variant="secondary" icon={<IconPlus />} onClick={onCashIn}>
              {t('wallet.action.cashIn')}
            </Button>
          }
        />
      </Panel>
    </>
  );
}

function TransactionsTab({
  ledger,
  balanceAfter,
  prices,
  locale,
  t,
  onOpen,
  selectedId,
  type,
  setType,
  range,
  setRange,
  query,
  setQuery,
  sort,
  setSort,
}: {
  ledger: LedgerRow[] | null;
  balanceAfter: ReadonlyMap<string, number>;
  prices: ChargeNames;
  locale: string;
  t: TranslateFn;
  onOpen: (id: string) => void;
  selectedId: string | null;
  type: string;
  setType: (next: string) => void;
  range: string;
  setRange: (next: string) => void;
  query: string;
  setQuery: (next: string) => void;
  sort: string;
  setSort: (next: string) => void;
}) {
  const types = useMemo(() => {
    const present = new Set((ledger ?? []).map((r) => r.type));
    return Array.from(present);
  }, [ledger]);

  const filtered = useMemo(() => {
    const rows = ledger ?? [];
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    const cutoff = days === null ? null : Date.now() - days * 86_400_000;
    const needle = query.trim().toLowerCase();
    const kept = rows.filter((row) => {
      if (type !== 'all' && row.type !== type) return false;
      if (cutoff !== null && new Date(row.occurredAt).getTime() < cutoff) return false;
      if (needle) {
        const text = [
          typeLabel(t, row.type),
          rowDescription(t, row, prices),
          formatLedgerAmount(row.amount, row.direction),
          formatUsd(row.amount),
          formatDate(row.occurredAt, locale),
        ]
          .join(' ')
          .toLowerCase();
        if (!text.includes(needle)) return false;
      }
      return true;
    });
    return sortRows(
      kept,
      sort,
      (r) => r.occurredAt,
      (r) => r.amount,
    );
  }, [ledger, type, range, query, sort, t, prices, locale]);

  const filtersActive = type !== 'all' || range !== 'all' || query.trim() !== '';

  return (
    <Panel
      title={t('wallet.allTransactions')}
      subtitle={t('wallet.countShown', { shown: filtered.length, total: (ledger ?? []).length })}
      flush
    >
      <div className="filter-bar" role="group" aria-label={t('wallet.filtersLabel')}>
        <SearchControl value={query} onChange={setQuery} label={t('wallet.search.placeholder')} />
        <label className="control">
          <IconFilter />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label={t('ui.filters')}
          >
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
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            aria-label={t('ui.dateRange')}
          >
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {t(r.label)}
              </option>
            ))}
          </select>
        </label>
        <SortControl value={sort} onChange={setSort} t={t} />
      </div>
      <TransactionTable
        rows={filtered}
        balanceAfter={balanceAfter}
        prices={prices}
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
                setQuery('');
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
  const order = ledger
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.occurredAt.localeCompare(b.row.occurredAt) || b.index - a.index);
  for (const { row } of order) {
    running += row.direction === 'credit' ? row.amount : -row.amount;
    out.set(row.id, running);
  }
  return out;
}

function TransactionTable({
  rows,
  balanceAfter,
  prices,
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
  prices: ChargeNames;
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
                    <span>{rowDescription(t, row, prices)}</span>
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
  balanceAfter,
  chargeName,
  locale,
  t,
  onClose,
  onOpenRequest,
}: {
  row: LedgerRow;
  balanceAfter: number | null;
  chargeName: string | null;
  locale: string;
  t: TranslateFn;
  onClose: () => void;
  onOpenRequest: (id: string) => void;
}) {
  const credit = row.direction === 'credit';
  const requestId =
    row.referenceType === 'wallet_request' && row.referenceId ? row.referenceId : null;

  function downloadReceipt() {
    const lines = [
      t('wallet.tx.receiptHeading'),
      '',
      `${t('wallet.col.type')}: ${typeLabel(t, row.type)}`,
      `${t('wallet.col.date')}: ${formatDateTime(row.occurredAt, locale)}`,
      `${t('wallet.tx.reference')}: ${row.referenceType ? refLabel(t, row.referenceType) : t('wallet.tx.noReference')}`,
      ...(chargeName ? [`${t('wallet.tx.chargeFor')}: ${chargeName}`] : []),
      `${t('wallet.tx.direction')}: ${credit ? t('wallet.direction.credit') : t('wallet.direction.debit')}`,
      `${t('wallet.col.amount')}: ${formatLedgerAmount(row.amount, row.direction)} ${row.currency}`,
      ...(balanceAfter !== null
        ? [`${t('wallet.tx.balanceAfter')}: ${formatUsd(balanceAfter)} ${row.currency}`]
        : []),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `card-embassy-receipt-${row.occurredAt.slice(0, 10)}.txt`;
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
      <DrawerTag
        kicker={t('wallet.col.amount')}
        amount={formatLedgerAmount(row.amount, row.direction)}
        status={<StatusBadge tone="success">{t('wallet.tx.settled')}</StatusBadge>}
        note={<span dir="ltr">{row.currency}</span>}
      />

      <dl className="detail-list">
        <DetailRow label={t('wallet.col.type')}>{typeLabel(t, row.type)}</DetailRow>
        <DetailRow label={t('wallet.col.date')}>
          <span className="date">{formatDateTime(row.occurredAt, locale)}</span>
        </DetailRow>
        <DetailRow label={t('wallet.tx.reference')}>
          {row.referenceType ? refLabel(t, row.referenceType) : t('wallet.tx.noReference')}
        </DetailRow>
        {chargeName && (
          <DetailRow label={t('wallet.tx.chargeFor')}>
            <span>{chargeName}</span> <a href="#/faq/prices">{t('wallet.tx.priceList')}</a>
          </DetailRow>
        )}
        {requestId && (
          <DetailRow label={t('wallet.ref.wallet_request')}>
            <Button size="sm" variant="secondary" onClick={() => onOpenRequest(requestId)}>
              {t('wallet.tx.openRequest')}
            </Button>
          </DetailRow>
        )}
        <DetailRow label={t('wallet.tx.direction')}>
          <StatusBadge tone={credit ? 'success' : 'info'}>
            {credit ? t('wallet.direction.credit') : t('wallet.direction.debit')}
          </StatusBadge>
        </DetailRow>
        {balanceAfter !== null && (
          <DetailRow label={t('wallet.tx.balanceAfter')}>
            <Amount>{formatUsd(balanceAfter)}</Amount>
          </DetailRow>
        )}
        <DetailRow label={t('wallet.tx.status')} sub={t('wallet.tx.statusNote')}>
          <StatusBadge tone="success">{t('wallet.tx.settled')}</StatusBadge>
        </DetailRow>
      </dl>
    </DetailDrawer>
  );
}

function RequestsTab({
  requests,
  locale,
  t,
  onOpen,
  onCashIn,
  selectedId,
}: {
  requests: WalletRequest[] | null;
  locale: string;
  t: TranslateFn;
  onOpen: (id: string) => void;
  onCashIn: () => void;
  selectedId: string | null;
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState('newest');

  const rows = useMemo(
    () =>
      sortRows(
        (requests ?? []).filter(
          (r) =>
            matchesRequestSearch(r, query) && (statusFilter === 'all' || r.status === statusFilter),
        ),
        sort,
        (r) => r.createdAt,
        (r) => r.amount,
      ),
    [requests, query, statusFilter, sort],
  );
  const filtersActive = query.trim() !== '' || statusFilter !== 'all';

  return (
    <Panel title={t('wallet.requests.title')} subtitle={t('wallet.requests.subtitle')} flush>
      <div className="filter-bar" role="group" aria-label={t('wallet.filtersLabel')}>
        <SearchControl
          value={query}
          onChange={setQuery}
          label={t('wallet.requests.searchPlaceholder')}
        />
        <label className="control">
          <IconFilter />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label={t('wallet.requests.filterStatus')}
          >
            <option value="all">{t('wallet.requests.allStatuses')}</option>
            {WALLET_REQUEST_STATUSES.map((value) => (
              <option key={value} value={value}>
                {requestStatusLabel(t, value)}
              </option>
            ))}
          </select>
        </label>
        <SortControl value={sort} onChange={setSort} t={t} />
      </div>
      {requests === null ? (
        <SkeletonTable rows={4} columns={5} />
      ) : rows.length === 0 ? (
        filtersActive ? (
          <EmptyState
            title={t('wallet.requests.noneMatch')}
            text={t('wallet.empty.filteredText')}
            icon={<IconReceipt />}
            action={
              <Button
                size="sm"
                onClick={() => {
                  setQuery('');
                  setStatusFilter('all');
                }}
              >
                {t('wallet.clearFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t('wallet.requests.empty')}
            text={t('wallet.requests.emptyText')}
            icon={<IconReceipt />}
            action={
              <Button size="sm" variant="secondary" icon={<IconPlus />} onClick={onCashIn}>
                {t('wallet.action.cashIn')}
              </Button>
            }
          />
        )
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
                  aria-label={t('wallet.requests.rowLabel', {
                    code: request.code,
                    type: requestTypeLabel(t, request.type),
                    amount: formatUsd(request.amount),
                    status: requestStatusLabel(t, request.status),
                  })}
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
                  <td data-label={t('wallet.requests.col.type')}>
                    {requestTypeLabel(t, request.type)}
                  </td>
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
  onCancelled,
}: {
  requestId: string;
  locale: string;
  t: TranslateFn;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onCancelled: (code: string) => void;
}) {
  const [detail, setDetail] = useState<WalletRequestDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [receipt, setReceipt] = useState<WalletRequestReceipt | null>(null);
  const [receiptSaved, setReceiptSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.get<WalletRequestDetail>('/finance/wallet-requests/' + requestId);
      setDetail(next);
      setError(null);
      setReceipt(
        next.type === 'cash_in' && next.receiptAttached
          ? await api
              .get<WalletRequestReceipt>('/finance/wallet-requests/' + requestId + '/receipt')
              .catch(() => null)
          : null,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, [requestId]);

  async function attachReceipt(files: PhotoRef[]) {
    const chosen = files[0];
    if (!chosen) return;
    URL.revokeObjectURL(chosen.previewUrl);
    setBusy(true);
    setReceiptSaved(false);
    try {
      await api.put('/finance/wallet-requests/' + requestId + '/receipt', {
        documentKey: chosen.objectKey,
      });
      setReceiptSaved(true);
      await load();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel() {
    setBusy(true);
    try {
      await api.post('/finance/wallet-requests/' + requestId + '/cancel', {});
      setConfirmCancel(false);
      setCancelled(true);
      if (detail) onCancelled(detail.code);
      await load();
      await onChanged();
    } catch (e) {
      setConfirmCancel(false);
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
        {error && (
          <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />
        )}
        {cancelled && <SuccessNote>{t('wallet.requests.cancelled')}</SuccessNote>}
        {receiptSaved && <SuccessNote>{t('wallet.requests.receiptSaved')}</SuccessNote>}

        {!detail && !error && <SkeletonTable rows={5} columns={2} />}

        {detail && (
          <>
            <DrawerTag
              kicker={requestTypeLabel(t, detail.type)}
              amount={formatUsd(detail.amount)}
              status={
                <StatusBadge tone={WALLET_REQUEST_TONE[detail.status] ?? 'neutral'}>
                  {requestStatusLabel(t, detail.status)}
                </StatusBadge>
              }
              note={<span dir="ltr">{detail.currency}</span>}
            />
            <dl className="detail-list">
              {detail.type === 'cash_in' ? (
                <>
                  <DetailRow label={t('wallet.request.fundingSource')}>
                    {fundingSourceLabel(t, detail.fundingSource)}
                  </DetailRow>
                  <DetailRow label={t('wallet.requests.receipt')}>
                    <div className="stack stack--tight">
                      <span>
                        {detail.receiptAttached
                          ? t('wallet.requests.receiptAttached')
                          : t('wallet.requests.receiptNone')}
                      </span>
                      {receipt?.url && (
                        <span>
                          <a href={receipt.url} target="_blank" rel="noopener noreferrer">
                            {t('wallet.requests.receiptOpen')}
                          </a>{' '}
                          <span className="field-hint">
                            {t('wallet.requests.receiptLinkNote', {
                              minutes: Math.round(receipt.expiresInSeconds / 60),
                            })}
                          </span>
                        </span>
                      )}
                      {canCancelRequest(detail.status) && (
                        <PhotoInput
                          purpose="cash_in_receipt"
                          value={[]}
                          onChange={(files) => void attachReceipt(files)}
                          hint={t('wallet.request.receiptHint')}
                          addLabel={
                            detail.receiptAttached
                              ? t('wallet.requests.receiptReplace')
                              : t('wallet.request.receiptAdd')
                          }
                          accept={RECEIPT_TYPES}
                          camera={false}
                          max={1}
                          disabled={busy}
                        />
                      )}
                    </div>
                  </DetailRow>
                </>
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
                <DetailRow label={t('wallet.requests.rejectionReason')}>
                  {detail.rejectionReason}
                </DetailRow>
              )}
            </dl>

            <Panel
              title={t('wallet.requests.history')}
              subtitle={t('wallet.requests.historyNote')}
              flush
            >
              <ul className="timeline">
                {detail.history.map((event, i) => (
                  <li key={`${event.occurredAt}-${event.toStatus}-${i}`}>
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
