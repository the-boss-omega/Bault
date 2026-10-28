import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { formatUsd, formatDate, isolateLtr } from '../../../shared/money';
import { Button, ErrorState, Panel, SkeletonBlock, SuccessNote } from '../../../shared/ui/primitives';
import {
  COMPARISON_ROWS,
  UNLIMITED,
  allowanceCell,
  tierAction,
  usedFraction,
  type TierAction,
  type ComparisonRow,
  type MembershipTier,
  type MyMembership,
  type TierCatalogue,
} from '../../../shared/membership';

/** The lines a tier card leads with; the schedule under the cards has them all. */
const HIGHLIGHT_ROWS = ['storedItems', 'intake', 'parcel_processing', 'postage'] as const;

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
      const res = await api.post<{
        tier: string;
        status: string;
        chargedMinor: number;
        scheduledTier?: string;
        effectiveFrom?: string;
      }>('/membership/subscribe', { tier: tier.key });
      setNotice(
        res.scheduledTier
          ? t('membership.scheduled', {
              tier: t(tierNameKey(res.scheduledTier)),
              date: formatDate(res.effectiveFrom ?? '', locale),
            })
          : res.chargedMinor > 0
            ? t('membership.joined', { tier: t(tierNameKey(res.tier)), amount: formatUsd(res.chargedMinor) })
            : t('membership.kept', { tier: t(tierNameKey(res.tier)) }),
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

  const tierOrder = catalogue?.tiers.map((x) => x.key) ?? [];

  function confirmSentence(action: TierAction, tier: MembershipTier): string {
    const days = catalogue?.cycleDays ?? 30;
    switch (action.kind) {
      case 'join':
        return t('membership.confirm', { amount: formatUsd(action.chargeMinor), days });
      case 'upgrade':
        return t('membership.confirmUpgrade', {
          amount: formatUsd(action.chargeMinor),
          price: formatUsd(tier.priceMinor),
          credit: formatUsd(action.creditMinor),
          days,
        });
      case 'downgrade':
        return t('membership.confirmDowngrade', {
          tier: t(tierNameKey(tier.key)),
          date: formatDate(action.effectiveFrom, locale),
          price: formatUsd(tier.priceMinor),
        });
      case 'keep':
        return t('membership.confirmKeep', { tier: t(tierNameKey(tier.key)) });
    }
  }

  if (loading) return <SkeletonBlock />;

  return (
    <>
      {error && <ErrorState message={error} onRetry={() => void load()} retryLabel={t('ui.retry')} />}
      {notice && <SuccessNote>{notice}</SuccessNote>}

      {mine && catalogue && (
        <Panel
          title={t('membership.current.title', { tier: t(tierNameKey(mine.tier)) })}
          subtitle={
            mine.status === 'cancelling'
              ? t('membership.current.ending', { date: formatDate(mine.currentPeriodEnd, locale) })
              : mine.scheduledTier
                ? t('membership.current.switching', {
                    tier: t(tierNameKey(mine.scheduledTier)),
                    date: formatDate(mine.currentPeriodEnd, locale),
                  })
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
              <Button loading={busy === 'cancel'} onClick={() => void cancel()}>
                {t('membership.cancel')}
              </Button>
            </div>
          )}
        </Panel>
      )}

      <Panel title={t('membership.tiers.title')} subtitle={t('membership.tiers.subtitle')}>
        <div className="mem-offers">
          {catalogue?.tiers.map((tier) => {
            const action = tierAction(mine, tier, tierOrder);
            const isCurrent =
              action.kind === 'keep' && mine?.status === 'active' && !mine.scheduledTier;
            return (
              <div className="offer" key={tier.key} data-current={isCurrent ? 'true' : undefined}>
                <div className="offer-what">
                  <span className="offer-name">{t(tierNameKey(tier.key))}</span>
                  <span className="offer-price">
                    {t('membership.perMonth', { amount: isolateLtr(formatUsd(tier.priceMinor)) })}
                  </span>
                  <span className="offer-note">
                    {confirming === tier.key ? confirmSentence(action, tier) : t(tierForKey(tier.key))}
                  </span>
                </div>

                <dl className="offer-facts">
                  {HIGHLIGHT_ROWS.map((row) => {
                    const cell = allowanceCell(tier, row);
                    if (cell === null) return null;
                    return (
                      <div key={row}>
                        <dt>{t(rowLabelKey(row))}</dt>
                        <dd>{cell}</dd>
                      </div>
                    );
                  })}
                </dl>

                <div className="offer-actions">
                  {isCurrent ? (
                    <span className="pill pill--success">{t('membership.yourTier')}</span>
                  ) : confirming === tier.key ? (
                    <>
                      <Button
                        variant="primary"
                        loading={busy === tier.key}
                        onClick={() => void subscribe(tier)}
                      >
                        {t('membership.confirmYes')}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        {t('ui.cancel')}
                      </Button>
                    </>
                  ) : (
                    <Button variant="primary" onClick={() => setConfirming(tier.key)}>
                      {action.kind === 'join'
                        ? t('membership.join')
                        : action.kind === 'keep'
                          ? t('membership.keep')
                          : t('membership.switchTo')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {catalogue && (
          <div className="dt-wrap dt-wrap--stack">
            <table className="data-table mem-table">
              <thead>
                <tr>
                  <th scope="col">{t('membership.col.included')}</th>
                  {catalogue.tiers.map((tier) => (
                    <th scope="col" key={tier.key} className="num">
                      <span className="mem-tier-name">{t(tierNameKey(tier.key))}</span>
                      <span className="mem-tier-price">
                        {t('membership.perMonth', { amount: isolateLtr(formatUsd(tier.priceMinor)) })}
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
                        <td key={tier.key} className="num" data-label={t(tierNameKey(tier.key))}>
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
                    <td key={tier.key} data-label={t(tierNameKey(tier.key))}>
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

      </Panel>

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

function tierNameKey(key: string): MessageKey {
  return `membership.tier.${key}` as MessageKey;
}
function tierForKey(key: string): MessageKey {
  return `membership.tierFor.${key}` as MessageKey;
}
function rowLabelKey(row: string): MessageKey {
  return `membership.row.${row.replace('service_fee:', '').replace('shipping_addon:', '')}` as MessageKey;
}
function perkKey(perk: string): MessageKey {
  return `membership.perk.${perk}` as MessageKey;
}
function uncoveredKey(key: string): MessageKey {
  return `membership.uncovered.${key}` as MessageKey;
}
