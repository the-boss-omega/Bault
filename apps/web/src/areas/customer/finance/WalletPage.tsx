import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { formatUsd } from '../../../shared/money';
import { useT } from '../../../shared/i18n';

interface Money {
  amount: number;
  currency: string;
}
interface LedgerRow {
  id: string;
  type: string;
  amount: number;
  direction: string;
  occurredAt: string;
}

/**
 * Customer wallet (T072). Shows the DERIVED balance (Σ ledger), lets the user top
 * up, and lists every immutable ledger row — the full, auditable money history.
 */
export function WalletPage() {
  const t = useT();
  const [balance, setBalance] = useState<Money | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [topupAmount, setTopupAmount] = useState(10000);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setBalance(await api.get<Money>('/finance/wallet'));
      setLedger(await api.get<LedgerRow[]>('/finance/ledger'));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function topup() {
    try {
      await api.post('/finance/wallet/topups', { amountMinor: topupAmount });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Load once on mount; every mutation calls load() explicitly.
  useEffect(() => {
    void load();
  }, []);

  return (
    <section>
      <h2>{t('wallet.title')}</h2>
      {balance && (
        <div className="hero">
          <p className="hero-label">{t('wallet.currentBalance')}</p>
          <p className="hero-value" dir="ltr">
            {formatUsd(balance.amount)}
          </p>
        </div>
      )}
      <div className="field-row">
        <input
          type="number"
          value={topupAmount}
          onChange={(e) => setTopupAmount(Number(e.target.value))}
          dir="ltr"
        />
        <button className="btn btn--primary" onClick={topup}>{t('wallet.topup')}</button>
      </div>
      {error && <p role="alert">{error}</p>}
      <h3>{t('wallet.transactions')}</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('wallet.col.date')}</th>
              <th>{t('wallet.col.type')}</th>
              <th>{t('wallet.col.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((r) => (
              <tr key={r.id}>
                <td dir="ltr">{r.occurredAt.slice(0, 10)}</td>
                <td>{r.type}</td>
                <td dir="ltr" className={r.direction === 'credit' ? 'row-credit' : 'row-debit'}>
                  {r.direction === 'credit' ? '+' : '−'}
                  {formatUsd(r.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
