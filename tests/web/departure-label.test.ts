import { describe, it, expect } from 'vitest';
import { t, type MessageKey, type MessageVars } from '../../apps/web/src/shared/i18n';
import { departureLabel, type Departure } from '../../apps/web/src/shared/itemTimeline';

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

function label(departure: Departure): string {
  const tr = (key: MessageKey, vars?: MessageVars) => t(key, 'en', vars);
  return departureLabel(tr, departure).replace(/[⁨⁩]/g, '');
}

describe('why a card left', () => {
  it('says each reason in words, never in the custody log’s', () => {
    for (const departure of EVERY_KIND) {
      const text = label(departure);
      expect(text.length, departure.kind).toBeGreaterThan(0);
      expect(text).not.toMatch(/remove commons|sale of listing|_/);
    }
  });

  it('names a discarded card and an escrow deal plainly, with the deal code kept as written', () => {
    expect(label({ kind: 'discarded', code: null })).toBe('Discarded at your request');
    expect(label({ kind: 'escrow', code: 'ESC-4K7Q2' })).toBe('Sold through escrow ESC-4K7Q2');
  });

  it('falls back to a plain sentence for a reason it does not know', () => {
    expect(label({ kind: 'something_new' as Departure['kind'], code: null })).toBe('Left the vault');
  });
});
