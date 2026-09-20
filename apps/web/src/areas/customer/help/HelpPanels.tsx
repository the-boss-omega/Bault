import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey } from '../../../shared/i18n';
import { formatDate } from '../../../shared/money';
import { useNavigation, useRoute } from '../../../shared/routing';
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  StatusBadge,
} from '../../../shared/ui/primitives';
import {
  IconAsk,
  IconCalendar,
  IconChevronRight,
  IconLocation,
  IconSearch,
} from '../../../shared/ui/icons';
import { GUIDES, GUIDE_CATEGORIES, guide, matchesGuideSearch, type Guide, type GuideLocale } from './guideContent';

/* ============================================================
   Guides — the written half of "video tutorials for each workflow"
   ============================================================ */

/**
 * Step-by-step walkthroughs of every workflow, with real routes.
 *
 * Written rather than filmed: the ordered steps, each naming the screen it
 * happens on, with a link that goes there — which is the part a recording would
 * be a recording OF, and the part that can be kept correct. Both languages are
 * in the content, so a Hebrew reader is not handed a page of English at the
 * moment they are asking how something works.
 */
export function GuidesPanel() {
  const { t, locale } = useI18n();
  const lang = locale as GuideLocale;
  const route = useRoute();
  const { openRecord, closeRecord } = useNavigation(route);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');

  const openId = route.params.g ?? null;
  const open = openId ? guide(openId) : undefined;

  const shown = useMemo(
    () =>
      GUIDES.filter((g) => category === 'all' || g.category === category).filter((g) =>
        matchesGuideSearch(g, query),
      ),
    [category, query],
  );

  if (open) return <GuideDetail g={open} locale={lang} onBack={() => closeRecord('g')} />;

  return (
    <Panel title={t('guide.title')} subtitle={t('guide.subtitle')}>
      <div className="vault-search" style={{ maxWidth: 420 }}>
        <IconSearch />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('guide.searchPlaceholder')}
          aria-label={t('guide.search')}
        />
      </div>

      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', marginBlock: 'var(--sp-3)' }}>
        <Button size="sm" variant={category === 'all' ? 'secondary' : 'ghost'} onClick={() => setCategory('all')}>
          {t('guide.cat.all')}
        </Button>
        {GUIDE_CATEGORIES.map((c) => (
          <Button
            key={c}
            size="sm"
            variant={category === c ? 'secondary' : 'ghost'}
            onClick={() => setCategory(c)}
          >
            {t(`guide.cat.${c}` as MessageKey)}
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState title={t('guide.noneTitle')} text={t('guide.noneText')} icon={<IconAsk />} />
      ) : (
        <ul className="card-grid">
          {shown.map((g) => (
            <li key={g.id} className="card card--interactive">
              <button type="button" className="card-hit" onClick={() => openRecord('g', g.id)}>
                <span className="sr-only">{g.title[lang]}</span>
              </button>
              <h3 className="card-title">{g.title[lang]}</h3>
              <p className="card-desc">{g.summary[lang]}</p>
              <div className="card-meta">
                <StatusBadge tone="info" plain>
                  {t(`guide.cat.${g.category}` as MessageKey)}
                </StatusBadge>
                <span>{t('guide.minutes', { count: g.minutes })}</span>
                <span>{t('guide.steps', { count: g.steps.length })}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function GuideDetail({ g, locale, onBack }: { g: Guide; locale: GuideLocale; onBack: () => void }) {
  const { t } = useI18n();
  const related = (g.related ?? []).map((id) => guide(id)).filter((x): x is Guide => Boolean(x));

  return (
    <Panel
      title={g.title[locale]}
      subtitle={g.summary[locale]}
      tools={
        <Button size="sm" variant="ghost" onClick={onBack}>
          {t('guide.back')}
        </Button>
      }
    >
      <ol className="timeline stack-top">
        {g.steps.map((step, index) => (
          <li key={index} className="detail-row" style={{ display: 'block' }}>
            <div className="row" style={{ gap: 'var(--sp-2)' }}>
              <StatusBadge tone="neutral" plain>
                {index + 1}
              </StatusBadge>
              {/* The screen itself, by name. It used to print the raw hash route. */}
              {step.route && (
                <a className="link-more" href={step.route}>
                  {t('guide.openScreen')}
                  <IconChevronRight />
                </a>
              )}
            </div>
            <p style={{ marginBlockStart: 4 }}>{step.text[locale]}</p>
            {step.note && <p className="hint">{step.note[locale]}</p>}
          </li>
        ))}
      </ol>

      {related.length > 0 && (
        <>
          <h3 className="drawer-heading">{t('guide.related')}</h3>
          <ul className="check-list list-unbounded">
            {related.map((r) => (
              <li key={r.id}>
                <span>{r.title[locale]}</span>
                <a className="hint" href={`#/faq/guides?g=${r.id}`}>
                  {t('guide.open')} <IconChevronRight />
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/* ============================================================
   Shows
   ============================================================ */

interface Show {
  id: string;
  name: string;
  venue: string;
  city: string | null;
  startsAt: string;
  endsAt: string | null;
  requestDeadline: string;
  capacity: number;
  notes: string | null;
  open: boolean;
  past: boolean;
}

/**
 * The show calendar.
 *
 * Real rows, not editorial: Bault takes a table at particular shows on
 * particular dates, and a consignment aimed at one has a deadline attached. Past
 * shows are kept — a calendar that silently drops yesterday cannot be used to
 * check what you missed.
 */
export function ShowsPanel() {
  const { t, locale } = useI18n();
  const [shows, setShows] = useState<Show[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setShows(await api.get<Show[]>('/content/shows'));
      } catch (e) {
        setError((e as Error).message);
        setShows([]);
      }
    })();
  }, []);

  const upcoming = (shows ?? []).filter((s) => !s.past);
  const past = (shows ?? []).filter((s) => s.past);

  return (
    <>
      {error && <ErrorState message={error} />}
      <Panel title={t('shows.title')} subtitle={t('shows.subtitle')}>
        {shows === null ? (
          <p className="hint">{t('grp.loading')}</p>
        ) : upcoming.length === 0 ? (
          <EmptyState title={t('shows.noneTitle')} text={t('shows.noneText')} icon={<IconCalendar />} />
        ) : (
          <ul className="check-list list-unbounded">
            {upcoming.map((s) => (
              <li key={s.id}>
                <span>
                  {s.name}
                  <span className="hint" dir="ltr">
                    {' '}
                    {s.venue}
                    {s.city ? `, ${s.city}` : ''} · {formatDate(s.startsAt, locale)}
                  </span>
                </span>
                <span className="row" style={{ gap: 'var(--sp-2)' }}>
                  {s.open ? (
                    <StatusBadge tone="success">
                      {t('shows.openUntil', { date: formatDate(s.requestDeadline, locale) })}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">{t('shows.closed')}</StatusBadge>
                  )}
                  {s.capacity > 0 && (
                    <span className="hint">{t('shows.capacity', { count: s.capacity })}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="field-hint">{t('shows.consignHint')}</p>
      </Panel>

      {past.length > 0 && (
        <Panel title={t('shows.pastTitle')} subtitle={t('shows.pastSubtitle')}>
          <ul className="check-list list-unbounded">
            {past.map((s) => (
              <li key={s.id}>
                <span>
                  {s.name}
                  <span className="hint" dir="ltr">
                    {' '}
                    {s.venue} · {formatDate(s.startsAt, locale)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

/* ============================================================
   Contact
   ============================================================ */

interface Contact {
  helpdesk: boolean;
  email: string | null;
  phone: string | null;
  hours: string | null;
  team: { name: string; role: string | null }[];
}

interface Location {
  code: string;
  name: string;
  role: string;
  city: string;
  region: string;
  country: string;
  salesTaxPpm: number;
  forwardingDays: number | null;
}

/**
 * How to reach a person.
 *
 * Every published channel comes from configuration, and an unconfigured one is
 * left out rather than shown as a row reading "Not published" — three of those
 * under a heading called Contact read as a company with no way to reach it. The
 * helpdesk is first and unconditional: it works regardless of whether anybody
 * has filled a variable in, and it arrives attached to your account, your items
 * and your codes.
 */
export function ContactPanel() {
  const { t } = useI18n();
  const [contact, setContact] = useState<Contact | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [c, l] = await Promise.all([
          api.get<Contact>('/content/contact'),
          api.get<Location[]>('/content/locations'),
        ]);
        setContact(c);
        setLocations(l);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <>
      {error && <ErrorState message={error} />}

      <Panel title={t('contact.title')} subtitle={t('contact.subtitle')}>
        <div className="stack stack--tight" style={{ maxWidth: 620 }}>
          <div>
            <StatusBadge tone="gold">{t('contact.best')}</StatusBadge>
            <p className="measure" style={{ marginBlockStart: 'var(--sp-2)' }}>
              {t('contact.helpdeskBody')}
            </p>
            <Button
              variant="gold"
              size="sm"
              onClick={() => {
                window.location.hash = '#/support/new';
              }}
            >
              {t('contact.openHelpdesk')}
            </Button>
          </div>

          {/* Only the channels that are actually published. */}
          {(contact?.email || contact?.phone || contact?.hours) && (
            <dl className="detail-list stack-top">
              {contact?.email && (
                <div className="detail-row">
                  <dt className="detail-label">{t('contact.email')}</dt>
                  <dd className="detail-value">
                    <a href={`mailto:${contact.email}`} dir="ltr">
                      {contact.email}
                    </a>
                  </dd>
                </div>
              )}
              {contact?.phone && (
                <div className="detail-row">
                  <dt className="detail-label">{t('contact.phone')}</dt>
                  <dd className="detail-value">
                    <a href={`tel:${contact.phone.replace(/\s+/g, '')}`} dir="ltr">
                      {contact.phone}
                    </a>
                  </dd>
                </div>
              )}
              {contact?.hours && (
                <div className="detail-row">
                  <dt className="detail-label">{t('contact.hours')}</dt>
                  <dd className="detail-value">{contact.hours}</dd>
                </div>
              )}
            </dl>
          )}

          {(contact?.team.length ?? 0) > 0 && (
            <>
              <h3 className="drawer-heading">{t('contact.whoAnswers')}</h3>
              <ul className="check-list list-unbounded">
                {contact!.team.map((person) => (
                  <li key={person.name}>
                    <span>
                      {person.name}
                      {person.role && <span className="hint"> {person.role}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Panel>

      <Panel title={t('contact.whereTitle')} subtitle={t('contact.whereSubtitle')}>
        {locations.length === 0 ? (
          <EmptyState title={t('contact.noLocations')} text={t('contact.noLocationsText')} icon={<IconLocation />} />
        ) : (
          <ul className="check-list list-unbounded">
            {locations.map((l) => (
              <li key={l.code}>
                <span>
                  {l.name}
                  <span className="hint" dir="ltr">
                    {' '}
                    {l.city}, {l.region}, {l.country}
                  </span>
                </span>
                <span className="row" style={{ gap: 'var(--sp-2)' }}>
                  <StatusBadge tone={l.role === 'primary' ? 'gold' : 'info'} plain>
                    {t(`contact.role.${l.role}` as MessageKey)}
                  </StatusBadge>
                  {l.salesTaxPpm === 0 && <StatusBadge tone="success" plain>{t('contact.taxFree')}</StatusBadge>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="field-hint">{t('contact.addressHint')}</p>
      </Panel>
    </>
  );
}
