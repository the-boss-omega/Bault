import { describe, it, expect } from 'vitest';
import { LOCALES, t, type Locale, type MessageKey, type MessageVars } from '../../apps/web/src/shared/i18n';
import { departureLabel, type Departure } from '../../apps/web/src/shared/itemTimeline';

const HEBREW = /[֐-׿]/;

const EVERY_KIND: Departure[] = [
  { kind: 'shipped', code: null },
  { kind: 'donated', code: null },
  { kind: 'discarded', code: null },
  { kind: 'consigned', code: null },
  { kind: 'buyout', code: null },
  { kind: 'sold', code: null },
  { kind: 'gift', code: null },
  { kind: 'swap', code: null },
  { kind: 'escrow', code: 'ESC-4K7Q2' },
  { kind: 'left', code: null },
];

function label(locale: Locale, departure: Departure): string {
  const tr = (key: MessageKey, vars?: MessageVars) => t(key, locale, vars);
  return departureLabel(tr, departure).replace(/[⁨⁩]/g, '');
}

describe('why a card left, in the reader’s language', () => {
  it('says each reason in both languages, never in the custody log’s words', () => {
    for (const locale of LOCALES) {
      for (const departure of EVERY_KIND) {
        const text = label(locale, departure);
        expect(text.length, `${locale} ${departure.kind}`).toBeGreaterThan(0);
        expect(text).not.toMatch(/remove commons|sale of listing|_/);
        if (locale === 'he') expect(text, departure.kind).toMatch(HEBREW);
        else expect(text, departure.kind).not.toMatch(HEBREW);
      }
    }
  });

  it('names a discarded card and an escrow deal plainly, with the deal code kept as written', () => {
    expect(label('en', { kind: 'discarded', code: null })).toBe('Discarded at your request');
    expect(label('en', { kind: 'escrow', code: 'ESC-4K7Q2' })).toBe('Sold through escrow ESC-4K7Q2');
    expect(label('he', { kind: 'escrow', code: 'ESC-4K7Q2' })).toContain('ESC-4K7Q2');
  });

  it('falls back to a plain sentence for a reason it does not know', () => {
    expect(label('en', { kind: 'something_new' as Departure['kind'], code: null })).toBe('Left the vault');
  });
});
