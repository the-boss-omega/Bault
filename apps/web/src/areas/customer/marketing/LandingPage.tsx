import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { bpsToPercent, formatUsd } from '../../../shared/money';
import { navigate } from '../../../shared/routing';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { Serial } from '../../../shared/ui/Serial';
import { Button } from '../../../shared/ui/primitives';
import { LanguageSwitcher } from '../../../shared/ui/PageHeader';
import { LANDING_SERIAL, LANDING_TITLE } from '../auth/AuthPage';
import type { AccountTerms } from '../help/FaqLegalPage';

/**
 * The front door: what Bault is and what it will cost, for somebody arriving
 * for the first time. It is built from the same parts as the rest of the
 * product:
 *
 *   - The pitch is a real item: the same photograph, `Serial`, custody line and
 *     custody green the signed-in product uses, on the same dark photography
 *     stage. The serial and the caption are imported from `AuthPage`, so there is
 *     one definition of the card on the stage.
 *   - The prices are fetched, never written. `GET /pricing/list` is public so
 *     somebody without an account can read what it costs, and it returns the
 *     rules the billing engine charges from. When the request fails the figures
 *     are omitted and the page says so, never a placeholder that could be read
 *     as "free".
 *   - The cash-out fee is the exception: it is charged from a schedule in the
 *     code (`money-terms.ts`), and its rule only publishes a figure, so it is
 *     read from `GET /content/account-terms`, the same source the legal pages
 *     use.
 *   - The wording is translated, the figures are not. A rule's `description` is
 *     stored in English, so the label for each featured rule is a catalogue key
 *     here and the number comes from the server, the same split
 *     `servicePrices.ts` makes for the service buttons.
 *
 * It uses `marketing` density, the generous end of the same scale the vault and
 * the warehouse sit on, and no component the product does not already have.
 */

/**
 * The rules worth putting on a front page, in the order somebody meets them.
 * `cash_out_fee` is stated from the account terms, not from its rule.
 */
const FEATURED: { actionType: string; labelKey: MessageKey }[] = [
  { actionType: 'intake', labelKey: 'landing.price.intake' },
  { actionType: 'storage', labelKey: 'landing.price.storage' },
  { actionType: 'shipping', labelKey: 'landing.price.shipping' },
  { actionType: 'marketplace_fee', labelKey: 'landing.price.marketplace' },
  { actionType: 'cash_out_fee', labelKey: 'landing.price.cashOut' },
];

interface PriceEntry {
  actionType: string;
  /** Null on a catch-all rule; set on a class-specific one. */
  itemClass?: string | null;
  model: 'fixed' | 'percentage';
  /** Cents for a fixed rule, basis points for a percentage one. */
  value: number;
  parameters: Record<string, unknown> | null;
}

interface PriceList {
  groups: { group: string; entries: PriceEntry[] }[];
}

/**
 * A rule in the units it is actually stated in.
 *
 * A percentage rule stores basis points and a fixed one stores cents, so running
 * both through `formatUsd` would turn 5% into "$5.00". Zero is formatted, not
 * suppressed: a $0.00 rule is a fact worth printing.
 */
function priceOf(entry: PriceEntry): string {
  return entry.model === 'percentage'
    ? `${(entry.value / 100).toFixed(entry.value % 100 === 0 ? 0 : 2)}%`
    : formatUsd(entry.value);
}

/** The cash-out schedule out of the account terms, or null when it is not all there. */
function cashOutOf(terms: Partial<AccountTerms> | null | undefined): AccountTerms['cashOut'] | null {
  const c = terms?.cashOut;
  if (!c) return null;
  const figures = [c.bandMinor, c.smallBps, c.smallMinimumMinor, c.largeFixedMinor, c.largeBps];
  return figures.every((n) => typeof n === 'number' && Number.isFinite(n)) ? c : null;
}

/** A finite number out of a rule's `parameters`, or null when it is not one. */
function param(entry: PriceEntry | undefined, key: string): number | null {
  const raw = entry?.parameters?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function LandingPage() {
  const { t } = useI18n();
  const [prices, setPrices] = useState<Map<string, PriceEntry> | null>(null);
  const [pricesFailed, setPricesFailed] = useState(false);
  /** `undefined` while the account terms load, `null` when they could not be read. */
  const [cashOut, setCashOut] = useState<AccountTerms['cashOut'] | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void api
      .get<PriceList>('/pricing/list')
      .then((list) => {
        if (!live) return;
        /**
         * One entry per action, and for intake the `trading_card` rule
         * specifically. Intake is priced per class, so the list carries a dozen
         * `intake` rules; the single-card rule is the headline, and the full
         * list is one click away in Help.
         */
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
        // A price that cannot be fetched is omitted.
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
        // Omitted, like a price that cannot be fetched.
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

  /**
   * Storage is the one featured rule whose figure is not its `value`.
   *
   * `value` on the storage rule is a fallback base for an item with no intake
   * charge to take a proportion of; the real terms live in `parameters`, which
   * the worker's sweep reads. So the terms are phrased from the parameters, and
   * omitted when they are not there.
   */
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
    <div className="landing" data-density="marketing">
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

      {/* ---- The stage. The one dark surface, and the whole pitch. ---- */}
      <section className="landing-stage" aria-labelledby="landing-headline">
        <div className="landing-stage-photo">
          <CardPhotoThumb serialNumber={LANDING_SERIAL} title={LANDING_TITLE} />
        </div>

        <div className="landing-pitch">
          <h1 className="landing-headline" id="landing-headline">
            {t('landing.hero.headline')}
          </h1>
          <p className="landing-lede">{t('landing.hero.lede')}</p>

          {/* The custody line: what the platform actually knows about this
              object, in the components that state it everywhere else. */}
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

      {/* ---- Three promises, as ruled entries rather than three cards ---- */}
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

      {/* ---- What it costs, read from the rules that do the charging ---- */}
      <section className="landing-section" aria-labelledby="landing-prices">
        <h2 className="landing-h2" id="landing-prices">
          {t('landing.prices.title')}
        </h2>
        <p className="landing-sub">{t('landing.prices.subtitle')}</p>

        {pricesFailed ? (
          <p className="hint">{t('landing.prices.unavailable')}</p>
        ) : (
          /* `.dt-wrap` is the product's own scroller for a table that outgrows
             its column; a table is only allowed to be wider than the page
             inside it. */
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
                        {/* Until the list arrives, and if it never does, the cell
                          is empty instead of holding a figure nobody quoted. */}
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

      {/* ---- How a card moves, in the order the work happens ---- */}
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

      {/* ---- And the three ways it leaves ---- */}
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

      {/* ---- The close ---- */}
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
