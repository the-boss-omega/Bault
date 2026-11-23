import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { formatDate, formatUsd } from '../../../shared/money';
import { ErrorState, Panel, SkeletonBlock } from '../../../shared/ui/primitives';
import { UNLIMITED, percentOff, type HonouredAllowances, type TierStanding } from '../../../shared/tiers';

export function TierPage() {
  const { t } = useI18n();
  const [standing, setStanding] = useState<TierStanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStanding(await api.get<TierStanding>('/tiers/me'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <SkeletonBlock />;
  if (error || !standing) {
    return (
      <ErrorState
        title={t('tier.loadFailed')}
        message={error ?? t('tier.loadFailedText')}
        onRetry={() => void load()}
        retryLabel={t('ui.retry')}
      />
    );
  }

  const days = standing.window.days;
  const name = (key: string) => t(`tier.name.${key}` as MessageKey);
  const top = standing.rules[standing.rules.length - 1];

  return (
    <>
      <Panel
        title={t('tier.current.title', { tier: name(standing.tier) })}
        subtitle={t('tier.current.subtitle', { days })}
      >
        <p className="hint">
          {standing.discountBps > 0
            ? t('tier.current.discount', { percent: percentOff(standing.discountBps) })
            : t('tier.current.noDiscount')}
        </p>
        <dl className="mem-allowances tier-window">
          <div className="mem-allowance">
            <dt>{t('tier.window.actions', { days })}</dt>
            <dd>
              <span className="amount">{standing.window.actions.toLocaleString()}</span>
            </dd>
          </div>
          <div className="mem-allowance">
            <dt>{t('tier.window.spent', { days })}</dt>
            <dd>
              <span className="amount" dir="ltr">
                {formatUsd(standing.window.spentMinor)}
              </span>
            </dd>
          </div>
        </dl>
        {standing.next ? (
          <section className="tier-next" aria-label={t('tier.next.title', { tier: name(standing.next.tier) })}>
            <h3 className="drawer-heading">{t('tier.next.title', { tier: name(standing.next.tier) })}</h3>
            <p>
              {t('tier.next.text', {
                actions: standing.next.actionsToGo,
                amount: formatUsd(standing.next.spentToGoMinor),
                days,
              })}
            </p>
          </section>
        ) : (
          top && (
            <p className="hint">
              {t('tier.next.top', { days, actions: top.minActions, amount: formatUsd(top.minSpentMinor) })}
            </p>
          )
        )}
      </Panel>

      <Panel title={t('tier.table.title')} subtitle={t('tier.table.subtitle')}>
        <div className="dt-wrap">
          <table className="data-table tier-table">
            <thead>
              <tr>
                <th scope="col">{t('tier.col.tier')}</th>
                <th scope="col">{t('tier.col.reach')}</th>
                <th scope="col" className="num">
                  {t('tier.col.discount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {standing.rules.map((rule) => (
                <tr key={rule.key} data-current={rule.key === standing.tier ? 'true' : undefined}>
                  <th scope="row">
                    {name(rule.key)}
                    {rule.key === standing.tier && <span className="pill pill--success">{t('tier.yours')}</span>}
                  </th>
                  <td>
                    {rule.minActions === 0 && rule.minSpentMinor === 0
                      ? t('tier.reach.everyone')
                      : t('tier.reach.rule', {
                          actions: rule.minActions,
                          amount: formatUsd(rule.minSpentMinor),
                          days,
                        })}
                  </td>
                  <td className="num">
                    {rule.discountBps > 0
                      ? t('tier.discount.off', { percent: percentOff(rule.discountBps) })
                      : t('tier.discount.none')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field-hint stack-top">
          <a href="#/faq/prices">{t('tier.links.prices')}</a>
          {' · '}
          <a href="#/faq/faq?q=tiers">{t('tier.links.faq')}</a>
        </p>
      </Panel>

      {standing.honoured && <Honoured honoured={standing.honoured} />}
    </>
  );
}

function Honoured({ honoured }: { honoured: HonouredAllowances }) {
  const { t, locale } = useI18n();
  return (
    <Panel
      title={t('tier.honoured.title', { date: formatDate(honoured.honouredUntil, locale) })}
      subtitle={t('tier.honoured.subtitle')}
    >
      <dl className="mem-allowances">
        {Object.entries(honoured.perCycle).map(([action, counts]) => (
          <div key={action} className="mem-allowance">
            <dt>{t(allowanceKey(action))}</dt>
            <dd>
              {counts.allowed === UNLIMITED ? (
                <span className="mem-unlimited">{t('tier.unlimited')}</span>
              ) : (
                <span className="amount">{t('tier.leftOf', { left: counts.remaining, total: counts.allowed })}</span>
              )}
            </dd>
          </div>
        ))}
        <div className="mem-allowance">
          <dt>{t('tier.allowance.storedItems')}</dt>
          <dd>
            <span className="amount">{honoured.storedItems.toLocaleString()}</span>
          </dd>
        </div>
        <div className="mem-allowance">
          <dt>{t('tier.allowance.postage')}</dt>
          <dd>
            <span className="amount" dir="ltr">
              {formatUsd(Math.max(0, honoured.postage.creditMinor - honoured.postage.usedMinor))}
            </span>
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

function allowanceKey(action: string): MessageKey {
  return `tier.allowance.${action.replace('service_fee:', '').replace('shipping_addon:', '')}` as MessageKey;
}
