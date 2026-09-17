import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { formatUsd } from '../../../shared/money';
import { navigate } from '../../../shared/routing';
import { CardPhotoThumb } from '../../../shared/CardPhoto';
import { Serial } from '../../../shared/ui/Serial';
import { Button } from '../../../shared/ui/primitives';
import { LanguageSwitcher } from '../../../shared/ui/PageHeader';
import { LANDING_SERIAL, LANDING_TITLE } from '../auth/AuthPage';

/**
 * The front door, and the first one this product has ever had.
 *
 * `AuthShell` says it in its own comment: THERE IS NO MARKETING SITE. The whole
 * application sat behind authentication, and the only anonymous surface was a
 * sign-in form with a photograph beside it. That form is a good shop window and
 * a bad front door: it answers "get me back in", and it does not answer the
 * question somebody arriving for the first time is actually asking, which is
 * what this is and what it will cost.
 *
 * So this page is that answer, and it is built out of the same argument the rest
 * of the product makes rather than out of a separate marketing voice:
 *
 *   - THE PITCH IS A REAL ITEM. The same photograph, the same `Serial`, the same
 *     custody line and the same custody green the signed-in product uses, on the
 *     same dark photography stage. A landing page that promises a different
 *     product than the one behind it is a lie told twice, so the serial and the
 *     caption are imported from `AuthPage` rather than retyped — there is one
 *     definition of the card on the stage, and it cannot drift.
 *   - THE PRICES ARE FETCHED, NEVER WRITTEN. `GET /pricing/list` is public
 *     precisely so somebody without an account can read what it costs, and it
 *     returns the rules the billing engine charges from. Hard-coding "from $5"
 *     into a landing page would be the one figure in the product that no rule
 *     backs. When the request fails the figures are OMITTED and the page says
 *     so — never a placeholder that could be read as "free".
 *   - THE WORDING IS TRANSLATED, THE FIGURES ARE NOT. A rule's `description`
 *     comes out of the database in English; printing it on the Hebrew page would
 *     put an English sentence in the middle of a Hebrew table. The label for each
 *     featured rule is a catalogue key here and the NUMBER comes from the server,
 *     which is the same split `servicePrices.ts` makes for the service buttons.
 *
 * It is `marketing` density — the generous end of the same scale the vault and
 * the warehouse sit on — and it introduces no component the product did not
 * already have. A section is a heading and a rule, not a floating card.
 */

/** The rules worth putting on a front page, in the order somebody meets them. */
const FEATURED: { actionType: string; labelKey: MessageKey }[] = [
  { actionType: 'intake', labelKey: 'landing.price.intake' },
  { actionType: 'storage', labelKey: 'landing.price.storage' },
  { actionType: 'shipping', labelKey: 'landing.price.shipping' },
  { actionType: 'marketplace_fee', labelKey: 'landing.price.marketplace' },
  { actionType: 'cash_out_fee', labelKey: 'landing.price.cashOut' },
];

interface PriceEntry {
  actionType: string;
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
 * both through `formatUsd` turns 5% into "$5.00" — the exact error a price label
 * exists to prevent. Zero is formatted rather than suppressed: the handling rule
 * really is $0.00, and that is a fact worth printing, not an absence to hide.
 */
function priceOf(entry: PriceEntry): string {
  return entry.model === 'percentage'
    ? `${(entry.value / 100).toFixed(entry.value % 100 === 0 ? 0 : 2)}%`
    : formatUsd(entry.value);
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

  useEffect(() => {
    let live = true;
    void api
      .get<PriceList>('/pricing/list')
      .then((list) => {
        if (!live) return;
        const byAction = new Map<string, PriceEntry>();
        for (const group of list.groups ?? []) {
          for (const entry of group.entries ?? []) byAction.set(entry.actionType, entry);
        }
        setPrices(byAction);
      })
      .catch(() => {
        // A price that cannot be fetched is omitted, not guessed.
        if (live) setPricesFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const storage = prices?.get('storage');
  const freeDays = param(storage, 'freeDays');
  const periodDays = param(storage, 'periodDays');
  const percentBps = param(storage, 'percentOfIntakeBps');

  /**
   * Storage is the one featured rule whose figure is not its `value`.
   *
   * `value` on the storage rule is a fallback base for an item with no intake
   * charge to take a proportion of; the real terms live in `parameters`, and the
   * worker's sweep reads them. Printing the $1.00 would be quoting a number
   * nobody is ever charged, so the terms are phrased from the parameters and
   * omitted entirely when they are not there.
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
          /* `.dt-wrap` is the product's own scroller for a register that
             outgrows its column. Two columns will not, on any screen this page
             is read on — but a table is the one element allowed to be wider
             than the page, and only inside this. */
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
                          is empty rather than holding a figure nobody quoted. */}
                        {entry !== undefined && !isStorage && (
                          <span className="amount">{priceOf(entry)}</span>
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
