import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { formatDateTime, formatUsd } from '../../../shared/money';
import {
  EmptyState,
  ErrorState,
  Panel,
  SkeletonTable,
  StatusBadge,
  type StatusTone,
} from '../../../shared/ui/primitives';
import { IconReceipt } from '../../../shared/ui/icons';

/** One row of `GET /finance/payments` — a card or PayPal top-up, as the provider settled it. */
interface CardPayment {
  id: string;
  provider: string;
  providerRef: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: string;
}

const PAYMENT_TONE: Record<string, StatusTone> = {
  succeeded: 'success',
  pending: 'warning',
  failed: 'error',
  refunded: 'neutral',
};

const PAYMENT_STATUS: Record<string, MessageKey> = {
  succeeded: 'payments.status.succeeded',
  pending: 'payments.status.pending',
  failed: 'payments.status.failed',
  refunded: 'payments.status.refunded',
};

/**
 * Card payments into the wallet, as the provider settled them.
 *
 * The wallet's own ledger shows the money arriving; this is the other half of
 * the same event — which provider took it, under what reference, and whether it
 * succeeded — and it is what a collector needs when a payment is missing from
 * the balance or their bank statement shows something they cannot place. The
 * route has always existed and nothing rendered it.
 *
 * A failed attempt is shown rather than hidden: "it did not go through" is the
 * answer to the question somebody is actually asking.
 */
export function CardPaymentsPanel() {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<CardPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.get<CardPayment[]>('/finance/payments');
      // Newest first: the one somebody is asking about is the one they just made.
      setRows([...list].reverse());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Panel title={t('payments.title')} subtitle={t('payments.subtitle')} flush>
      {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}

      {rows === null ? (
        <SkeletonTable rows={3} columns={4} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('payments.empty')} text={t('payments.emptyText')} icon={<IconReceipt />} />
      ) : (
        <div className="dt-wrap dt-wrap--stack">
          <table className="data-table">
            <caption>{t('payments.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('payments.col.when')}</th>
                <th scope="col">{t('payments.col.provider')}</th>
                <th scope="col">{t('payments.col.status')}</th>
                <th scope="col" className="td-end">
                  {t('payments.col.amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td data-label={t('payments.col.when')} className="dt-primary">
                    <span dir="ltr">{formatDateTime(p.createdAt, locale)}</span>
                  </td>
                  <td data-label={t('payments.col.provider')}>
                    {p.provider}
                    {/* The provider's own reference — what to quote when asking
                        them about a payment that did not arrive. */}
                    <span className="dt-sub nowrap" dir="ltr">
                      {p.providerRef}
                    </span>
                  </td>
                  <td data-label={t('payments.col.status')}>
                    <StatusBadge tone={PAYMENT_TONE[p.status] ?? 'neutral'}>
                      {PAYMENT_STATUS[p.status] ? t(PAYMENT_STATUS[p.status]!) : p.status}
                    </StatusBadge>
                  </td>
                  <td data-label={t('payments.col.amount')} className="td-end num" dir="ltr">
                    {formatUsd(p.amount)}
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
