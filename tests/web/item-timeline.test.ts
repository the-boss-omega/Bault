import { describe, it, expect } from 'vitest';
import { LOCALES, t, type Locale, type MessageKey, type MessageVars } from '../../apps/web/src/shared/i18n';
import { timelineDetail, type TimelineEvent } from '../../apps/web/src/shared/itemTimeline';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const HEBREW = /[֐-׿]/;
const A = { barcode: 'BIN-AAAA1111', zone: 'A' };
const B = { barcode: 'BIN-BBBB2222', zone: 'B' };

function tr(locale: Locale) {
  return (key: MessageKey, vars?: MessageVars) => t(key, locale, vars);
}

function plain(locale: Locale, event: Omit<TimelineEvent, 'at'>): string {
  return timelineDetail(tr(locale), { at: '2026-10-01T10:00:00.000Z', ...event }).replace(/[⁨⁩]/g, '');
}

const EVERY_KIND: Omit<TimelineEvent, 'at'>[] = [
  { kind: 'intake', params: { fromBin: null, toBin: A, fromState: null, toState: 'stored' } },
  { kind: 'relocate', params: { fromBin: A, toBin: B } },
  { kind: 'bin_transfer', params: { fromBin: null, toBin: A } },
  { kind: 'state_change', params: { fromState: 'stored', toState: 'listed' } },
  { kind: 'ownership_transfer', params: {} },
  { kind: 'hold_placed', params: {} },
  { kind: 'correction', params: { field: 'conditionGrade', from: 'PSA 8', to: 'PSA 9' } },
  { kind: 'correction', params: { field: 'typeClass', from: 'trading_card', to: 'small_collectible' } },
  { kind: 'sale', params: { amountMinor: 26_000 } },
  { kind: 'swap', params: { amountMinor: null } },
  { kind: 'shipment', params: { code: 'SHP-7K2M9QRS', status: 'in_transit' } },
  { kind: 'offer', params: { amountMinor: 24_000, status: 'countered' } },
  { kind: 'dispute', params: { status: 'ruled', ruling: null } },
];

describe('the item register, in the reader’s language', () => {
  it('names shelves by label, from the first one to the next', () => {
    expect(plain('en', { kind: 'relocate', params: { fromBin: A, toBin: B } })).toBe('BIN-AAAA1111 · A → BIN-BBBB2222 · B');
    expect(plain('he', { kind: 'relocate', params: { fromBin: A, toBin: B } })).toBe('BIN-AAAA1111 · A ← BIN-BBBB2222 · B');
    expect(plain('en', { kind: 'bin_transfer', params: { fromBin: null, toBin: A } })).toBe('Intake → BIN-AAAA1111 · A');
    expect(plain('en', { kind: 'relocate', params: { fromBin: A, toBin: null } })).toBe('BIN-AAAA1111 · A → Not on a shelf');
    expect(plain('en', { kind: 'intake', params: { fromBin: null, toBin: A, fromState: null, toState: 'stored' } })).toBe(
      'Shelved in BIN-AAAA1111 · A',
    );
  });

  it('says states, fields and amounts in words and dollars', () => {
    expect(plain('en', { kind: 'state_change', params: { fromState: 'stored', toState: 'listed' } })).toBe('Stored → Listed');
    expect(plain('he', { kind: 'state_change', params: { fromState: 'stored', toState: 'listed' } })).toBe(
      `${t('vault.state.stored', 'he')} ← ${t('vault.state.listed', 'he')}`,
    );
    expect(plain('en', { kind: 'correction', params: { field: 'conditionGrade', from: 'PSA 8', to: 'PSA 9' } })).toBe(
      'Condition: PSA 8 → PSA 9',
    );
    expect(plain('en', { kind: 'correction', params: { field: 'description', from: null, to: 'Rayquaza' } })).toBe(
      'Description: — → Rayquaza',
    );
    expect(plain('en', { kind: 'sale', params: { amountMinor: 26_000 } })).toBe('$260.00');
    expect(plain('en', { kind: 'swap', params: { amountMinor: null } })).toBe('');
    expect(plain('en', { kind: 'offer', params: { amountMinor: 24_000, status: 'countered' } })).toBe('$240.00 · Countered');
    expect(plain('en', { kind: 'shipment', params: { code: 'SHP-7K2M9QRS', status: 'in_transit' } })).toBe(
      `SHP-7K2M9QRS · ${t('ss.shipmentStatus.in_transit', 'en')}`,
    );
    expect(plain('en', { kind: 'dispute', params: { status: 'ruled', ruling: 'Refund the buyer' } })).toBe('Ruled · Refund the buyer');
    expect(plain('en', { kind: 'ownership_transfer', params: {} })).toBe('');
  });

  it('prints no raw value of the machine’s in either language', () => {
    for (const locale of LOCALES) {
      for (const event of EVERY_KIND) {
        const text = plain(locale, event);
        expect(text, `${locale} ${event.kind}`).not.toMatch(UUID);
        expect(text, `${locale} ${event.kind}`).not.toMatch(/cents|_|∅|undefined|null|\{/);
        expect(text, `${locale} ${event.kind}`).not.toMatch(/\b(stored|listed|in transit|countered|ruled|conditionGrade|typeClass)\b/);
      }
    }
  });

  it('reads as Hebrew on a Hebrew page wherever there are words', () => {
    for (const event of EVERY_KIND) {
      const text = plain('he', event);
      if (/[A-Za-z]/.test(text.replace(/BIN-\w+|SHP-\w+|PSA \d| · [AB]\b/g, ''))) {
        throw new Error(`English left in the Hebrew register: ${event.kind}: ${text}`);
      }
    }
    expect(plain('he', { kind: 'state_change', params: { fromState: 'stored', toState: 'listed' } })).toMatch(HEBREW);
  });

  it('keeps each value an isolated run, so a Latin code cannot reorder a Hebrew sentence', () => {
    const raw = timelineDetail(tr('he'), { at: '2026-10-01T10:00:00.000Z', kind: 'relocate', params: { fromBin: A, toBin: B } });
    expect(raw).toBe('⁨BIN-AAAA1111 · A⁩ ← ⁨BIN-BBBB2222 · B⁩');
  });
});
