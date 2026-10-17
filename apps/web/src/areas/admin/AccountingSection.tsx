import { useState } from 'react';
import { api } from '../../shared/api';
import { formatDateTime, formatUsd } from '../../shared/money';
import { useI18n, type MessageKey } from '../../shared/i18n';
import { Button, EmptyState, MetricCard, Panel, StatusBadge } from '../../shared/ui/primitives';
import { IconAlert, IconCheckCircle, IconChart, IconDownload, IconReceipt, IconWallet } from '../../shared/ui/icons';

/** `GET /admin/accounting/summary`; see `apps/api/src/modules/adm/accounting.service.ts`. */
export interface AccountingSummary {
  month: string;
  currency: string;
  byType: { type: string; direction: string; count: number; totalMinor: number }[];
  revenue: {
    totalMinor: number;
    lines: { key: string; totalMinor: number }[];
    carrierCostOnShippingChargesMinor: number;
  };
  customerMoney: { inMinor: number; outMinor: number; reversedMinor: number; netMinor: number };
  balancesHeld: {
    asOf: string;
    customerTotalMinor: number;
    owedToCustomersMinor: number;
    owedByCustomersMinor: number;
    accountsWithBalance: number;
    platformAccountMinor: number;
  };
  note: string;
}

/** `GET /admin/accounting/reconciliation`; see `reconciliation.ts`. */
export interface Reconciliation {
  checked: { topups: number; payouts: number; withdrawals: number };
  matched: number;
  mismatches: {
    kind: string;
    detail: string;
    paymentId: string | null;
    ledgerId: string | null;
    username: string | null;
    expectedMinor: number | null;
    recordedMinor: number | null;
    at: string;
  }[];
  pending: { paymentId: string; purpose: string; username: string | null; amount: number; at: string; detail: string }[];
  manualCashIns: { count: number; totalMinor: number };
}

const REVENUE_LABEL: Record<string, MessageKey> = {
  service_charge: 'admin.accounting.revenue.service_charge',
  marketplace_fee: 'admin.accounting.revenue.marketplace_fee',
  consignment_fee: 'admin.accounting.revenue.consignment_fee',
  escrow_fee: 'admin.accounting.revenue.escrow_fee',
  cash_out_fee: 'admin.accounting.revenue.cash_out_fee',
  chargeback_fee: 'admin.accounting.revenue.chargeback_fee',
  custom_request_fee: 'admin.accounting.revenue.custom_request_fee',
  other_fee: 'admin.accounting.revenue.other_fee',
  interest: 'admin.accounting.revenue.interest',
};

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * The accountant's exports, where an administrator's money screens are.
 *
 * Three buttons, one per report, each reading an admin-only endpoint. Nothing
 * here computes a figure: the summary and the reconciliation are the API's, and
 * the ledger export is a plain download of `ledger.csv` (a link, not a fetch),
 * so a year of rows streams straight to disk instead of through this tab's
 * memory. No tax is applied or separated anywhere; that is for the accountant.
 */
export function AccountingSection({ onError }: { onError: (m: string) => void }) {
  const { t, locale } = useI18n();
  const today = new Date();
  const [from, setFrom] = useState(isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))));
  const [to, setTo] = useState(isoDay(today));
  const [month, setMonth] = useState(isoDay(today).slice(0, 7));
  const [summary, setSummary] = useState<AccountingSummary | null>(null);
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  const [busy, setBusy] = useState<'summary' | 'recon' | null>(null);

  const exportHref = `/api/v1/admin/accounting/ledger.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  async function loadSummary() {
    setBusy('summary');
    try {
      setSummary(await api.get<AccountingSummary>(`/admin/accounting/summary?month=${encodeURIComponent(month)}`));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function loadRecon() {
    setBusy('recon');
    try {
      setRecon(await api.get<Reconciliation>('/admin/accounting/reconciliation'));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <p className="hint">{t('admin.accounting.intro')}</p>

      <Panel title={t('admin.accounting.ledger.title')} subtitle={t('admin.accounting.ledger.subtitle')}>
        <div className="row accounting-controls">
          <label className="field">
            <span className="field-label">{t('admin.accounting.ledger.from')}</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" />
          </label>
          <label className="field">
            <span className="field-label">{t('admin.accounting.ledger.to')}</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" />
          </label>
          <a className="btn btn--gold btn--sm" href={exportHref} download>
            <IconDownload />
            {t('admin.accounting.ledger.download')}
          </a>
        </div>
      </Panel>

      <Panel
        title={t('admin.accounting.summary.title')}
        subtitle={t('admin.accounting.summary.subtitle')}
        tools={
          <div className="row accounting-controls">
            <label className="field">
              <span className="sr-only">{t('admin.accounting.summary.month')}</span>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                aria-label={t('admin.accounting.summary.month')}
                dir="ltr"
              />
            </label>
            <Button size="sm" variant="gold" icon={<IconChart />} loading={busy === 'summary'} onClick={() => void loadSummary()}>
              {t('admin.accounting.summary.show')}
            </Button>
          </div>
        }
      >
        {summary === null ? (
          <EmptyState title={t('admin.accounting.summary.empty')} icon={<IconChart />} />
        ) : (
          <SummaryView summary={summary} locale={locale} />
        )}
      </Panel>

      <Panel
        title={t('admin.accounting.recon.title')}
        subtitle={t('admin.accounting.recon.subtitle')}
        tools={
          <Button size="sm" variant="gold" icon={<IconReceipt />} loading={busy === 'recon'} onClick={() => void loadRecon()}>
            {t('admin.accounting.recon.run')}
          </Button>
        }
        flush
      >
        {recon === null ? (
          <EmptyState title={t('admin.accounting.recon.empty')} icon={<IconReceipt />} />
        ) : (
          <ReconciliationView recon={recon} locale={locale} />
        )}
      </Panel>
    </>
  );
}

function SummaryView({ summary, locale }: { summary: AccountingSummary; locale: string }) {
  const { t } = useI18n();
  const held = summary.balancesHeld;
  return (
    <>
      <div className="metric-grid">
        <MetricCard
          label={t('admin.accounting.summary.revenue')}
          value={formatUsd(summary.revenue.totalMinor)}
          icon={<IconChart />}
          tone="green"
          footer={t('admin.accounting.summary.revenueNote')}
        />
        <MetricCard
          label={t('admin.accounting.summary.moneyIn')}
          value={formatUsd(summary.customerMoney.inMinor)}
          icon={<IconWallet />}
          tone="blue"
          footer={t('admin.accounting.summary.moneyOut', {
            out: formatUsd(summary.customerMoney.outMinor),
            reversed: formatUsd(summary.customerMoney.reversedMinor),
          })}
        />
        <MetricCard
          label={t('admin.accounting.summary.held')}
          value={formatUsd(held.customerTotalMinor)}
          icon={<IconWallet />}
          tone="violet"
          footer={t('admin.accounting.summary.heldNote', {
            date: formatDateTime(held.asOf, locale),
            owedTo: formatUsd(held.owedToCustomersMinor),
            owedBy: formatUsd(held.owedByCustomersMinor),
          })}
        />
      </div>

      <div className="dt-wrap">
        <table className="data-table">
          <caption className="sr-only">{t('admin.accounting.summary.revenueLines')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('admin.accounting.summary.revenueLines')}</th>
              <th scope="col" className="td-end">
                {t('admin.accounting.col.total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.revenue.lines.map((line) => (
              <tr key={line.key}>
                <td>{REVENUE_LABEL[line.key] ? t(REVENUE_LABEL[line.key]!) : line.key}</td>
                <td className="td-end num">{formatUsd(line.totalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {t('admin.accounting.summary.carrier', { amount: formatUsd(summary.revenue.carrierCostOnShippingChargesMinor) })}{' '}
        {t('admin.accounting.summary.platform', { amount: formatUsd(held.platformAccountMinor) })}
      </p>

      <div className="dt-wrap">
        <table className="data-table">
          <caption className="sr-only">{t('admin.accounting.summary.byType')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('admin.accounting.col.type')}</th>
              <th scope="col">{t('admin.accounting.col.direction')}</th>
              <th scope="col" className="td-end">
                {t('admin.accounting.col.count')}
              </th>
              <th scope="col" className="td-end">
                {t('admin.accounting.col.total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.byType.map((row) => (
              <tr key={`${row.type}:${row.direction}`}>
                <td>
                  <code dir="ltr">{row.type}</code>
                </td>
                <td>{row.direction}</td>
                <td className="td-end num">{row.count}</td>
                <td className="td-end num">{formatUsd(row.totalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ReconciliationView({ recon, locale }: { recon: Reconciliation; locale: string }) {
  const { t } = useI18n();
  const clean = recon.mismatches.length === 0;
  return (
    <div className="panel-body">
      <p>
        <StatusBadge tone={clean ? 'success' : 'error'}>
          {clean
            ? t('admin.accounting.recon.clean')
            : t('admin.accounting.recon.mismatchCount', { count: recon.mismatches.length })}
        </StatusBadge>{' '}
        {t('admin.accounting.recon.checked', {
          paymentsIn: recon.checked.topups,
          payouts: recon.checked.payouts,
          withdrawals: recon.checked.withdrawals,
          matched: recon.matched,
        })}
      </p>

      {recon.mismatches.length > 0 && (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('admin.accounting.col.problem')}</th>
                <th scope="col">{t('admin.accounting.col.account')}</th>
                <th scope="col" className="td-end">
                  {t('admin.accounting.col.expected')}
                </th>
                <th scope="col" className="td-end">
                  {t('admin.accounting.col.recorded')}
                </th>
                <th scope="col">{t('admin.accounting.col.when')}</th>
              </tr>
            </thead>
            <tbody>
              {recon.mismatches.map((m) => (
                <tr key={`${m.kind}:${m.paymentId ?? ''}:${m.ledgerId ?? ''}`} className="is-alert">
                  <td data-label={t('admin.accounting.col.problem')}>
                    <IconAlert /> <code dir="ltr">{m.kind}</code>
                    <span className="hint" lang="en" dir="ltr">
                      {' '}
                      {m.detail}
                    </span>
                  </td>
                  <td data-label={t('admin.accounting.col.account')}>
                    <span className="ltr-run">{m.username ?? '—'}</span>
                  </td>
                  <td data-label={t('admin.accounting.col.expected')} className="td-end num">
                    {m.expectedMinor === null ? '—' : formatUsd(m.expectedMinor)}
                  </td>
                  <td data-label={t('admin.accounting.col.recorded')} className="td-end num">
                    {m.recordedMinor === null ? '—' : formatUsd(m.recordedMinor)}
                  </td>
                  <td data-label={t('admin.accounting.col.when')}>
                    <span dir="ltr">{formatDateTime(m.at, locale)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recon.pending.length > 0 && (
        <>
          <h3>{t('admin.accounting.recon.pending', { count: recon.pending.length })}</h3>
          <ul>
            {recon.pending.map((p) => (
              <li key={p.paymentId}>
                <span className="ltr-run">{p.username ?? '—'}</span> · {formatUsd(p.amount)} ·{' '}
                <span lang="en" dir="ltr">
                  {p.detail}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="hint">
        <IconCheckCircle />{' '}
        {t('admin.accounting.recon.manual', {
          count: recon.manualCashIns.count,
          amount: formatUsd(recon.manualCashIns.totalMinor),
        })}
      </p>
    </div>
  );
}
