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
import { FAQ, type FaqBlock, type FaqEntry } from './faqContent';
import { LEGAL_DOCUMENTS, PENDING_DOCUMENTS } from './legalContent';
import { ContactPanel, GuidesPanel, ShowsPanel } from './HelpPanels';
import { PriceListPanel } from './PriceListPanel';

const TABS = ['ask', 'guides', 'faq', 'prices', 'shows', 'contact', 'legal'] as const;
type HelpTab = (typeof TABS)[number];

/**
 * FAQ & Legal.
 *
 * Six contextual tabs on the shared shell: Ask (the placeholder assistant),
 * Guides (Bault's own workflow walkthroughs), FAQ (the copied Ship My Cards
 * content), Shows (the card-show calendar, from real rows), Contact (how to
 * reach a person) and Legal Terms (the documents that genuinely govern Bault).
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

/**
 * The single seam a real assistant will be wired into.
 *
 * Every query resolves to exactly `#1DDD` and nothing else — no answer text, no
 * heuristics, no lookup against the FAQ. It is deliberately `async` and
 * deliberately ignores its argument so that swapping the body for a real call is
 * the only change needed at the integration point; every caller already awaits
 * it and already handles a pending state.
 *
 * It performs NO network request. That is a requirement of this placeholder, not
 * an implementation detail: nothing typed into Ask leaves the browser.
 */
export async function answerQuestion(_query: string): Promise<string> {
  return '#1DDD';
}

interface Turn {
  id: number;
  question: string;
  answer: string | null;
}

/**
 * A conversation surface that is real UI on a placeholder brain: the transcript,
 * the pending state, the keyboard handling and the live region are all what the
 * connected version will use. Only `answerQuestion` changes.
 */
function AskPanel() {
  const { t } = useI18n();
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
    setTurns((prev) => [...prev, { id, question, answer: null }]);
    setDraft('');
    setBusy(true);
    try {
      const answer = await answerQuestion(question);
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, answer } : turn)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t('faq.ask.title')} subtitle={t('faq.ask.subtitle')}>
      {/* Unobtrusive, but never hidden: the assistant is not connected, and a
          user should know that before they read its reply as an answer. */}
      <p className="ask-notice" role="note">
        <IconAsk />
        <span>{t('faq.ask.notConnected')}</span>
      </p>

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
                <p className="ask-bubble ask-bubble--bot">
                  <span className="ask-who">{t('faq.ask.assistant')}</span>
                  {turn.answer === null ? (
                    <span className="hint">{t('faq.ask.thinking')}</span>
                  ) : (
                    <code dir="ltr">{turn.answer}</code>
                  )}
                </p>
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

/** Flatten an entry to the plain text the search matches against. */
function searchableText(entry: FaqEntry): string {
  const parts: string[] = [entry.question, entry.category];
  for (const block of entry.blocks) {
    if (block.kind === 'ul') {
      for (const li of block.items) {
        parts.push(li.text, ...(li.items ?? []));
      }
    } else {
      parts.push(block.text);
    }
  }
  return parts.join(' \n ').toLowerCase();
}

// Built once: the catalogue is static, so re-deriving it per keystroke is waste.
const SEARCH_INDEX = new Map(FAQ.entries.map((e) => [e.id, searchableText(e)]));

function FaqPanel() {
  const { t, locale } = useI18n();
  const route = useRoute();
  const { openRecord, closeRecord } = useNavigation(route);

  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('all');
  // The imported catalogue is mostly ShipMyCards workflows Bault does not have.
  // Default to the entries that describe something Bault actually does, and let
  // the reader opt into the full copied source set.
  const [showAll, setShowAll] = useState(false);

  const openId = route.params.q ?? null;

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return FAQ.entries.filter((entry) => {
      if (!showAll && entry.availability !== 'adapted') return false;
      if (category !== 'all' && entry.category !== category) return false;
      if (!needle) return true;
      return (SEARCH_INDEX.get(entry.id) ?? '').includes(needle);
    });
  }, [q, category, showAll]);

  // A deep link may point at an entry the current filters hide. Reveal it rather
  // than opening nothing — the link is the stronger signal of intent.
  useEffect(() => {
    if (!openId) return;
    const entry = FAQ.entries.find((e) => e.id === openId);
    if (!entry) return;
    if (entry.availability !== 'adapted') setShowAll(true);
    setCategory((current) => (current === 'all' || current === entry.category ? current : 'all'));
  }, [openId]);

  const categories = ['all', ...FAQ.categoryOrder];

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

          <label className="check">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            {t('faq.showAll')}
          </label>
        </div>

        {/*
          The provenance notice.

          This catalogue is third-party text reproduced verbatim, and it stays
          that way: the brand rename to Bault covered the product's own strings
          and deliberately did NOT rewrite quoted copy. Renaming inside a
          quotation would attribute another company's policies — and services
          Bault's own badges say it does not offer — to Bault.

          So the notice is stated as a quotation, above the entries rather than
          below them, and carries the source link.
        */}
        <p className="infobox faq-source">
          {t('faq.sourceNote', { count: FAQ.source.entryCount, date: formatDate(FAQ.source.retrieved, locale) })}{' '}
          <a href={FAQ.source.url} target="_blank" rel="noreferrer noopener" dir="ltr">
            {FAQ.source.url}
          </a>
        </p>
        <p className="hint">{t('faq.quotedNotice')}</p>
      </Panel>

      <Panel title={t('faq.resultsTitle', { count: results.length })} flush>
        {results.length === 0 ? (
          <EmptyState
            title={t('faq.noResults')}
            text={t('faq.noResultsText')}
            icon={<IconSearch />}
            action={
              <Button size="sm" onClick={() => { setQ(''); setCategory('all'); setShowAll(true); }}>
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
                open={openId === entry.id}
                t={t}
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
  open,
  onToggle,
  t,
}: {
  entry: FaqEntry;
  open: boolean;
  onToggle: () => void;
  t: TranslateFn;
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
          <span className="faq-q-text" lang="en" dir="ltr">
            {entry.question}
          </span>
          <StatusBadge tone={entry.availability === 'adapted' ? 'info' : 'neutral'} plain>
            {t(entry.availability === 'adapted' ? 'faq.badge.adapted' : 'faq.badge.unavailable')}
          </StatusBadge>
        </button>
      </h3>

      <div
        id={`faq-answer-${entry.id}`}
        role="region"
        aria-labelledby={`faq-trigger-${entry.id}`}
        className="faq-a"
        hidden={!open}
      >
        {/* Bault's own note comes FIRST: the copied answer below it describes
            another company's service, and the reader needs that framing before
            they read it as Bault policy. */}
        <p className={`faq-note faq-note--${entry.availability}`}>
          <strong>
            {t(entry.availability === 'adapted' ? 'faq.note.adaptedTitle' : 'faq.note.unavailableTitle')}
          </strong>{' '}
          {entry.baultNote}
        </p>

        {/* The copied source answer, verbatim. Held in English and LTR
            regardless of the app locale — translating published policy text
            would change what it says. */}
        <div className="faq-source-answer" lang="en" dir="ltr">
          {entry.blocks.map((block, i) => (
            <FaqBlockView key={i} block={block} />
          ))}
        </div>
      </div>
    </li>
  );
}

function FaqBlockView({ block }: { block: FaqBlock }) {
  if (block.kind === 'p') return <p>{renderInline(block.text)}</p>;
  if (block.kind === 'h') {
    // Source levels start at h4 inside an accordion; clamp so the page's own
    // heading order is not broken by the copied content.
    const Tag = (block.level >= 5 ? 'h5' : 'h4') as 'h4' | 'h5';
    return <Tag>{renderInline(block.text)}</Tag>;
  }
  return (
    <ul>
      {block.items.map((item, i) => (
        <li key={i}>
          {renderInline(item.text)}
          {item.items && item.items.length > 0 && (
            <ul>
              {item.items.map((sub, j) => (
                <li key={j}>{renderInline(sub)}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Render the two inline markers the extracted content carries: `**bold**` and
 * `[[label|url]]`. Deliberately not a Markdown parser and deliberately not
 * `dangerouslySetInnerHTML` — the source is third-party text, so it is rendered
 * as React nodes and can never inject markup.
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
      nodes.push(
        <a key={key++} href={href} target="_blank" rel="noreferrer noopener">
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
      {/* Said plainly and first: Bault's own terms do not exist yet, so nobody
          mistakes the licence below for an agreement with Bault. */}
      <Panel title={t('legal.pendingTitle')} subtitle={t('legal.pendingSubtitle')}>
        <ul className="legal-pending">
          {PENDING_DOCUMENTS.map((key) => (
            <li key={key}>
              <StatusBadge tone="warning" plain>
                {t('legal.notPublished')}
              </StatusBadge>
              <span>{t(key as MessageKey)}</span>
            </li>
          ))}
        </ul>
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
        <p className="hint">
          {t('legal.lastUpdated', { date: formatDate(doc.lastUpdated, locale) })}
        </p>

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

        <div className="search search--wide" style={{ marginBlockStart: 'var(--sp-4)' }}>
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
                  <a href={`#legal-${section.id}`}>{section.heading}</a>
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
    </>
  );
}
