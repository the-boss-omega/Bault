import type { TranslateFn } from '../../../shared/i18n';
import { formatUsd } from '../../../shared/money';
import { CountUp } from '../../../shared/ui/CountUp';

export interface StatementFlows {
  inflow: number;
  outflow: number;
  count: number;
}

/**
 * The wallet's balance, as the record it is: a printed statement. The balance is
 * the lead figure; under it, on the overview, the identity the ledger keeps
 * (everything credited, less everything debited, is the balance) is laid out as
 * the sum it is. The stub on the end is the perforated edge of a slip.
 *
 * Every figure is the one the old hero and the four statistics showed, under the
 * same names; nothing here is computed for decoration.
 */
export function StatementSlip({
  amount,
  flows,
  expanded,
  t,
}: {
  amount: number;
  flows: StatementFlows;
  /** The overview shows the sum; the other tabs keep the slip short. */
  expanded: boolean;
  t: TranslateFn;
}) {
  return (
    <section className="statement" aria-labelledby="statement-balance-label">
      <div className="statement-sheet">
        <div className="statement-body">
          <header className="statement-head">
            <span>{t('wallet.currencyName')}</span>
            <span>{t('wallet.derivedNote')}</span>
          </header>

          <p className="statement-label" id="statement-balance-label">
            {t('wallet.currentBalance')}
          </p>
          <p className="statement-balance">
            <span dir="ltr">
              <CountUp value={formatUsd(amount)} />
            </span>
          </p>

          {/* The figures are isolated left to right inside a cell that reads the page's way, so they hang from the same edge as their names. */}
          {expanded && (
            <dl className="statement-sum">
              <div className="statement-term">
                <dt>{t('wallet.inflow')}</dt>
                <dd>
                  <bdi dir="ltr">{formatUsd(flows.inflow)}</bdi>
                </dd>
                <dd className="statement-note">{t('wallet.inflowNote')}</dd>
              </div>
              <div className="statement-term statement-term--minus">
                <dt>{t('wallet.outflow')}</dt>
                <dd>
                  <bdi dir="ltr">{formatUsd(flows.outflow)}</bdi>
                </dd>
                <dd className="statement-note">{t('wallet.outflowNote')}</dd>
              </div>
              <div className="statement-term statement-term--equals">
                <dt>{t('wallet.netFlow')}</dt>
                <dd>
                  <bdi dir="ltr">{formatUsd(flows.inflow - flows.outflow)}</bdi>
                </dd>
                <dd className="statement-note">{t('wallet.netFlowNote')}</dd>
              </div>
              <div className="statement-term statement-term--count">
                <dt>{t('wallet.txCount')}</dt>
                <dd>{flows.count}</dd>
                <dd className="statement-note">{t('wallet.txCountNote')}</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="statement-stub" aria-hidden="true">
          <span className="statement-bars" />
          <span className="statement-wordmark" />
        </div>
      </div>
    </section>
  );
}

/** Money that has been asked for and has not moved: two small slips, not statistics. */
export function InTransit({
  cashIn,
  cashOut,
  t,
}: {
  cashIn: number;
  cashOut: number;
  t: TranslateFn;
}) {
  return (
    <section className="transit" aria-label={t('wallet.pendingNote')}>
      <div className="transit-slip">
        <span className="transit-label">{t('wallet.pendingIn')}</span>
        <span className="transit-amount" dir="ltr">
          {formatUsd(cashIn)}
        </span>
      </div>
      <div className="transit-slip">
        <span className="transit-label">{t('wallet.pendingOut')}</span>
        <span className="transit-amount" dir="ltr">
          {formatUsd(cashOut)}
        </span>
      </div>
      <p className="transit-note">{t('wallet.pendingNote')}</p>
    </section>
  );
}
