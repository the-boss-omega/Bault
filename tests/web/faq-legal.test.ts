import { describe, it, expect } from 'vitest';
import {
  FAQ_CATEGORIES,
  FAQ_ENTRIES,
  entryText,
  plainText,
} from '../../apps/web/src/areas/customer/help/faqContent';
import { GUIDES, guideText } from '../../apps/web/src/areas/customer/help/guideContent';
import { answerQuestion, searchHelp } from '../../apps/web/src/areas/customer/help/helpSearch';
import {
  LEGAL_DOCUMENTS,
  OPEN_SOURCE_NOTICES,
} from '../../apps/web/src/areas/customer/help/legalContent';

const LOCALES = ['en', 'he'] as const;

/**
 * Help content, and the search that answers Ask.
 *
 * The FAQ used to be another company's, copied verbatim and badged per entry
 * with whether Bault did the same; Ask replied `#1DDD` to everything. The tests
 * that pinned those two facts are gone with them, and what is pinned now is the
 * property that replaced them: every answer is Bault's own, says something in
 * both languages, and can be found by asking for it.
 */
describe('the FAQ is Bault’s own', () => {
  it('has enough answers to be worth a tab', () => {
    expect(FAQ_ENTRIES.length).toBeGreaterThanOrEqual(20);
  });

  it('gives every entry a unique, stable deep-link id', () => {
    const ids = FAQ_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('files every entry under a known category', () => {
    for (const entry of FAQ_ENTRIES) expect(FAQ_CATEGORIES).toContain(entry.category);
  });

  it('answers in both languages, never leaving one empty', () => {
    for (const entry of FAQ_ENTRIES) {
      for (const locale of LOCALES) {
        expect(entry.question[locale].trim(), `${entry.id} has no ${locale} question`).not.toBe('');
        expect(entry.answer[locale].length, `${entry.id} has no ${locale} answer`).toBeGreaterThan(0);
        expect(entryText(entry, locale).length).toBeGreaterThan(80);
      }
      // A Hebrew answer that is byte-identical to the English one was never
      // translated. (Both may quote the same figures, so compare the whole text.)
      expect(entryText(entry, 'he'), `${entry.id} is not translated`).not.toBe(entryText(entry, 'en'));
    }
  });

  it('never names the company it used to quote', () => {
    const all = JSON.stringify(FAQ_ENTRIES) + JSON.stringify(GUIDES);
    expect(all).not.toMatch(/ship\s*my\s*cards/i);
  });

  it('links only to screens this app has', () => {
    // Every `[[label|href]]` that starts with `#` is an in-app route, and a link
    // to a section the router does not have would send the reader to the vault.
    const sections = new Set([
      'vault', 'inbound', 'marketplace', 'shipping-services', 'wallet', 'membership',
      'notifications', 'support', 'faq', 'profile', 'warehouse', 'admin', 'signin', 'signup',
    ]);
    const hrefs = [...JSON.stringify(FAQ_ENTRIES).matchAll(/\[\[[^|\]]*\|(#[^\]"]*)\]\]/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThan(5);
    for (const href of hrefs) {
      const section = href.replace(/^#\//, '').split(/[/?]/)[0]!;
      expect(sections, `${href} is not a section`).toContain(section);
    }
  });

  it('drops the inline markers when it flattens text for search', () => {
    expect(plainText('see [[the wallet|#/wallet/cash-in]] and **this**')).toBe('see the wallet and this');
  });
});

describe('the guides are bilingual too', () => {
  it('carries both languages for every title, summary and step', () => {
    for (const g of GUIDES) {
      for (const locale of LOCALES) {
        expect(g.title[locale].trim(), `${g.id} has no ${locale} title`).not.toBe('');
        expect(g.summary[locale].trim()).not.toBe('');
        for (const step of g.steps) expect(step.text[locale].trim()).not.toBe('');
      }
      expect(guideText(g, 'he'), `${g.id} is not translated`).not.toBe(guideText(g, 'en'));
    }
  });

  it('points every step that names a screen at a hash route', () => {
    for (const g of GUIDES) {
      for (const step of g.steps) {
        if (step.route) expect(step.route).toMatch(/^#\//);
      }
    }
  });
});

describe('Ask searches the help, in the browser', () => {
  it('finds the storage answer from a question about storage', async () => {
    const matches = await answerQuestion('how much does storage cost?', 'en');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.map((m) => m.id)).toContain('storage');
    expect(matches[0]!.href).toMatch(/^#\//);
  });

  it('answers in Hebrew when the reader is in Hebrew', async () => {
    const matches = await answerQuestion('כמה עולה אחסון', 'he');
    expect(matches.map((m) => m.id)).toContain('storage');
    // The title shown is the Hebrew one.
    expect(matches[0]!.title).toMatch(/[֐-׿]/);
  });

  it('finds a guide when the question is about doing something', () => {
    const matches = searchHelp('ship cards home', 'en', 5);
    expect(matches.some((m) => m.kind === 'guide')).toBe(true);
  });

  it('returns nothing for a question the help does not answer', async () => {
    expect(await answerQuestion('quantum chromodynamics', 'en')).toEqual([]);
    // …and nothing at all for a query that is only noise.
    expect(await answerQuestion('   ', 'en')).toEqual([]);
    expect(await answerQuestion('how is it?', 'en')).toEqual([]);
  });

  it('never returns more than it was asked for', () => {
    expect(searchHelp('card', 'en', 3).length).toBeLessThanOrEqual(3);
  });

  it('is a promise, so a real assistant can be dropped in unchanged', () => {
    expect(answerQuestion('anything', 'en')).toBeInstanceOf(Promise);
  });
});

describe('Legal documents', () => {
  it('publishes only text that genuinely governs Bault', () => {
    expect(LEGAL_DOCUMENTS.length).toBeGreaterThan(0);
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.sections.length).toBeGreaterThan(0);
      for (const section of doc.sections) {
        expect(section.id).toMatch(/^[a-z0-9-]+$/);
        expect(section.body.trim()).not.toBe('');
      }
    }
  });

  it('keeps the font licence as a notice, not as a customer agreement', () => {
    // Reproducing it is a condition of using the font, so it is still shipped —
    // under Open-source notices, where nobody reads it as terms they accepted.
    expect(LEGAL_DOCUMENTS.some((d) => d.id === 'ofl-1-1')).toBe(false);
    const ofl = OPEN_SOURCE_NOTICES.find((d) => d.id === 'ofl-1-1');
    expect(ofl).toBeDefined();
    const text = ofl!.sections.map((s) => s.body).join('\n');
    expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(text).toContain('THE FONT SOFTWARE IS PROVIDED "AS IS"');
    expect(ofl!.downloadPath).toBe('/fonts/OFL.txt');
  });
});
