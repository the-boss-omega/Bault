import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { dollarsToCents, formatUsd } from '../../../shared/money';
import { Button, EmptyState, MoneyField, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { DrawerTag } from '../../../shared/ui/DrawerTag';
import { IconAlert, IconWallet } from '../../../shared/ui/icons';
import { isPayPalApproveUrl, leaveForPayPal, type PayPalReturn } from '../../../shared/paypalCheckout';

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
  /** `paypal`: paid on PayPal's page and captured on return. `direct` (or absent): settled in one call. */
  checkout?: 'paypal' | 'crypto' | 'direct' | null;
  instructions: BankInstructions | { handle: string } | null;
}

interface PayPalCheckoutStarted {
  paymentId: string;
  approveUrl: string | null;
  status: string;
  amountMinor: number;
}

interface PayPalCheckoutCaptured {
  paymentId: string;
  status: 'succeeded' | 'pending';
  amountMinor: number;
}

interface CryptoCheckoutStarted {
  paymentId: string;
  hostedUrl: string | null;
  status: string;
  amountMinor: number;
}

interface CryptoCheckoutState {
  paymentId: string;
  status: string;
  amountMinor: number;
  message: string;
}

export interface CryptoReturn {
  outcome: 'returned' | 'cancelled';
  paymentId: string;
}

const CRYPTO_PAYMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cryptoReturnFrom(outcome: string, paymentId: string): CryptoReturn | null {
  if ((outcome !== 'returned' && outcome !== 'cancelled') || !CRYPTO_PAYMENT_ID.test(paymentId)) return null;
  return { outcome, paymentId };
}

export function isCryptoHostedUrl(href: string, appOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol === 'https:' && url.hostname === 'commerce.coinbase.com' && url.port === '') return true;
  return url.origin === appOrigin;
}

export const CRYPTO_POLL_MS = 5_000;
const CRYPTO_POLL_ROUNDS = 120;

interface RouteCatalogue {
  limits: { minMinor: number; maxMinor: number };
  routes: FundingRoute[];
  referenceNote: string;
}

export function TopUpPanel({
  onError,
  onStatus,
  onChanged,
  paypalReturn = null,
  onPayPalReturnHandled,
  cryptoReturn = null,
  onCryptoReturnHandled,
}: {
  onError: (m: string | null) => void;
  onStatus: (m: string | null) => void;
  onChanged: () => void;
  /** The collector is back from PayPal's page for this payment. */
  paypalReturn?: PayPalReturn | null;
  onPayPalReturnHandled?: () => void;
  cryptoReturn?: CryptoReturn | null;
  onCryptoReturnHandled?: () => void;
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

  const finished = useRef<string | null>(null);
  useEffect(() => {
    if (!paypalReturn) return;
    const id = `${paypalReturn.outcome}:${paypalReturn.paymentId}`;
    if (finished.current === id) return;
    finished.current = id;
    const base = `/finance/checkout/paypal/${encodeURIComponent(paypalReturn.paymentId)}`;
    void (async () => {
      setBusy(true);
      try {
        if (paypalReturn.outcome === 'cancelled') {
          await api.post(`${base}/cancel`, {});
          onError(null);
          onStatus(t('money.paypalCancelled'));
          return;
        }
        onStatus(t('money.paypalCapturing'));
        const result = await api.post<PayPalCheckoutCaptured>(`${base}/capture`, {});
        onError(null);
        onStatus(
          result.status === 'succeeded' ? t('money.paid', { amount: formatUsd(result.amountMinor) }) : t('money.paypalPending'),
        );
        onChanged();
      } catch (e) {
        onStatus(null);
        onError((e as Error).message);
      } finally {
        setBusy(false);
        onPayPalReturnHandled?.();
      }
    })();
  }, [paypalReturn, onError, onStatus, onChanged, onPayPalReturnHandled, t]);

  const [watching, setWatching] = useState<string | null>(null);
  const cryptoFinished = useRef<string | null>(null);
  useEffect(() => {
    if (!cryptoReturn) return;
    const id = `${cryptoReturn.outcome}:${cryptoReturn.paymentId}`;
    if (cryptoFinished.current === id) return;
    cryptoFinished.current = id;
    void (async () => {
      try {
        if (cryptoReturn.outcome === 'cancelled') {
          await api.post(`/finance/checkout/crypto/${encodeURIComponent(cryptoReturn.paymentId)}/cancel`, {});
          onError(null);
          onStatus(t('money.cryptoCancelled'));
          return;
        }
        setWatching(cryptoReturn.paymentId);
      } catch (e) {
        onStatus(null);
        onError((e as Error).message);
      } finally {
        onCryptoReturnHandled?.();
      }
    })();
  }, [cryptoReturn, onError, onStatus, onCryptoReturnHandled, t]);

  useEffect(() => {
    if (!watching) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = async (round: number) => {
      try {
        const seen = await api.get<CryptoCheckoutState>(`/finance/checkout/crypto/${encodeURIComponent(watching)}`);
        if (stopped) return;
        if (seen.status === 'succeeded') {
          onError(null);
          onStatus(t('money.paid', { amount: formatUsd(seen.amountMinor) }));
          setWatching(null);
          onChanged();
          return;
        }
        if (seen.status !== 'pending') {
          onStatus(null);
          onError(seen.message);
          setWatching(null);
          return;
        }
        onError(null);
        if (round >= CRYPTO_POLL_ROUNDS) {
          onStatus(t('money.cryptoStillWaiting', { amount: formatUsd(seen.amountMinor) }));
          setWatching(null);
          return;
        }
        onStatus(t('money.cryptoWaiting', { amount: formatUsd(seen.amountMinor) }));
      } catch (e) {
        if (stopped) return;
        onError((e as Error).message);
      }
      timer = setTimeout(() => void look(round + 1), CRYPTO_POLL_MS);
    };
    void look(0);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [watching, onError, onStatus, onChanged, t]);

  const chosen = catalogue?.routes.find((r) => r.key === route);
  const viaPayPal = chosen?.checkout === 'paypal';
  const viaCrypto = chosen?.checkout === 'crypto';
  const payable = Boolean(chosen?.available && (chosen.instant || viaCrypto));
  const cents = dollarsToCents(amount);
  const withinLimits =
    catalogue !== null &&
    cents !== null &&
    cents >= catalogue.limits.minMinor &&
    cents <= catalogue.limits.maxMinor;

  function attemptKey(amountCents: number): string {
    const current = attempt.current;
    const key =
      current && current.route === route && current.cents === amountCents
        ? current.key
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    attempt.current = { key, route, cents: amountCents };
    return key;
  }

  async function payWithPayPal() {
    if (cents === null) return;
    const key = attemptKey(cents);
    setBusy(true);
    try {
      const started = await api.post<PayPalCheckoutStarted>('/finance/checkout/paypal', {
        amountMinor: cents,
        route,
        idempotencyKey: key,
      });
      if (!started.approveUrl) {
        attempt.current = null;
        if (started.status === 'succeeded') {
          onError(null);
          onStatus(t('money.paid', { amount: formatUsd(started.amountMinor) }));
          setAmount('');
          onChanged();
        } else {
          onStatus(null);
          onError(t('money.notTaken'));
        }
        return;
      }
      if (!isPayPalApproveUrl(started.approveUrl, window.location.origin)) {
        attempt.current = null;
        onStatus(null);
        onError(t('money.paypalNotSafe'));
        return;
      }
      leaveForPayPal(started.approveUrl);
    } catch (e) {
      const unknown = e instanceof ApiError && (e.kind === 'unreachable' || e.kind === 'server');
      if (!unknown) attempt.current = null;
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function payWithCrypto() {
    if (cents === null) return;
    const key = attemptKey(cents);
    setBusy(true);
    try {
      const started = await api.post<CryptoCheckoutStarted>('/finance/checkout/crypto', {
        amountMinor: cents,
        idempotencyKey: key,
      });
      if (!started.hostedUrl) {
        attempt.current = null;
        if (started.status === 'succeeded') {
          onError(null);
          onStatus(t('money.paid', { amount: formatUsd(started.amountMinor) }));
          setAmount('');
          onChanged();
        } else if (started.status === 'pending') {
          setWatching(started.paymentId);
        } else {
          onStatus(null);
          onError(t('money.notTaken'));
        }
        return;
      }
      if (!isCryptoHostedUrl(started.hostedUrl, window.location.origin)) {
        attempt.current = null;
        onStatus(null);
        onError(t('money.cryptoNotSafe'));
        return;
      }
      leaveForPayPal(started.hostedUrl);
    } catch (e) {
      const unknown = e instanceof ApiError && (e.kind === 'unreachable' || e.kind === 'server');
      if (!unknown) attempt.current = null;
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (cents === null) return;
    const key = attemptKey(cents);
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

  const instructionLines =
    chosen?.available && chosen.instructions
      ? 'handle' in chosen.instructions
        ? [{ label: t('money.paypalHandle'), value: <bdi dir="ltr">{chosen.instructions.handle}</bdi> }]
        : Object.entries(chosen.instructions)
            .filter(([, v]) => v !== null)
            .map(([k, v]) => ({ label: t(`money.bank.${k}` as MessageKey), value: <bdi dir="ltr">{v}</bdi> }))
      : [];

  return (
    <Panel title={t('money.topUp')} subtitle={t('money.topUpSubtitle')}>
      {catalogue === null ? (
        <p className="hint">{t('grp.loading')}</p>
      ) : (
        <div className="request-form">
          <div className="stack stack--tight request-form-fields">
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
                <StatusBadge tone={chosen.instant || viaCrypto ? 'success' : 'warning'} plain>
                  {chosen.instant ? t('money.instant') : viaCrypto ? t('money.automatic') : t('money.reviewed')}
                </StatusBadge>{' '}
                {t(`${viaPayPal ? 'money.routeDescPaypal' : 'money.routeDesc'}.${chosen.key}` as MessageKey)}
              </p>
            )}

            {chosen && payable ? (
              <MoneyField
                label={t('money.amount')}
                value={amount}
                onChange={setAmount}
                hint={t('money.limits', {
                  min: formatUsd(catalogue.limits.minMinor),
                  max: formatUsd(catalogue.limits.maxMinor),
                })}
              />
            ) : chosen?.available && chosen.instructions ? (
              <>
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

          {chosen && payable ? (
            <>
              <aside className="request-slip">
                <DrawerTag
                  kicker={t('money.topUp')}
                  amount={cents !== null && cents > 0 ? formatUsd(cents) : '—'}
                  lines={[{ label: t('money.how'), value: t(`money.route.${chosen.key}` as MessageKey) }]}
                  status={
                    <StatusBadge tone="success" plain>
                      {viaCrypto ? t('money.automatic') : t('money.instant')}
                    </StatusBadge>
                  }
                />
              </aside>
              <div className="stack stack--tight request-form-actions">
                <div className="row">
                  <Button
                    variant="primary"
                    icon={<IconWallet />}
                    disabled={busy || !withinLimits || (viaCrypto && watching !== null)}
                    onClick={() => void (viaCrypto ? payWithCrypto() : viaPayPal ? payWithPayPal() : pay())}
                  >
                    {viaCrypto ? t('money.continueToCrypto') : viaPayPal ? t('money.continueToPaypal') : t('money.payNow')}
                  </Button>
                  <span className="field-hint">
                    {viaCrypto ? t('money.cryptoHint') : viaPayPal ? t('money.paypalHint') : t('money.instantHint')}
                  </span>
                </div>
              </div>
            </>
          ) : (
            chosen?.available &&
            chosen.instructions && (
              <aside className="request-slip">
                <DrawerTag kicker={t('money.sendTo')} lines={instructionLines} />
              </aside>
            )
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

/** What the server says would land for the amount typed so far, asked for once the typing has paused. */
export function useCashOutQuote(amount: string): CashOutQuote | null {
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

  return quote;
}

/** The fee schedule, in a sentence. What the amount typed comes to is on the slip beside the form. */
export function CashOutQuotePanel({ quote }: { quote: CashOutQuote | null }) {
  const { t } = useI18n();
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
    </div>
  );
}
