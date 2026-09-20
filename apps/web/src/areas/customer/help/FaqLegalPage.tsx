import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { formatDate } from '../../../shared/money';
import { useNavigation, useRoute } from '../../../shared/routing';
import {
  Button,
  ContextTabs,
  EmptyState,
  Panel,
  StatusBadge,
  TabPanel,
} from '../../../shared/ui/primitives';
import { IconAsk, IconChevronDown, IconDownload, IconLegal, IconPrint, IconSearch } from '../../../shared/ui/icons';
import {
  FAQ_CATEGORIES,
  FAQ_ENTRIES,
  entryText,
  type FaqBlock,
  type FaqEntry,
  type FaqLocale,
} from './faqContent';
import { answerQuestion, type HelpMatch } from './helpSearch';
import { IntakePolicyPanel } from './IntakePolicyPanel';
import { LEGAL_DOCUMENTS, OPEN_SOURCE_NOTICES, type LegalDocument } from './legalContent';
import { ContactPanel, GuidesPanel, ShowsPanel } from './HelpPanels';
import { PriceListPanel } from './PriceListPanel';

const TABS = ['ask', 'guides', 'faq', 'policy', 'prices', 'shows', 'contact', 'legal'] as const;
type HelpTab = (typeof TABS)[number];

/**
 * Help.
 *
 * Eight contextual tabs on the shared shell: Ask (search across everything
 * below), Guides (workflow walkthroughs), FAQ (Bault's own answers), What we
 * accept, Prices, Shows, Contact and Legal.
 *
 * The tab lives in the route, so a link can open any of them; the FAQ's `q`
 * param deep-links a single answer open and the Guides' `g` param a single
 * guide.
 */
export function FaqLegalPage() {
  const { t } = useI18n();
  const route = useRoute();
  const { goTab } = useNavigation(route);

  const tab: HelpTab = (TABS as readonly string[]).includes(route.tab ?? '')
    ? (route.tab as HelpTab)
    : 'ask';

  const tabs = TABS.map((key) => ({ key, label: t(`faq.tab.${key}` as MessageKey) }));

  return (
    <>
      <ContextTabs label={t('faqLegal.title')} tabs={tabs} active={tab} onSelect={goTab} />

      {tab === 'ask' && (
        <TabPanel tab="ask">
          <AskPanel />
        </TabPanel>
      )}
      {tab === 'guides' && (
        <TabPanel tab="guides">
          <GuidesPanel />
        </TabPanel>
      )}
      {tab === 'faq' && (
        <TabPanel tab="faq">
          <FaqPanel />
        </TabPanel>
      )}
      {/* Sits after the FAQ because it is the answer the FAQ keeps pointing at:
          what may be sent at all. Before the prices, because whether Bault will
          take the thing comes before what keeping it costs. */}
      {tab === 'policy' && <IntakePolicyPanel />}

      {tab === 'prices' && (
        <TabPanel tab="prices">
          <PriceListPanel />
        </TabPanel>
      )}
      {tab === 'shows' && (
        <TabPanel tab="shows">
          <ShowsPanel />
        </TabPanel>
      )}
      {tab === 'contact' && (
        <TabPanel tab="contact">
          <ContactPanel />
        </TabPanel>
      )}
      {tab === 'legal' && (
        <TabPanel tab="legal">
          <LegalPanel />
        </TabPanel>
      )}
    </>
  );
}

/* ============================================================
   Ask
   ============================================================ */

interface Turn {
  id: number;
  question: string;
  matches: HelpMatch[] | null;
}

/**
 * Ask a question, get Bault's own answers.
 *
 * This screen used to be a conversation with a placeholder that replied `#1DDD`
 * to everything — real transcript, real pending state, no answer. It now
 * searches the FAQ and the guides in the browser and shows what matches, with a
 * link into the full answer. Nothing typed here leaves the device, nothing is
 * generated, and every line shown is text Bault wrote.
 */
function AskPanel() {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);

  // Keep the newest turn in view without stealing focus from the input.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const question = draft.trim();
    if (!question || busy) return;
    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, question, matches: null }]);
    setDraft('');
    setBusy(true);
    try {
      const matches = await answerQuestion(question, locale as FaqLocale);
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, matches } : turn)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('faq.ask.title')} subtitle={t('faq.ask.subtitle')}>
      <div className="ask-log" ref={logRef} role="log" aria-live="polite" aria-label={t('faq.ask.logLabel')}>
        {turns.length === 0 ? (
          <EmptyState title={t('faq.ask.emptyTitle')} text={t('faq.ask.emptyText')} icon={<IconAsk />} />
        ) : (
          <ul className="ask-turns">
            {turns.map((turn) => (
              <li key={turn.id} className="ask-turn">
                <p className="ask-bubble ask-bubble--you">
                  <span className="ask-who">{t('faq.ask.you')}</span>
                  {turn.question}
                </p>
                <div className="ask-bubble ask-bubble--bot">
                  <span className="ask-who">{t('faq.ask.assistant')}</span>
                  {turn.matches === null ? (
                    <span className="hint">{t('faq.ask.thinking')}</span>
                  ) : turn.matches.length === 0 ? (
                    <p>
                      {t('faq.ask.noMatch')}{' '}
                      <a href="#/support/new">{t('faq.ask.openTicket')}</a>
                    </p>
                  ) : (
                    <ul className="ask-answers">
                      {turn.matches.map((match) => (
                        <li key={`${match.kind}-${match.id}`}>
                          <a href={match.href} className="ask-answer-title">
                            {match.title}
                          </a>
                          <StatusBadge tone="neutral" plain>
                            {t(match.kind === 'faq' ? 'faq.ask.fromFaq' : 'faq.ask.fromGuide')}
                          </StatusBadge>
                          <p className="hint">{match.excerpt}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form className="ask-form" onSubmit={submit}>
        <label className="field">
          <span className="sr-only">{t('faq.ask.inputLabel')}</span>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('faq.ask.placeholder')}
            aria-label={t('faq.ask.inputLabel')}
          />
        </label>
        <Button type="submit" variant="gold" disabled={!draft.trim() || busy}>
          {t('faq.ask.send')}
        </Button>
      </form>
    </Panel>
  );
}

/* ============================================================
   FAQ
   ============================================================ */

function FaqPanel() {
  const { t, locale } = useI18n();
  const route = useRoute();
  const { openRecord, closeRecord } = useNavigation(route);
  const lang = locale as FaqLocale;

  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('all');

  const openId = route.params.q ?? null;

  // The catalogue is static, so the searchable text is derived once per language.
  const index = useMemo(
    () => new Map(FAQ_ENTRIES.map((e) => [e.id, entryText(e, lang).toLowerCase()])),
    [lang],
  );

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return FAQ_ENTRIES.filter((entry) => {
      if (category !== 'all' && entry.category !== category) return false;
      if (!needle) return true;
      return (index.get(entry.id) ?? '').includes(needle);
    });
  }, [q, category, index]);

  // A deep link may point at an entry the current filter hides. Reveal it rather
  // than opening nothing — the link is the stronger signal of intent.
  useEffect(() => {
    if (!openId) return;
    const entry = FAQ_ENTRIES.find((e) => e.id === openId);
    if (!entry) return;
    setCategory((current) => (current === 'all' || current === entry.category ? current : 'all'));
  }, [openId]);

  const categories = ['all', ...FAQ_CATEGORIES];

  return (
    <>
      <Panel title={t('faq.title')} subtitle={t('faq.subtitle')}>
        <div className="faq-controls">
          <div className="search search--wide">
            <IconSearch />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('faq.searchPlaceholder')}
              aria-label={t('faq.searchLabel')}
            />
          </div>

          <div className="chip-row" role="group" aria-label={t('faq.categoryLabel')}>
            {categories.map((key) => (
              <button
                key={key}
                type="button"
                className={`chip${category === key ? ' is-on' : ''}`}
                aria-pressed={category === key}
                onClick={() => setCategory(key)}
              >
                {key === 'all' ? t('faq.category.all') : t(`faq.category.${key}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title={t('faq.resultsTitle', { count: results.length })} flush>
        {results.length === 0 ? (
          <EmptyState
            title={t('faq.noResults')}
            text={t('faq.noResultsText')}
            icon={<IconSearch />}
            action={
              <Button
                size="sm"
                onClick={() => {
                  setQ('');
                  setCategory('all');
                }}
              >
                {t('faq.clearFilters')}
              </Button>
            }
          />
        ) : (
          <ul className="faq-list">
            {results.map((entry) => (
              <FaqItem
                key={entry.id}
                entry={entry}
                locale={lang}
                open={openId === entry.id}
                onToggle={() => (openId === entry.id ? closeRecord('q') : openRecord('q', entry.id))}
              />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/**
 * One question. A real `<button>` drives the disclosure, so Enter/Space work and
 * screen readers get `aria-expanded` and `aria-controls` for free; the answer
 * region is labelled by its own trigger.
 */
function FaqItem({
  entry,
  locale,
  open,
  onToggle,
}: {
  entry: FaqEntry;
  locale: FaqLocale;
  open: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);

  // A deep-linked answer scrolls itself into view once, on open.
  useEffect(() => {
    if (open) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  return (
    <li className={`faq-item${open ? ' is-open' : ''}`} ref={ref} id={`faq-${entry.id}`}>
      <h3 className="faq-q">
        <button
          type="button"
          className="faq-trigger"
          aria-expanded={open}
          aria-controls={`faq-answer-${entry.id}`}
          id={`faq-trigger-${entry.id}`}
          onClick={onToggle}
        >
          <span className="faq-chevron" aria-hidden="true">
            <IconChevronDown />
          </span>
          <span className="faq-q-text">{entry.question[locale]}</span>
        </button>
      </h3>

      <div
        id={`faq-answer-${entry.id}`}
        role="region"
        aria-labelledby={`faq-trigger-${entry.id}`}
        className="faq-a"
        hidden={!open}
      >
        {entry.answer[locale].map((block, i) => (
          <FaqBlockView key={i} block={block} />
        ))}
      </div>
    </li>
  );
}

function FaqBlockView({ block }: { block: FaqBlock }) {
  if (block.kind === 'p') return <p>{renderInline(block.text)}</p>;
  return (
    <ul>
      {block.items.map((item, i) => (
        <li key={i}>{renderInline(item)}</li>
      ))}
    </ul>
  );
}

/**
 * Render the two inline markers the content carries: `**bold**` and
 * `[[label|href]]`. Deliberately not a Markdown parser and deliberately not
 * `dangerouslySetInnerHTML` — everything is rendered as React nodes and can
 * never inject markup. A link into the app stays in this tab; anything else
 * opens in a new one.
 */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[\[([^|\]]*)\|([^\]]*)\]\]|\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[3] !== undefined) {
      nodes.push(<strong key={key++}>{match[3]}</strong>);
    } else {
      const label = (match[1] ?? '').replace(/\*\*/g, '');
      const href = match[2] ?? '';
      const internal = href.startsWith('#');
      nodes.push(
        <a
          key={key++}
          href={href}
          target={internal ? undefined : '_blank'}
          rel={internal ? undefined : 'noreferrer noopener'}
        >
          {label}
        </a>,
      );
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/* ============================================================
   Legal
   ============================================================ */

function LegalPanel() {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [docId, setDocId] = useState(LEGAL_DOCUMENTS[0]?.id ?? '');

  const doc = LEGAL_DOCUMENTS.find((d) => d.id === docId) ?? LEGAL_DOCUMENTS[0];

  const needle = q.trim().toLowerCase();
  const sections = useMemo(() => {
    if (!doc) return [];
    if (!needle) return doc.sections;
    return doc.sections.filter(
      (s) => s.heading.toLowerCase().includes(needle) || s.body.toLowerCase().includes(needle),
    );
  }, [doc, needle]);

  const print = useCallback(() => window.print(), []);

  if (!doc) return null;

  return (
    <>
      {/* One sentence, not a list of documents that do not exist. The policy
          below IS in force, and support answers anything it does not cover. */}
      <Panel title={t('legal.pendingTitle')}>
        <p className="measure">{t('legal.pendingBody')}</p>
        <div className="row">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              window.location.hash = '#/support/new';
            }}
          >
            {t('contact.openHelpdesk')}
          </Button>
        </div>
      </Panel>

      <Panel
        title={doc.title}
        subtitle={t(doc.provenance as MessageKey)}
        tools={
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <Button size="sm" variant="secondary" icon={<IconPrint />} onClick={print}>
              {t('legal.print')}
            </Button>
            {doc.downloadPath && (
              <Button
                size="sm"
                variant="secondary"
                icon={<IconDownload />}
                onClick={() => window.open(doc.downloadPath ?? '', '_blank', 'noopener')}
              >
                {t('legal.download')}
              </Button>
            )}
          </div>
        }
      >
        <p className="hint">{t('legal.lastUpdated', { date: formatDate(doc.lastUpdated, locale) })}</p>

        {LEGAL_DOCUMENTS.length > 1 && (
          <div className="chip-row" role="group" aria-label={t('legal.documentLabel')}>
            {LEGAL_DOCUMENTS.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`chip${d.id === docId ? ' is-on' : ''}`}
                aria-pressed={d.id === docId}
                onClick={() => setDocId(d.id)}
              >
                {d.title}
              </button>
            ))}
          </div>
        )}

        <div className="search search--wide stack-top">
          <IconSearch />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('legal.searchPlaceholder')}
            aria-label={t('legal.searchLabel')}
          />
        </div>

        <div className="legal-body">
          <nav className="legal-toc" aria-label={t('legal.tocLabel')}>
            <h3 className="legal-toc-title">{t('legal.toc')}</h3>
            <ol>
              {doc.sections.map((section) => (
                <li key={section.id}>
                  {/* Scrolled to in place: an `#legal-…` href is a route to the hash
                      router, which sent it to the Vault as an unknown section. */}
                  <a
                    href={`#legal-${section.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(`legal-${section.id}`)?.scrollIntoView({ block: 'start' });
                    }}
                  >
                    {section.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="legal-text" lang="en" dir="ltr">
            {sections.length === 0 ? (
              <EmptyState title={t('legal.noMatches')} icon={<IconLegal />} />
            ) : (
              sections.map((section) => (
                <section key={section.id} id={`legal-${section.id}`} className="legal-section">
                  <h3>{section.heading}</h3>
                  <pre className="legal-pre">{section.body}</pre>
                </section>
              ))
            )}
          </div>
        </div>
      </Panel>

      <OpenSourceNotices t={t} />
    </>
  );
}

/**
 * The licences of software bundled with Bault. They are notices, not terms —
 * the font licence was sitting beside the account policy as though a collector
 * had agreed to it.
 */
function OpenSourceNotices({ t }: { t: TranslateFn }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Panel title={t('legal.openSource.title')} subtitle={t('legal.openSource.subtitle')}>
      <ul className="check-list list-unbounded">
        {OPEN_SOURCE_NOTICES.map((notice: LegalDocument) => (
          <li key={notice.id}>
            <span>{notice.title}</span>
            <span className="row" style={{ gap: 'var(--sp-2)' }}>
              {notice.downloadPath && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<IconDownload />}
                  onClick={() => window.open(notice.downloadPath ?? '', '_blank', 'noopener')}
                >
                  {t('legal.download')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setOpenId((current) => (current === notice.id ? null : notice.id))}
              >
                {t(openId === notice.id ? 'legal.openSource.hide' : 'legal.openSource.read')}
              </Button>
            </span>
          </li>
        ))}
      </ul>

      {OPEN_SOURCE_NOTICES.filter((n) => n.id === openId).map((notice) => (
        <div key={notice.id} className="legal-text stack-top" lang="en" dir="ltr">
          {notice.sections.map((section) => (
            <section key={section.id} className="legal-section">
              <h3>{section.heading}</h3>
              <pre className="legal-pre">{section.body}</pre>
            </section>
          ))}
        </div>
      ))}
    </Panel>
  );
}
