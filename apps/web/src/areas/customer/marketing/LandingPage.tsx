import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { formatUsd } from '../../../shared/money';
import { navigate } from '../../../shared/routing';
import { Serial } from '../../../shared/ui/Serial';
import { Button } from '../../../shared/ui/primitives';
import { LanguageSwitcher } from '../../../shared/ui/PageHeader';
import { DemoSlab, DEMO_SERIAL } from './DemoSlab';

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
 *   - THE PITCH IS A DEMONSTRATION, IN THE PRODUCT'S OWN PARTS. A real
 *     photograph in a demo case (`DemoSlab`), and beside it the same `Serial`,
 *     custody line and custody green the signed-in product uses — filled with
 *     demo values. It once showed a real item's serial, site and zone; a page
 *     anybody can open must never describe a collector's actual holdings.
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

/**
 * The rules worth putting on a front page, in the order somebody meets them.
 *
 * `shipping` used to be here and is not a price: it is the handling surcharge on
 * top of the carrier's rate, and it is $0.00 — so the front page listed
 * "Shipping: $0.00" beside four real figures. What somebody actually pays on the
 * way in is the per-parcel receiving fee, which is now the row.
 */
const FEATURED: { actionType: string; labelKey: MessageKey }[] = [
  { actionType: 'parcel_processing', labelKey: 'landing.price.parcelProcessing' },
  { actionType: 'intake', labelKey: 'landing.price.intake' },
  { actionType: 'storage', labelKey: 'landing.price.storage' },
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

/** `GET /membership/tiers`, trimmed to what the page shows. Public, like the price list. */
interface TierList {
  tiers?: { key: string; priceMinor: number }[];
}

/** The membership tiers the page may name, in order — a tier it does not know is not shown. */
const TIER_KEYS = ['folio', 'registry', 'trust'] as const;

/** What Bault does, as six services — each a title and one line. */
const SERVICES = ['sell', 'trade', 'grade', 'ship', 'address', 'escrow'] as const;

/** The four facts under the hero: what happens to every item, said once. */
const FACTS = ['photo', 'serial', 'record', 'fees'] as const;

/** What makes Bault different — three claims the product actually keeps. */
const DIFFERENCES = ['record', 'prices', 'membership'] as const;

/**
 * A rule in the units it is actually stated in.
 *
 * A percentage rule stores basis points and a fixed one stores cents, so running
 * both through `formatUsd` turns 5% into "$5.00" — the exact error a price label
 * exists to prevent.
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

/**
 * Motion on this page is decoration, so it is the first thing to go: a reader
 * who has asked the system for less motion gets none of it, and neither does an
 * environment that cannot say (the test DOM, a thumbnail renderer).
 */
function motionAllowed(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Sections below the fold rise into place as they are scrolled to.
 *
 * Hidden only by JavaScript, and only once it knows it can show them again:
 * the markup carries `data-reveal=""`, which the stylesheet does NOT hide. This
 * hook flips an element to `pending` (hidden) only if an IntersectionObserver
 * exists to flip it back to `shown`, and never touches one already on screen —
 * so a page without script, without the observer, or with reduced motion shows
 * everything, immediately, exactly as before.
 */
function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined' || !motionAllowed()) return;
    /**
     * The backstop. A reader who never scrolls — and anything that captures the
     * page in one pass, which is how this was found — left every section below
     * the fold hidden, so the front page was a hero above 2,600px of nothing.
     * Whatever is still pending after this is simply shown.
     */
    const showEverything = window.setTimeout(() => {
      for (const target of el.querySelectorAll<HTMLElement>('[data-reveal="pending"]')) {
        target.dataset.reveal = 'shown';
      }
    }, 1500);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = 'shown';
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    );
    for (const target of el.querySelectorAll<HTMLElement>('[data-reveal]')) {
      if (target.getBoundingClientRect().top < window.innerHeight) continue;
      target.dataset.reveal = 'pending';
      observer.observe(target);
    }
    return () => {
      window.clearTimeout(showEverything);
      observer.disconnect();
    };
  }, [root]);
}

/**
 * The card leans toward a mouse pointer, and a light moves across it.
 *
 * Mouse only: on touch there is no hover to follow, and a card that jumps to
 * wherever a thumb landed reads as a glitch. The values go into custom
 * properties the stylesheet already bounds, so this never writes a transform
 * of its own and cannot fight the entrance animation for one.
 */
function useCardTilt(ref: RefObject<HTMLDivElement | null>) {
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType !== 'mouse' || !motionAllowed()) return;
    const box = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    el.style.setProperty('--tilt-x', `${((0.5 - y) * 10).toFixed(2)}deg`);
    el.style.setProperty('--tilt-y', `${((x - 0.5) * 12).toFixed(2)}deg`);
    el.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
    el.dataset.tilting = 'true';
  };
  const onPointerLeave = () => {
    const el = ref.current;
    if (!el) return;
    for (const prop of ['--tilt-x', '--tilt-y', '--glare-x', '--glare-y']) el.style.removeProperty(prop);
    delete el.dataset.tilting;
  };
  return { onPointerMove, onPointerLeave };
}

export function LandingPage() {
  const { t } = useI18n();
  const pageRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useReveal(pageRef);
  const tilt = useCardTilt(cardRef);
  const [prices, setPrices] = useState<Map<string, PriceEntry> | null>(null);
  const [pricesFailed, setPricesFailed] = useState(false);
  const [tiers, setTiers] = useState<{ key: string; priceMinor: number }[] | null>(null);

  /**
   * Membership prices come from the same place the membership page reads them.
   * If the request fails, or answers with anything but a tier list, the section
   * is left out entirely — a plan with no price is worse than no plan at all.
   */
  useEffect(() => {
    let live = true;
    void api
      .get<TierList>('/membership/tiers')
      .then((list) => {
        if (!live || !Array.isArray(list?.tiers)) return;
        const known = TIER_KEYS.flatMap((key) => {
          const tier = list.tiers!.find((x) => x.key === key);
          return tier && Number.isFinite(tier.priceMinor) ? [{ key, priceMinor: tier.priceMinor }] : [];
        });
        if (known.length > 0) setTiers(known);
      })
      .catch(() => {
        /* no plans shown rather than plans without prices */
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void api
      .get<PriceList>('/pricing/list')
      .then((list) => {
        if (!live) return;
        /**
         * One entry per action — and for intake, the CARD rule specifically.
         *
         * Intake is priced per class now, so the list carries a dozen `intake`
         * rules. Keyed by action alone, whichever came last would have been shown
         * as "the" intake price: a sealed case's $20 on the front page of a
         * service most people use for single cards. The single-card rule is the
         * honest headline; the full list is one click away in Help.
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

      {/* ---- The stage. The one dark surface, and the whole pitch. ---- */}
      <section className="landing-stage" aria-labelledby="landing-headline">
        <div className="landing-stage-photo">
          <div className="landing-card" ref={cardRef} {...tilt}>
            <DemoSlab />
            {/* A foil card catches the light: one sweep on arrival, then an
                occasional one, and a glare that follows the pointer. */}
            <span className="landing-card-sheen" aria-hidden="true" />
            <span className="landing-card-glare" aria-hidden="true" />
          </div>
        </div>

        <div className="landing-pitch">
          <h1 className="landing-headline" id="landing-headline">
            {t('landing.hero.headline')}
          </h1>
          <p className="landing-lede">{t('landing.hero.lede')}</p>

          {/* The custody line: what the platform actually knows about this
              object, in the components that state it everywhere else. */}
          {/* What a record looks like — filled with demo values, never a
              collector's real serial, site or zone. */}
          <dl className="landing-custody">
            <div>
              <dt>{t('vault.serial')}</dt>
              <dd>
                <Serial value={DEMO_SERIAL} lead />
              </dd>
            </div>
            <div>
              <dt>{t('landing.grade')}</dt>
              <dd>{t('landing.gradeValue')}</dd>
            </div>
            <div>
              <dt>{t('vault.item.state')}</dt>
              <dd>
                <span className="pill pill--success landing-live">
                  <span className="landing-live-dot" aria-hidden="true" />
                  {t('auth.landing.state')}
                </span>
              </dd>
            </div>
          </dl>

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

      {/* ---- What happens to every item, in four facts ---- */}
      <ul className="landing-facts" aria-label={t('landing.facts.label')}>
        {FACTS.map((key) => (
          <li key={key}>{t(`landing.fact.${key}` as MessageKey)}</li>
        ))}
      </ul>

      {/* ---- How it works, in the order the work happens ---- */}
      <section className="landing-section" data-reveal="" aria-labelledby="landing-journey">
        <h2 className="landing-h2" id="landing-journey">
          {t('landing.journey.title')}
        </h2>
        <ol className="steps landing-steps">
          {(['arrive', 'book', 'shelf', 'decide'] as const).map((key) => (
            <li className="step" key={key}>
              <span className="step-name">{t(`landing.journey.${key}.name` as MessageKey)}</span>
              <span className="step-detail">{t(`landing.journey.${key}.detail` as MessageKey)}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* ---- Everything it does, one line each ---- */}
      <section className="landing-section" data-reveal="" aria-labelledby="landing-services">
        <h2 className="landing-h2" id="landing-services">
          {t('landing.services.title')}
        </h2>
        <div className="landing-claims landing-services">
          {SERVICES.map((key) => (
            <article key={key}>
              <h3>{t(`landing.service.${key}.title` as MessageKey)}</h3>
              <p>{t(`landing.service.${key}.body` as MessageKey)}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---- What makes it different ---- */}
      <section className="landing-section landing-why" data-reveal="" aria-labelledby="landing-why">
        <h2 className="landing-h2" id="landing-why">
          {t('landing.why.title')}
        </h2>
        <div className="landing-claims">
          {DIFFERENCES.map((key) => (
            <article key={key}>
              <h3>{t(`landing.why.${key}.title` as MessageKey)}</h3>
              <p>{t(`landing.why.${key}.body` as MessageKey)}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---- Pricing, read from the rules that do the charging ---- */}
      <section className="landing-section" data-reveal="" aria-labelledby="landing-prices">
        <h2 className="landing-h2" id="landing-prices">
          {t('landing.prices.title')}
        </h2>

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
                  /**
                   * Cashing out is charged from a band schedule, not from this
                   * rule's own value: the rule says 1%, which is the figure above
                   * $100 only. The front page quoted that 1% on its own, which
                   * reads as the whole fee and is not.
                   */
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
                          is empty rather than holding a figure nobody quoted. */}
                        {isCashOut ? (
                          entry !== undefined && <span className="landing-included">{t('prices.cashOutSchedule')}</span>
                        ) : isStorage ? (
                          storageTerms !== null && (
                            <span className="landing-included">{t('landing.price.storageIncluded')}</span>
                          )
                        ) : (
                          entry !== undefined && <span className="amount">{priceOf(entry)}</span>
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

      {/* ---- Memberships, priced from the tiers the billing engine uses ---- */}
      {tiers !== null && (
        <section className="landing-section" data-reveal="" aria-labelledby="landing-tiers">
          <h2 className="landing-h2" id="landing-tiers">
            {t('landing.tiers.title')}
          </h2>
          <p className="landing-sub">{t('landing.tiers.subtitle')}</p>
          <div className="landing-tiers">
            {tiers.map(({ key, priceMinor }) => (
              <article key={key}>
                <h3>{t(`membership.tier.${key}` as MessageKey)}</h3>
                <p className="landing-tier-price">
                  <span className="amount">{formatUsd(priceMinor)}</span>
                  <span className="landing-tier-period">{t('landing.tiers.perMonth')}</span>
                </p>
                <p>{t(`membership.tierFor.${key}` as MessageKey)}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ---- The close ---- */}
      <section className="landing-close" data-reveal="" aria-labelledby="landing-close-h">
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
