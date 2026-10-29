import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { bpsToPercent, formatDate, formatUsd, isolateLtr } from '../../../shared/money';
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
import { Amount } from '../../../shared/ui/Serial';
import { ENGLISH } from './english';
import { FAQ, type FaqAvailability, type FaqBlock, type FaqEntry } from './faqContent';
import { IntakePolicyPanel } from './IntakePolicyPanel';
import { LEGAL_DOCUMENTS } from './legalContent';
import { DraftBanner } from './LegalDocumentView';
import { ContactPanel, GuidesPanel, ShowsPanel } from './HelpPanels';
import { PriceListPanel } from './PriceListPanel';

const HAS_UNAVAILABLE = FAQ.entries.some((e) => e.availability === 'unavailable');

const AVAILABILITY_TONE: Record<FaqAvailability, 'info' | 'warning' | 'neutral'> = {
  adapted: 'info',
  partial: 'warning',
  unavailable: 'neutral',
};

const AVAILABILITY_BADGE: Record<FaqAvailability, MessageKey> = {
  adapted: 'faq.badge.adapted',
  partial: 'faq.badge.partial',
  unavailable: 'faq.badge.unavailable',
};

const AVAILABILITY_NOTE: Record<FaqAvailability, MessageKey> = {
  adapted: 'faq.note.adaptedTitle',
  partial: 'faq.note.partialTitle',
  unavailable: 'faq.note.unavailableTitle',
};

const TABS = ['ask', 'guides', 'faq', 'policy', 'prices', 'shows', 'contact', 'legal'] as const;
type HelpTab = (typeof TABS)[number];

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
      {tab === 'policy' && (
        <TabPanel tab="policy">
          <IntakePolicyPanel />
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

export async function answerQuestion(_query: string): Promise<string> {
  return '#1DDD';
}

interface Turn {
  id: number;
  question: string;
  answer: string | null;
}

function AskPanel() {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);

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
      <div className="ask-log" ref={logRef} role="log" aria-live="polite" aria-label={t('faq.ask.logLabel')}>
        {turns.length === 0 ? (
          <EmptyState title={t('faq.ask.emptyTitle')} text={t('faq.ask.emptyText')} icon={<IconAsk />} />
        ) : (
          <ul className="ask-turns">
            {turns.map((turn) => (
              <li key={turn.id} className="ask-turn">
                <p className="ask-slip ask-slip--you">
                  <span className="ask-who">{t('faq.ask.you')}</span>
                  <span className="ask-words" dir="auto">
                    {turn.question}
                  </span>
                </p>
                <p className="ask-slip ask-slip--bot">
                  <span className="ask-who">{t('faq.ask.assistant')}</span>
                  {turn.answer === null ? (
                    <span className="ask-words">{t('faq.ask.thinking')}</span>
                  ) : (
                    <code className="ask-words" dir="ltr">
                      {turn.answer}
                    </code>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The question is written on a slip of its own, and the slip says what an answer is worth before it is sent. */}
      <form className="ask-composer" onSubmit={submit}>
        <label className="ask-composer-label" htmlFor="ask-question">
          {t('faq.ask.inputLabel')}
        </label>
        <div className="ask-composer-row">
          <input
            id="ask-question"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('faq.ask.placeholder')}
            dir="auto"
            autoComplete="off"
            aria-describedby="ask-question-note"
          />
          <Button type="submit" variant="primary" disabled={!draft.trim() || busy}>
            {t('faq.ask.send')}
          </Button>
        </div>
        <p className="ask-composer-note" id="ask-question-note">
          <IconAsk />
          <span>{t('faq.ask.notConnected')}</span>
        </p>
      </form>
    </Panel>
  );
}

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

const SEARCH_INDEX = new Map(FAQ.entries.map((e) => [e.id, searchableText(e)]));

function FaqPanel() {
  const { t, locale } = useI18n();
  const route = useRoute();
  const { openRecord, closeRecord } = useNavigation(route);

  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [showAll, setShowAll] = useState(false);

  const openId = route.params.q ?? null;

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return FAQ.entries.filter((entry) => {
      if (!showAll && entry.availability === 'unavailable') return false;
      if (category !== 'all' && entry.category !== category) return false;
      if (!needle) return true;
      return (SEARCH_INDEX.get(entry.id) ?? '').includes(needle);
    });
  }, [q, category, showAll]);

  useEffect(() => {
    if (!openId) return;
    const entry = FAQ.entries.find((e) => e.id === openId);
    if (!entry) return;
    if (entry.availability === 'unavailable') setShowAll(true);
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

          {HAS_UNAVAILABLE && (
            <label className="check">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              {t('faq.showAll')}
            </label>
          )}
        </div>

        <p className="infobox faq-source">
          {t('faq.reviewedNote', { count: FAQ.reviewed.entryCount, date: formatDate(FAQ.reviewed.date, locale) })}
        </p>
        <p className="hint">{t('faq.ownNotice')}</p>
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
          <span className="faq-q-text" {...ENGLISH}>
            {entry.question}
          </span>
          <StatusBadge tone={AVAILABILITY_TONE[entry.availability]} plain>
            {t(AVAILABILITY_BADGE[entry.availability])}
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
        <p className={`faq-note faq-note--${entry.availability}`} {...ENGLISH}>
          <strong>
            {t(AVAILABILITY_NOTE[entry.availability])}
          </strong>{' '}
          {entry.baultNote}
        </p>

        <div className="faq-source-answer" {...ENGLISH}>
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
      if (href.startsWith('#/')) {
        nodes.push(
          <a key={key++} href={href}>
            {label}
          </a>,
        );
      } else if (href.startsWith('https://')) {
        nodes.push(
          <a key={key++} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>,
        );
      } else {
        nodes.push(label);
      }
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

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
      <CurrentFiguresPanel />

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
        {doc.draft && <DraftBanner doc={doc} />}
        <p className="hint">
          {t('legal.lastUpdated', { date: formatDate(doc.lastUpdated, locale) })}
          {doc.version && <> · {t('legal.version', { version: isolateLtr(doc.version) })}</>}
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
                <span {...ENGLISH}>{d.title}</span>
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
            {/* The headings are the document's, in its language, and carry their own numbers. */}
            <ol {...ENGLISH}>
              {doc.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#legal-${section.id}`}>{section.heading}</a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="legal-text" {...ENGLISH}>
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

export interface AccountTerms {
  termsVersion: string;
  debt: { graceDays: number; interestBpsPerDay: number; suspendBelowMinor: number };
  cashOut: { bandMinor: number; smallBps: number; smallMinimumMinor: number; largeFixedMinor: number; largeBps: number };
  chargebackFeeMinor: number;
  escrow: { feeBps: number; minimumFeeMinor: number; minimumValueMinor: number };
  shipping: {
    restockingFeeMinor: number;
    paymentWindowDays: number;
    insurancePremiumBps: number;
    insuranceMinimumPremiumMinor: number;
    maxInsuredValueMinor: number;
    signatureRequiredAboveMinor: number;
  };
  removeCommonsWindowDays: number;
}

function CurrentFiguresPanel() {
  const { t } = useI18n();
  const [terms, setTerms] = useState<AccountTerms | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .get<AccountTerms>('/content/account-terms')
      .then((value) => {
        if (live) setTerms(value);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // A figure on its own is an Amount, drawn left to right whatever the page reads: the suspension
  // threshold is negative, and in Hebrew a bare "-$20.00" is drawn with its minus after the number.
  const rows: Array<[string, ReactNode]> = terms
    ? [
        [t('legal.figures.graceDays'), t('legal.figures.days', { days: terms.debt.graceDays })],
        [t('legal.figures.interest'), t('legal.figures.perDay', { rate: bpsToPercent(terms.debt.interestBpsPerDay) })],
        [t('legal.figures.suspend'), <Amount>{formatUsd(terms.debt.suspendBelowMinor)}</Amount>],
        [
          t('legal.figures.cashOut'),
          t('legal.figures.cashOutValue', {
            smallPct: bpsToPercent(terms.cashOut.smallBps),
            min: formatUsd(terms.cashOut.smallMinimumMinor),
            band: formatUsd(terms.cashOut.bandMinor),
            fixed: formatUsd(terms.cashOut.largeFixedMinor),
            largePct: bpsToPercent(terms.cashOut.largeBps),
          }),
        ],
        [t('legal.figures.chargeback'), <Amount>{formatUsd(terms.chargebackFeeMinor)}</Amount>],
        [t('legal.figures.restocking'), <Amount>{formatUsd(terms.shipping.restockingFeeMinor)}</Amount>],
        [t('legal.figures.paymentWindow'), t('legal.figures.days', { days: terms.shipping.paymentWindowDays })],
        [
          t('legal.figures.insurance'),
          t('legal.figures.insuranceValue', {
            max: formatUsd(terms.shipping.maxInsuredValueMinor),
            pct: bpsToPercent(terms.shipping.insurancePremiumBps),
            min: formatUsd(terms.shipping.insuranceMinimumPremiumMinor),
            sig: formatUsd(terms.shipping.signatureRequiredAboveMinor),
          }),
        ],
        [
          t('legal.figures.escrow'),
          t('legal.figures.escrowValue', {
            pct: bpsToPercent(terms.escrow.feeBps),
            min: formatUsd(terms.escrow.minimumFeeMinor),
            floor: formatUsd(terms.escrow.minimumValueMinor),
          }),
        ],
        // A version is a code (2026-10-draft-1): in a right-to-left line its numbers and its word swap places.
        [t('legal.figures.termsVersion'), isolateLtr(terms.termsVersion)],
      ]
    : [];

  return (
    <Panel title={t('legal.figures.title')} subtitle={t('legal.figures.subtitle')}>
      {failed ? (
        <p className="hint">{t('legal.figures.unavailable')}</p>
      ) : !terms ? (
        <p className="hint">{t('legal.figures.loading')}</p>
      ) : (
        <dl className="legal-figures">
          {rows.map(([label, value]) => (
            <div key={label} className="legal-figure">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="hint">{t('legal.figures.prices')}</p>
    </Panel>
  );
}
