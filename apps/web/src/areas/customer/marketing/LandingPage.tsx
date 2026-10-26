import { useEffect, useRef, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { bpsToPercent, formatUsd } from '../../../shared/money';
import { navigate } from '../../../shared/routing';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { Serial } from '../../../shared/ui/Serial';
import { Button } from '../../../shared/ui/primitives';
import { LanguageSwitcher } from '../../../shared/ui/PageHeader';
import { useLandingMotion } from '../../../shared/ui/useLandingMotion';
import { LANDING_SERIAL, LANDING_TITLE } from '../auth/AuthPage';
import type { AccountTerms } from '../help/FaqLegalPage';

const FEATURED: { actionType: string; labelKey: MessageKey }[] = [
  { actionType: 'intake', labelKey: 'landing.price.intake' },
  { actionType: 'storage', labelKey: 'landing.price.storage' },
  { actionType: 'shipping', labelKey: 'landing.price.shipping' },
  { actionType: 'marketplace_fee', labelKey: 'landing.price.marketplace' },
  { actionType: 'cash_out_fee', labelKey: 'landing.price.cashOut' },
];

interface PriceEntry {
  actionType: string;
  itemClass?: string | null;
  model: 'fixed' | 'percentage';
  value: number;
  parameters: Record<string, unknown> | null;
}

interface PriceList {
  groups: { group: string; entries: PriceEntry[] }[];
}

function priceOf(entry: PriceEntry): string {
  return entry.model === 'percentage'
    ? `${(entry.value / 100).toFixed(entry.value % 100 === 0 ? 0 : 2)}%`
    : formatUsd(entry.value);
}

function cashOutOf(terms: Partial<AccountTerms> | null | undefined): AccountTerms['cashOut'] | null {
  const c = terms?.cashOut;
  if (!c) return null;
  const figures = [c.bandMinor, c.smallBps, c.smallMinimumMinor, c.largeFixedMinor, c.largeBps];
  return figures.every((n) => typeof n === 'number' && Number.isFinite(n)) ? c : null;
}

function param(entry: PriceEntry | undefined, key: string): number | null {
  const raw = entry?.parameters?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function LandingPage() {
  const { t } = useI18n();
  const pageRef = useRef<HTMLDivElement>(null);
  useLandingMotion(pageRef);
  const [prices, setPrices] = useState<Map<string, PriceEntry> | null>(null);
  const [pricesFailed, setPricesFailed] = useState(false);
  const [cashOut, setCashOut] = useState<AccountTerms['cashOut'] | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void api
      .get<PriceList>('/pricing/list')
      .then((list) => {
        if (!live) return;
        const byAction = new Map<string, PriceEntry>();
        for (const group of list.groups ?? []) {
          for (const entry of group.entries ?? []) {
            if (entry.itemClass && !(entry.actionType === 'intake' && entry.itemClass === 'trading_card')) continue;
            if (entry.actionType === 'intake' && byAction.get('intake')?.itemClass === 'trading_card') continue;
            byAction.set(entry.actionType, entry);
          }
        }
        setPrices(byAction);
      })
      .catch(() => {
        if (live) setPricesFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void api
      .get<AccountTerms>('/content/account-terms')
      .then((terms) => {
        if (live) setCashOut(cashOutOf(terms));
      })
      .catch(() => {
        if (live) setCashOut(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const cashOutTerms = cashOut
    ? t('legal.figures.cashOutValue', {
        smallPct: bpsToPercent(cashOut.smallBps),
        min: formatUsd(cashOut.smallMinimumMinor),
        band: formatUsd(cashOut.bandMinor),
        fixed: formatUsd(cashOut.largeFixedMinor),
        largePct: bpsToPercent(cashOut.largeBps),
      })
    : null;

  const storage = prices?.get('storage');
  const freeDays = param(storage, 'freeDays');
  const periodDays = param(storage, 'periodDays');
  const percentBps = param(storage, 'percentOfIntakeBps');

  const storageTerms =
    freeDays !== null && periodDays !== null && percentBps !== null
      ? t('landing.price.storageTerms', {
          days: freeDays,
          percent: (percentBps / 100).toFixed(percentBps % 100 === 0 ? 0 : 2),
          period: periodDays,
        })
      : null;

  const goSignUp = () => navigate({ section: 'signup' });
  const goSignIn = () => navigate({ section: 'signin' });

  return (
    <div className="landing" data-density="marketing" ref={pageRef}>
      <header className="landing-bar">
        <span className="rail-mark" aria-hidden="true">
          B
        </span>
        <span className="landing-word">Bault</span>
        <div className="landing-bar-actions">
          <LanguageSwitcher />
          <Button variant="ghost" onClick={goSignIn}>
            {t('landing.nav.signIn')}
          </Button>
          <Button variant="gold" onClick={goSignUp}>
            {t('landing.nav.signUp')}
          </Button>
        </div>
      </header>

      <section className="landing-stage" aria-labelledby="landing-headline">
        <span className="landing-aurora" aria-hidden="true" />
        <div className="landing-stage-photo">
          <CardPhotoThumb serialNumber={LANDING_SERIAL} title={LANDING_TITLE} />
        </div>

        <div className="landing-pitch">
          <h1 className="landing-headline" id="landing-headline">
            {t('landing.hero.headline')}
          </h1>
          <p className="landing-lede">{t('landing.hero.lede')}</p>

          <dl className="landing-custody">
            <div>
              <dt>{t('vault.serial')}</dt>
              <dd>
                <Serial value={LANDING_SERIAL} lead />
              </dd>
            </div>
            <div>
              <dt>{t('vault.item.state')}</dt>
              <dd>
                <span className="pill pill--success">{t('auth.landing.state')}</span>
              </dd>
            </div>
            <div>
              <dt>{t('auth.landing.whereLabel')}</dt>
              <dd className="ltr-run">{t('auth.landing.where')}</dd>
            </div>
          </dl>

          <p className="landing-caption ltr-run">{LANDING_TITLE}</p>

          <div className="landing-cta">
            <Button variant="gold" onClick={goSignUp}>
              {t('landing.hero.primary')}
            </Button>
            <Button variant="secondary" onClick={goSignIn}>
              {t('landing.hero.secondary')}
            </Button>
          </div>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="landing-promises">
        <h2 className="landing-h2" id="landing-promises">
          {t('landing.promises.title')}
        </h2>
        <p className="landing-sub">{t('landing.promises.subtitle')}</p>

        <div className="landing-claims">
          <article>
            <h3>{t('landing.promise.serial.title')}</h3>
            <p>{t('landing.promise.serial.body')}</p>
          </article>
          <article>
            <h3>{t('landing.promise.register.title')}</h3>
            <p>{t('landing.promise.register.body')}</p>
          </article>
          <article>
            <h3>{t('landing.promise.money.title')}</h3>
            <p>{t('landing.promise.money.body')}</p>
          </article>
        </div>
      </section>

      <section className="landing-section" aria-labelledby="landing-prices">
        <h2 className="landing-h2" id="landing-prices">
          {t('landing.prices.title')}
        </h2>
        <p className="landing-sub">{t('landing.prices.subtitle')}</p>

        {pricesFailed ? (
          <p className="hint">{t('landing.prices.unavailable')}</p>
        ) : (
          <div className="dt-wrap">
            <table className="data-table landing-price-table">
              <thead>
                <tr>
                  <th scope="col">{t('landing.prices.col.what')}</th>
                  <th scope="col" className="num">
                    {t('landing.prices.col.price')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {FEATURED.map(({ actionType, labelKey }) => {
                  const entry = prices?.get(actionType);
                  const isStorage = actionType === 'storage';
                  const isCashOut = actionType === 'cash_out_fee';
                  return (
                    <tr key={actionType}>
                      <th scope="row">
                        <span className="landing-price-what">{t(labelKey)}</span>
                        {isStorage && storageTerms !== null && (
                          <span className="landing-terms">{storageTerms}</span>
                        )}
                      </th>
                      <td className="num">
                        {entry !== undefined && !isStorage && !isCashOut && (
                          <span className="amount">{priceOf(entry)}</span>
                        )}
                        {isCashOut && (
                          <span className="landing-included">
                            {cashOut === undefined
                              ? t('grp.loading')
                              : (cashOutTerms ?? t('landing.price.unavailable'))}
                          </span>
                        )}
                        {isStorage && storageTerms !== null && (
                          <span className="landing-included">
                            {t('landing.price.storageIncluded')}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="landing-footnote">{t('landing.prices.footnote')}</p>
      </section>

      <section className="landing-section" aria-labelledby="landing-journey">
        <h2 className="landing-h2" id="landing-journey">
          {t('landing.journey.title')}
        </h2>
        <p className="landing-sub">{t('landing.journey.subtitle')}</p>

        <ol className="steps landing-steps">
          {(['arrive', 'book', 'shelf', 'decide'] as const).map((key) => (
            <li className="step" key={key}>
              <span className="step-name">{t(`landing.journey.${key}.name` as MessageKey)}</span>
              <span className="step-detail">
                {t(`landing.journey.${key}.detail` as MessageKey)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" aria-labelledby="landing-out">
        <h2 className="landing-h2" id="landing-out">
          {t('landing.out.title')}
        </h2>
        <p className="landing-sub">{t('landing.out.subtitle')}</p>

        <div className="landing-claims">
          <article>
            <h3>{t('landing.out.carrier.title')}</h3>
            <p>{t('landing.out.carrier.body')}</p>
          </article>
          <article>
            <h3>{t('landing.out.glove.title')}</h3>
            <p>{t('landing.out.glove.body')}</p>
          </article>
          <article>
            <h3>{t('landing.out.pickup.title')}</h3>
            <p>{t('landing.out.pickup.body')}</p>
          </article>
        </div>
      </section>

      <section className="landing-close" aria-labelledby="landing-close-h">
        <h2 className="landing-h2" id="landing-close-h">
          {t('landing.close.title')}
        </h2>
        <p className="landing-sub">{t('landing.close.body')}</p>
        <div className="landing-cta">
          <Button variant="gold" onClick={goSignUp}>
            {t('landing.close.cta')}
          </Button>
          <Button variant="secondary" onClick={goSignIn}>
            {t('landing.nav.signIn')}
          </Button>
        </div>
      </section>

      <footer className="landing-foot">
        <p className="hint">{t('landing.foot')}</p>
      </footer>
    </div>
  );
}
