import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { formatUsd, formatDate } from '../../../shared/money';
import { Button, ErrorState, Panel, SkeletonBlock, SuccessNote } from '../../../shared/ui/primitives';
import {
  COMPARISON_ROWS,
  UNLIMITED,
  allowanceCell,
  usedFraction,
  type ComparisonRow,
  type MembershipTier,
  type MyMembership,
  type TierCatalogue,
} from '../../../shared/membership';

/**
 * Membership: what the tiers cover, what you are on, and what is left.
 *
 * The screen is one argument, made in the order somebody actually asks it:
 *
 *   1. WHAT AM I ON, and how much of it is left this cycle — only when there is
 *      an answer. A non-member is not shown an empty version of this.
 *   2. WHAT ARE THE TIERS, as one comparison table rather than three cards side
 *      by side. `DESIGN.md` rejects the identical-rounded-cards pattern, and a
 *      pricing page is the single place it is most tempting: three tiles, one
 *      scaled up with a "most popular" ribbon. A register with a column per tier
 *      is also simply easier to read, because the thing anybody wants to do is
 *      compare one row across the columns, and that is a row.
 *   3. WHAT IS NOT INCLUDED, published on the same screen and not in terms.
 *
 * THE CONFIRMATION IS THE FEATURE. Subscribing is a recurring charge, which is
 * the most consequential kind of button in the product — so the price, the
 * cycle, and the sentence about what happens when an allowance runs out are all
 * on the control, and the control confirms before it charges. `.offer` exists
 * precisely so a price and its button cannot be rendered apart.
 */
export function MembershipPage() {
  const { t, locale } = useI18n();
  const [catalogue, setCatalogue] = useState<TierCatalogue | null>(null);
  const [mine, setMine] = useState<MyMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cat, me] = await Promise.all([
        api.get<TierCatalogue>('/membership/tiers'),
        api.get<{ membership: MyMembership | null }>('/membership/me'),
      ]);
      setCatalogue(cat);
      setMine(me.membership);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function subscribe(tier: MembershipTier) {
    setBusy(tier.key);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ tier: string; status: string; chargedMinor: number }>(
        '/membership/subscribe',
        { tier: tier.key },
      );
      setNotice(
        res.chargedMinor > 0
          ? t('membership.joined', { tier: t(tierNameKey(res.tier)), amount: formatUsd(res.chargedMinor) })
          : t('membership.scheduled', { tier: t(tierNameKey(tier.key)) }),
      );
      setConfirming(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy('cancel');
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ endsAt: string }>('/membership/cancel', {});
      setNotice(t('membership.cancelled', { date: formatDate(res.endsAt, locale) }));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <SkeletonBlock />;

  return (
    <>
      {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}
      {notice && <SuccessNote>{notice}</SuccessNote>}

      {/* ---- What I am on, and what is left ---- */}
      {mine && catalogue && (
        <Panel
          title={t('membership.current.title', { tier: t(tierNameKey(mine.tier)) })}
          subtitle={
            mine.status === 'cancelling'
              ? t('membership.current.ending', { date: formatDate(mine.currentPeriodEnd, locale) })
              : t('membership.current.renews', { date: formatDate(mine.currentPeriodEnd, locale) })
          }
        >
          <dl className="mem-allowances">
            {Object.entries(mine.perCycle).map(([action, counts]) => (
              <div key={action} className="mem-allowance">
                <dt>{t(rowLabelKey(action as ComparisonRow))}</dt>
                <dd>
                  {counts.allowed === UNLIMITED ? (
                    <span className="mem-unlimited">{t('membership.unlimited')}</span>
                  ) : (
                    <>
                      <span className="amount">
                        {t('membership.leftOf', { left: counts.remaining, total: counts.allowed })}
                      </span>
                      {/* The same proportion bar the Break-Even Watch uses. It
                          goes amber before it says anything, which is the point:
                          running out is not an error, it is a thing to know
                          about before you plan around it. */}
                      <span
                        className={usedFraction(counts) >= 1 ? 'proportion proportion--over' : 'proportion'}
                        role="img"
                        aria-label={t('membership.leftOf', { left: counts.remaining, total: counts.allowed })}
                      >
                        <span style={{ inlineSize: `${Math.round(usedFraction(counts) * 100)}%` }} />
                      </span>
                    </>
                  )}
                </dd>
              </div>
            ))}
            <div className="mem-allowance">
              <dt>{t('membership.row.storedItems')}</dt>
              <dd>
                <span className="amount">{mine.storedItems.toLocaleString()}</span>
              </dd>
            </div>
            <div className="mem-allowance">
              <dt>{t('membership.row.postage')}</dt>
              <dd>
                <span className="amount">
                  {formatUsd(Math.max(0, mine.postage.creditMinor - mine.postage.usedMinor))}
                </span>
              </dd>
            </div>
          </dl>

          <p className="hint">{t('membership.runsOut')}</p>

          {mine.status === 'active' && (
            <div className="actions">
              <Button variant="ghost" loading={busy === 'cancel'} onClick={() => void cancel()}>
                {t('membership.cancel')}
              </Button>
            </div>
          )}
        </Panel>
      )}

      {/* ---- The tiers, as one table ---- */}
      <Panel title={t('membership.tiers.title')} subtitle={t('membership.tiers.subtitle')}>
        {catalogue && (
          <div className="dt-wrap">
            <table className="data-table mem-table">
              <thead>
                <tr>
                  <th scope="col">{t('membership.col.included')}</th>
                  {catalogue.tiers.map((tier) => (
                    <th scope="col" key={tier.key} className="num">
                      <span className="mem-tier-name">{t(tierNameKey(tier.key))}</span>
                      <span className="mem-tier-price amount">
                        {t('membership.perMonth', { amount: formatUsd(tier.priceMinor) })}
                      </span>
                      <span className="mem-tier-for">{t(tierForKey(tier.key))}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row}>
                    <th scope="row">{t(rowLabelKey(row))}</th>
                    {catalogue.tiers.map((tier) => {
                      const cell = allowanceCell(tier, row);
                      return (
                        <td key={tier.key} className="num">
                          {cell === null ? (
                            <span className="mem-not-included" aria-label={t('membership.notIncluded')}>
                              —
                            </span>
                          ) : (
                            <span className="amount">{cell}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <th scope="row">{t('membership.row.perks')}</th>
                  {catalogue.tiers.map((tier) => (
                    <td key={tier.key}>
                      <ul className="mem-perks">
                        {tier.perks.map((p) => (
                          <li key={p}>{t(perkKey(p))}</li>
                        ))}
                      </ul>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/*
          The buy controls, one per tier, each an `.offer`: the price is part of
          the component, so it is not possible to render the button without it.
        */}
        <div className="mem-offers">
          {catalogue?.tiers.map((tier) => {
            const isCurrent = mine?.tier === tier.key && mine.status === 'active';
            return (
              <div className="offer" key={tier.key}>
                <div className="offer-what">
                  <span className="offer-name">{t(tierNameKey(tier.key))}</span>
                  <span className="offer-note">
                    {confirming === tier.key
                      ? t('membership.confirm', {
                          amount: formatUsd(tier.priceMinor),
                          days: catalogue.cycleDays,
                        })
                      : t(tierForKey(tier.key))}
                  </span>
                </div>

                {/* The price and the control are ONE component. It is not
                    possible to render the button without the figure beside it,
                    which is the rule for every paid action in this product and
                    matters most on the one that recurs. */}
                <div className="offer-price">
                  <span className="amount">
                    {t('membership.perMonth', { amount: formatUsd(tier.priceMinor) })}
                  </span>
                  {isCurrent ? (
                    <span className="pill pill--success">{t('membership.yourTier')}</span>
                  ) : confirming === tier.key ? (
                    <>
                      <Button variant="gold" loading={busy === tier.key} onClick={() => void subscribe(tier)}>
                        {t('membership.confirmYes')}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        {t('ui.cancel')}
                      </Button>
                    </>
                  ) : (
                    <Button variant="gold" onClick={() => setConfirming(tier.key)}>
                      {mine ? t('membership.switchTo') : t('membership.join')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      {/* ---- What no tier covers ---- */}
      <Panel title={t('membership.uncovered.title')} subtitle={t('membership.uncovered.subtitle')}>
        <ul className="mem-uncovered">
          {catalogue?.uncovered.map((key) => (
            <li key={key}>{t(uncoveredKey(key))}</li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

/* ------------------------------------------------------------------
   Catalogue keys → message keys.

   The API answers with stable identifiers and the catalogue holds the words, so
   a tier's name is translated rather than shipped from the server in English —
   the same split the landing page makes for prices.
   ------------------------------------------------------------------ */

function tierNameKey(key: string): MessageKey {
  return `membership.tier.${key}` as MessageKey;
}
function tierForKey(key: string): MessageKey {
  return `membership.tierFor.${key}` as MessageKey;
}
function rowLabelKey(row: string): MessageKey {
  return `membership.row.${row.replace('service_fee:', '')}` as MessageKey;
}
function perkKey(perk: string): MessageKey {
  return `membership.perk.${perk}` as MessageKey;
}
function uncoveredKey(key: string): MessageKey {
  return `membership.uncovered.${key}` as MessageKey;
}
