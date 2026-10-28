import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { bpsToPercent, formatUsd } from '../../../shared/money';
import { navigate } from '../../../shared/routing';
import { CardSlab } from '../../../shared/CardPhoto';
import { Serial } from '../../../shared/ui/Serial';
import { SplitWords } from '../../../shared/ui/SplitWords';
import { Button } from '../../../shared/ui/primitives';
import { LanguageSwitcher } from '../../../shared/ui/PageHeader';
import { scrollBehavior } from '../../../shared/ui/motionPreference';
import { useLandingMotion } from '../../../shared/ui/useLandingMotion';
import { slabLeave, slabMove } from '../../../shared/ui/slabTilt';
import { LANDING_SERIAL, LANDING_TITLE } from '../auth/AuthPage';
import type { AccountTerms } from '../help/FaqLegalPage';
import { LedgerArt, PlateArt, RuleArt } from './LandingArt';

/**
 * The cards on the shelf. They are real items from the demo vault, so the
 * photographs are real photographs; each one's label carries its own serial.
 * The first is the card the page opens on.
 */
const FAN: { serial: string; title: string; slot: 'c' | 'l1' | 'r1' | 'l2' | 'r2' }[] = [
  { serial: LANDING_SERIAL, title: LANDING_TITLE, slot: 'c' },
  {
    serial: 'SN-DR97-0001',
    title: '2003 Pokémon EX Dragon — Rayquaza ex #97/97 · Rare Holo EX',
    slot: 'l1',
  },
  {
    serial: 'SN-ROS105-0008',
    title: '2015 Pokémon XY Roaring Skies — M Rayquaza-EX (Full Art) #105/108 · Rare Ultra',
    slot: 'r1',
  },
  {
    serial: 'SN-CL10-0005',
    title: '2011 Pokémon Call of Legends — Rayquaza #SL10/95 · Rare Holo',
    slot: 'l2',
  },
  {
    serial: 'SN-SV146-0006',
    title: '2009 Pokémon Supreme Victors — Rayquaza C LV.X #146/147 · Rare Holo LV.X',
    slot: 'r2',
  },
];

/** The closing shelf leads with a different card, so the page is not one card said five times. */
const CLOSE_FAN: typeof FAN = [
  { ...FAN[2]!, slot: 'c' },
  { ...FAN[4]!, slot: 'l1' },
  { ...FAN[0]!, slot: 'r1' },
  { ...FAN[3]!, slot: 'l2' },
  { ...FAN[1]!, slot: 'r2' },
];

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

function cashOutOf(
  terms: Partial<AccountTerms> | null | undefined,
): AccountTerms['cashOut'] | null {
  const c = terms?.cashOut;
  if (!c) return null;
  const figures = [c.bandMinor, c.smallBps, c.smallMinimumMinor, c.largeFixedMinor, c.largeBps];
  return figures.every((n) => typeof n === 'number' && Number.isFinite(n)) ? c : null;
}

function param(entry: PriceEntry | undefined, key: string): number | null {
  const raw = entry?.parameters?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/**
 * The page is one route of a hash router, so a section link cannot be a #fragment.
 * Scrolling is smooth only for a visitor who has not asked for less motion, and
 * focus moves to the section's heading so a keyboard or screen-reader user lands
 * where the page has scrolled to, not on the link they left.
 */
function jumpTo(id: string) {
  const section = document.getElementById(id);
  if (!section) return;
  section.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  const heading = section.querySelector<HTMLElement>('h2');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

function SectionLinks({ links }: { links: readonly (readonly [string, string])[] }) {
  return links.map(([id, label]) => (
    <a
      key={id}
      href="#/"
      onClick={(event) => {
        event.preventDefault();
        jumpTo(id);
      }}
    >
      {label}
    </a>
  ));
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
            if (
              entry.itemClass &&
              !(entry.actionType === 'intake' && entry.itemClass === 'trading_card')
            )
              continue;
            if (
              entry.actionType === 'intake' &&
              byAction.get('intake')?.itemClass === 'trading_card'
            )
              continue;
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
  const headline = t('landing.hero.headline');
  const closeTitle = t('landing.close.title');
  const sectionLinks = [
    ['costs', t('landing.prices.title')],
    ['journey', t('landing.journey.title')],
    ['exits', t('landing.out.title')],
  ] as const;

  return (
    <div className="landing lp" data-density="marketing" ref={pageRef}>
      <span className="lp-progress" aria-hidden="true" />
      <header className="landing-bar lp-bar">
        <span className="lp-brand">
          <span className="lp-mark" aria-hidden="true">
            B
          </span>
          <span className="lp-word">Bault</span>
        </span>
        <nav className="lp-nav" aria-label={t('nav.primary')}>
          <SectionLinks links={sectionLinks} />
        </nav>
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

      <main className="lp-main">
        <section className="lp-hero" aria-labelledby="landing-headline">
          <div className="lp-hero-copy">
            <span className="lp-rule" aria-hidden="true" />
            <h1 className="lp-headline" id="landing-headline" aria-label={headline}>
              <SplitWords text={headline} />
            </h1>
            <p className="lp-lede">{t('landing.hero.lede')}</p>
            <div className="lp-cta">
              <Button variant="gold" onClick={goSignUp}>
                {t('landing.hero.primary')}
              </Button>
              <Button variant="secondary" onClick={goSignIn}>
                {t('landing.hero.secondary')}
              </Button>
            </div>
          </div>

          <div className="lp-fan">
            {FAN.map((card, i) => (
              <div
                className={`lp-card lp-card--${card.slot}${i === 0 ? ' slab-idle' : ''}`}
                key={card.serial}
                style={{ '--d': i } as CSSProperties}
              >
                <CardSlab serialNumber={card.serial} title={card.title} priority={i < 3} />
              </div>
            ))}

            <dl className="lp-shelf">
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
          </div>
        </section>

        <div className="lp-paper">
          <section className="lp-section lp-promises" aria-labelledby="landing-promises">
            <header className="lp-section-head" data-reveal>
              <h2 className="lp-h2" id="landing-promises" aria-label={t('landing.promises.title')}>
                <SplitWords text={t('landing.promises.title')} />
              </h2>
              <p className="lp-sub">{t('landing.promises.subtitle')}</p>
            </header>

            <ol className="lp-truths">
              <li className="lp-truth" data-reveal>
                <div className="lp-truth-copy">
                  <h3>{t('landing.promise.serial.title')}</h3>
                  <p>{t('landing.promise.serial.body')}</p>
                </div>
                <PlateArt serial={LANDING_SERIAL} />
              </li>
              <li className="lp-truth" data-reveal>
                <div className="lp-truth-copy">
                  <h3>{t('landing.promise.register.title')}</h3>
                  <p>{t('landing.promise.register.body')}</p>
                </div>
                <LedgerArt />
              </li>
              <li className="lp-truth" data-reveal>
                <div className="lp-truth-copy">
                  <h3>{t('landing.promise.money.title')}</h3>
                  <p>{t('landing.promise.money.body')}</p>
                </div>
                <RuleArt />
              </li>
            </ol>
          </section>
        </div>

        <section className="lp-section lp-prices" id="costs" aria-labelledby="landing-prices">
          <header className="lp-section-head" data-reveal>
            <h2 className="lp-h2" id="landing-prices" aria-label={t('landing.prices.title')}>
              <SplitWords text={t('landing.prices.title')} />
            </h2>
            <p className="lp-sub">{t('landing.prices.subtitle')}</p>
            <p className="lp-footnote">{t('landing.prices.footnote')}</p>
          </header>

          <div className="lp-rates" data-reveal>
            {pricesFailed ? (
              <p className="hint">{t('landing.prices.unavailable')}</p>
            ) : (
              <table className="data-table">
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
            )}
          </div>
        </section>

        <section
          className="lp-section lp-journey"
          id="journey"
          data-stage="1"
          aria-labelledby="landing-journey"
        >
          <header className="lp-section-head" data-reveal>
            <h2 className="lp-h2" id="landing-journey" aria-label={t('landing.journey.title')}>
              <SplitWords text={t('landing.journey.title')} />
            </h2>
            <p className="lp-sub">{t('landing.journey.subtitle')}</p>
          </header>

          <div className="lp-journey-grid">
            <div className="lp-stage" aria-hidden="true">
              <div className="lp-stage-room">
                <span className="lp-crop lp-crop--a" />
                <span className="lp-crop lp-crop--b" />
                <span className="lp-crop lp-crop--c" />
                <span className="lp-crop lp-crop--d" />
                <CardSlab
                  serialNumber={LANDING_SERIAL}
                  title={LANDING_TITLE}
                  className="lp-stage-slab"
                />
                <span className="lp-flash" />
                <span className="lp-shelf-line" />
                <span className="lp-shelf-tag" data-tag="BIN-HT39VTZX · B" />
                <ul className="lp-exits">
                  <li>{t('landing.out.carrier.title')}</li>
                  <li>{t('landing.out.glove.title')}</li>
                  <li>{t('landing.out.pickup.title')}</li>
                </ul>
              </div>
            </div>

            <ol className="steps lp-steps">
              {(['arrive', 'book', 'shelf', 'decide'] as const).map((key, i) => (
                <li className="step" key={key} data-step={i + 1}>
                  <span className="step-name">
                    {t(`landing.journey.${key}.name` as MessageKey)}
                  </span>
                  <span className="step-detail">
                    {t(`landing.journey.${key}.detail` as MessageKey)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section lp-out" id="exits" aria-labelledby="landing-out">
          <header className="lp-section-head" data-reveal>
            <h2 className="lp-h2" id="landing-out" aria-label={t('landing.out.title')}>
              <SplitWords text={t('landing.out.title')} />
            </h2>
            <p className="lp-sub">{t('landing.out.subtitle')}</p>
          </header>

          <div className="lp-tickets">
            {(['carrier', 'glove', 'pickup'] as const).map((key, i) => (
              <article
                className="lp-ticket"
                key={key}
                data-reveal
                onPointerMove={slabMove}
                onPointerLeave={slabLeave}
              >
                <div className="tilt-case lp-ticket-face">
                  <div className="lp-ticket-main">
                    <h3>{t(`landing.out.${key}.title` as MessageKey)}</h3>
                    <p>{t(`landing.out.${key}.body` as MessageKey)}</p>
                  </div>
                  <div className="lp-ticket-stub" aria-hidden="true">
                    <span className="lp-stub-no">{`0${i + 1} / 03`}</span>
                    <span className="lp-stub-bars" />
                  </div>
                  <span className="lp-ticket-glare" aria-hidden="true" />
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-close" aria-labelledby="landing-close-h">
          <div className="lp-close-copy" data-reveal>
            <h2 className="lp-close-title" id="landing-close-h" aria-label={closeTitle}>
              <SplitWords text={closeTitle} />
            </h2>
            <p className="lp-sub">{t('landing.close.body')}</p>
            <div className="lp-cta">
              <Button variant="gold" onClick={goSignUp}>
                {t('landing.close.cta')}
              </Button>
              <Button variant="secondary" onClick={goSignIn}>
                {t('landing.nav.signIn')}
              </Button>
            </div>
          </div>

          <div className="lp-fan lp-fan--close" aria-hidden="true">
            {CLOSE_FAN.map((card, i) => (
              <div
                className={`lp-card lp-card--${card.slot}`}
                key={card.serial}
                style={{ '--d': i } as CSSProperties}
              >
                <CardSlab serialNumber={card.serial} title={card.title} />
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-colophon">
          <div className="lp-colophon-top">
            <span className="lp-colophon-word">Bault</span>
            <div className="lp-colophon-nav">
              <SectionLinks links={sectionLinks} />
            </div>
            <span className="lp-colophon-actions">
              <button type="button" className="lp-colophon-link" onClick={goSignIn}>
                {t('landing.nav.signIn')}
              </button>
              <button type="button" className="lp-colophon-link" onClick={goSignUp}>
                {t('landing.nav.signUp')}
              </button>
            </span>
          </div>
          <p className="lp-colophon-note">{t('landing.foot')}</p>
        </div>
      </footer>
    </div>
  );
}
