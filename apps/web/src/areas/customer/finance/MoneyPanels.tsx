import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { dollarsToCents, formatUsd } from '../../../shared/money';
import { Button, EmptyState, MoneyField, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { IconAlert, IconReceipt, IconWallet } from '../../../shared/ui/icons';

interface BankInstructions {
  accountName: string | null;
  accountNumber: string | null;
  routingNumber: string | null;
  iban: string | null;
  swift: string | null;
  address: string | null;
}

interface FundingRoute {
  key: string;
  label: string;
  instant: boolean;
  feeBps: number;
  description: string;
  available: boolean;
  instructions: BankInstructions | { handle: string } | null;
}

interface RouteCatalogue {
  limits: { minMinor: number; maxMinor: number };
  routes: FundingRoute[];
  referenceNote: string;
}

export function TopUpPanel({
  onError,
  onStatus,
  onChanged,
}: {
  onError: (m: string | null) => void;
  onStatus: (m: string | null) => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [catalogue, setCatalogue] = useState<RouteCatalogue | null>(null);
  const [route, setRoute] = useState('card');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ key: string; route: string; cents: number } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await api.get<RouteCatalogue>('/finance/funding-routes');
        setCatalogue(loaded);
        setRoute((current) =>
          loaded.routes.some((r) => r.key === current && r.available)
            ? current
            : (loaded.routes.find((r) => r.available)?.key ?? current),
        );
      } catch (e) {
        onError((e as Error).message);
      }
    })();
  }, [onError]);

  const chosen = catalogue?.routes.find((r) => r.key === route);
  const cents = dollarsToCents(amount);
  const withinLimits =
    catalogue !== null &&
    cents !== null &&
    cents >= catalogue.limits.minMinor &&
    cents <= catalogue.limits.maxMinor;

  async function pay() {
    if (cents === null) return;
    const current = attempt.current;
    const key =
      current && current.route === route && current.cents === cents
        ? current.key
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    attempt.current = { key, route, cents };
    setBusy(true);
    try {
      const result = await api.post<{ status: string; amountMinor: number; replayed: boolean }>(
        '/finance/checkout',
        { amountMinor: cents, route, idempotencyKey: key },
      );
      attempt.current = null;
      if (result.status === 'failed' || result.status === 'refused') {
        onStatus(null);
        onError(t('money.notTaken'));
        return;
      }
      onStatus(
        result.status === 'succeeded'
          ? t('money.paid', { amount: formatUsd(result.amountMinor) })
          : t('money.pending', { amount: formatUsd(result.amountMinor) }),
      );
      onError(null);
      setAmount('');
      onChanged();
    } catch (e) {
      const unknown = e instanceof ApiError && (e.kind === 'unreachable' || e.kind === 'server');
      if (!unknown) attempt.current = null;
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('money.topUp')} subtitle={t('money.topUpSubtitle')}>
      {catalogue === null ? (
        <p className="hint">{t('grp.loading')}</p>
      ) : (
        <div className="stack stack--tight" style={{ maxWidth: 620 }}>
          <label className="field">
            <span className="field-label">{t('money.how')}</span>
            <select value={route} onChange={(e) => setRoute(e.target.value)}>
              {catalogue.routes.map((r) => (
                <option key={r.key} value={r.key} disabled={!r.available}>
                  {t(`money.route.${r.key}` as MessageKey)}
                  {r.available ? '' : ` — ${t('money.notAvailable')}`}
                </option>
              ))}
            </select>
          </label>

          {chosen && (
            <p className="field-hint">
              <StatusBadge tone={chosen.instant ? 'success' : 'warning'} plain>
                {chosen.instant ? t('money.instant') : t('money.reviewed')}
              </StatusBadge>{' '}
              {t(`money.routeDesc.${chosen.key}` as MessageKey)}
            </p>
          )}

          {chosen?.instant && chosen.available ? (
            <>
              <MoneyField
                label={t('money.amount')}
                value={amount}
                onChange={setAmount}
                hint={t('money.limits', {
                  min: formatUsd(catalogue.limits.minMinor),
                  max: formatUsd(catalogue.limits.maxMinor),
                })}
              />
              <div className="row">
                <Button variant="gold" icon={<IconWallet />} disabled={busy || !withinLimits} onClick={() => void pay()}>
                  {t('money.payNow')}
                </Button>
                <span className="field-hint">{t('money.instantHint')}</span>
              </div>
            </>
          ) : chosen?.available && chosen.instructions ? (
            <>
              <h3 className="drawer-heading">{t('money.sendTo')}</h3>
              <dl className="detail-list">
                {'handle' in chosen.instructions ? (
                  <div className="detail-row">
                    <dt className="detail-label">{t('money.paypalHandle')}</dt>
                    <dd className="detail-value" dir="ltr">
                      {chosen.instructions.handle}
                    </dd>
                  </div>
                ) : (
                  Object.entries(chosen.instructions)
                    .filter(([, v]) => v !== null)
                    .map(([k, v]) => (
                      <div className="detail-row" key={k}>
                        <dt className="detail-label">{t(`money.bank.${k}` as MessageKey)}</dt>
                        <dd className="detail-value" dir="ltr">
                          {v}
                        </dd>
                      </div>
                    ))
                )}
              </dl>
              <p className="drawer-note drawer-note--hold">
                <IconAlert />
                <span>{t('money.referenceNote')}</span>
              </p>
              <p className="field-hint">{t('money.thenRaise')}</p>
            </>
          ) : (
            <EmptyState title={t('money.routeUnavailable')} text={t('money.routeUnavailableText')} icon={<IconAlert />} />
          )}
        </div>
      )}
    </Panel>
  );
}

interface CashOutQuote {
  amountMinor: number;
  feeMinor: number;
  netMinor: number;
  schedule: {
    bandMinor: number;
    smallBps: number;
    smallMinimumMinor: number;
    largeFixedMinor: number;
    largeBps: number;
  };
}

export function CashOutQuotePanel({ amount }: { amount: string }) {
  const { t } = useI18n();
  const [quote, setQuote] = useState<CashOutQuote | null>(null);
  const cents = dollarsToCents(amount);

  useEffect(() => {
    if (cents === null || cents <= 0) {
      setQuote(null);
      return;
    }
    const handle = setTimeout(() => {
      void api
        .get<CashOutQuote>(`/finance/cash-out-quote?amountMinor=${cents}`)
        .then(setQuote)
        .catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(handle);
  }, [cents]);

  return (
    <div className="stack stack--tight">
      <p className="field-hint">
        {quote
          ? t('money.feeSchedule', {
              band: formatUsd(quote.schedule.bandMinor),
              smallPct: (quote.schedule.smallBps / 100).toFixed(0),
              smallMin: formatUsd(quote.schedule.smallMinimumMinor),
              fixed: formatUsd(quote.schedule.largeFixedMinor),
              largePct: (quote.schedule.largeBps / 100).toFixed(0),
            })
          : t('money.feeScheduleShort')}
      </p>
      {quote && quote.amountMinor > 0 && (
        <p className="drawer-note drawer-note--archive">
          <IconReceipt />
          <span>
            {t('money.youReceive', {
              gross: formatUsd(quote.amountMinor),
              fee: formatUsd(quote.feeMinor),
              net: formatUsd(quote.netMinor),
            })}
          </span>
        </p>
      )}
    </div>
  );
}
