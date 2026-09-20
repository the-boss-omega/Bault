import { FAQ_ENTRIES, entryText, plainText, type FaqEntry, type FaqLocale } from './faqContent';
import { GUIDES, guideText, type Guide } from './guideContent';

/**
 * Ask, answered from Bault's own help — in the browser, with no network call.
 *
 * A question is matched against the FAQ and the guides in the reader's language
 * and the best few are returned with a link to each. Nothing typed into Ask
 * leaves the device, and nothing is generated: every answer shown is text Bault
 * wrote and checked, which is the property that matters for a help screen about
 * money and custody.
 *
 * `answerQuestion` stays the single seam and stays `async`, so an assistant can
 * replace the matcher later without touching the screen that awaits it.
 */

export interface HelpMatch {
  kind: 'faq' | 'guide';
  id: string;
  title: string;
  /** The first paragraph of the answer, or the guide's summary, as plain text. */
  excerpt: string;
  href: string;
}

/** Words that say nothing about what is being asked. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'do', 'does', 'did', 'i', 'my', 'me', 'you', 'your', 'can', 'how', 'what',
  'when', 'where', 'why', 'which', 'who', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'it', 'be', 'with',
  'at', 'if', 'there', 'this', 'that', 'much', 'many', 'get', 'will', 'should', 'would',
  'מה', 'איך', 'למה', 'מתי', 'איפה', 'האם', 'של', 'את', 'על', 'עם', 'זה', 'זו', 'אני', 'שלי', 'אפשר',
  'יש', 'כמה', 'או', 'גם', 'לי', 'הוא', 'היא', 'אם', 'כן', 'לא',
]);

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * How well a text answers the terms.
 *
 * Counted per TERM, not per occurrence: an answer that mentions one word of the
 * question five times used to beat the answer whose title is the question. A
 * term in the title is worth more than the same term buried in the body, and
 * matching is by substring, which is what lets a Hebrew word match with its
 * attached prefix ("לארנק" finds "ארנק").
 */
function score(title: string, body: string, words: string[]): number {
  const t = title.toLowerCase();
  const b = body.toLowerCase();
  let matched = 0;
  let inTitle = 0;
  for (const w of words) {
    if (t.includes(w)) {
      inTitle += 1;
      matched += 1;
    } else if (b.includes(w)) {
      matched += 1;
    }
  }
  return matched === 0 ? 0 : matched * 3 + inTitle * 5;
}

function faqExcerpt(entry: FaqEntry, locale: FaqLocale): string {
  const first = entry.answer[locale][0];
  if (!first) return '';
  return first.kind === 'p' ? plainText(first.text) : first.items.map(plainText).join(' · ');
}

function faqMatch(entry: FaqEntry, locale: FaqLocale): HelpMatch {
  return {
    kind: 'faq',
    id: entry.id,
    title: entry.question[locale],
    excerpt: faqExcerpt(entry, locale),
    href: `#/faq/faq?q=${entry.id}`,
  };
}

function guideMatch(g: Guide, locale: FaqLocale): HelpMatch {
  return { kind: 'guide', id: g.id, title: g.title[locale], excerpt: g.summary[locale], href: `#/faq/guides?g=${g.id}` };
}

/** The best matches for a question, best first. Empty when nothing matches. */
export function searchHelp(query: string, locale: FaqLocale, limit = 3): HelpMatch[] {
  const words = terms(query);
  if (words.length === 0) return [];
  const scored: { s: number; m: HelpMatch }[] = [];
  for (const entry of FAQ_ENTRIES) {
    // Scored in the reader's language, and in the other one at a discount, so a
    // Hebrew reader who types "storage" still finds the storage answer.
    const s = Math.max(
      score(entry.question[locale], entryText(entry, locale), words),
      score(entry.question[locale === 'en' ? 'he' : 'en'], entryText(entry, locale === 'en' ? 'he' : 'en'), words) * 0.8,
    );
    if (s > 0) scored.push({ s: s + 0.5, m: faqMatch(entry, locale) }); // FAQ first on a tie: it is the direct answer
  }
  for (const g of GUIDES) {
    const s = Math.max(
      score(g.title[locale], guideText(g, locale), words),
      score(g.title[locale === 'en' ? 'he' : 'en'], guideText(g, locale === 'en' ? 'he' : 'en'), words) * 0.8,
    );
    if (s > 0) scored.push({ s, m: guideMatch(g, locale) });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.m);
}

/**
 * The single seam an assistant would be wired into. Deliberately async; it
 * performs no network request.
 */
export async function answerQuestion(query: string, locale: FaqLocale = 'en'): Promise<HelpMatch[]> {
  return searchHelp(query, locale);
}
