import { describe, it, expect } from 'vitest';
import { LOCALES, t, type Locale, type MessageKey, type MessageVars } from '../../apps/web/src/shared/i18n';
import { collectorTimeline, timelineDetail, type TimelineEvent } from '../../apps/web/src/shared/itemTimeline';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function tr(locale: Locale) {
  return (key: MessageKey, vars?: MessageVars) => t(key, locale, vars);
}

function plain(locale: Locale, event: Omit<TimelineEvent, 'at'>): string {
  return timelineDetail(tr(locale), { at: '2026-10-01T10:00:00.000Z', ...event }).replace(/[⁨⁩]/g, '');
}

const EVERY_KIND: Omit<TimelineEvent, 'at'>[] = [
  { kind: 'intake', params: { fromState: null, toState: 'stored' } },
  { kind: 'state_change', params: { fromState: 'stored', toState: 'listed' } },
  { kind: 'ownership_transfer', params: {} },
  { kind: 'hold_placed', params: {} },
  { kind: 'sale', params: { amountMinor: 26_000 } },
  { kind: 'swap', params: { amountMinor: null } },
  { kind: 'shipment', params: { code: 'SHP-7K2M9QRS', status: 'in_transit' } },
  { kind: 'offer', params: { amountMinor: 24_000, status: 'countered' } },
  { kind: 'dispute', params: { status: 'ruled' } },
];

describe('the item register, in the reader\u2019s language', () => {
  it('says an intake without naming a shelf', () => {
    expect(plain('en', { kind: 'intake', params: { fromState: null, toState: 'stored' } })).toBe('');
  });

  it('says states and amounts in words and dollars', () => {
    expect(plain('en', { kind: 'state_change', params: { fromState: 'stored', toState: 'listed' } })).toBe('Stored \u2192 Listed');
    expect(plain('en', { kind: 'sale', params: { amountMinor: 26_000 } })).toBe('$260.00');
    expect(plain('en', { kind: 'swap', params: { amountMinor: null } })).toBe('');
    expect(plain('en', { kind: 'offer', params: { amountMinor: 24_000, status: 'countered' } })).toBe('$240.00 \u00b7 Countered');
    expect(plain('en', { kind: 'shipment', params: { code: 'SHP-7K2M9QRS', status: 'in_transit' } })).toBe(
      `SHP-7K2M9QRS \u00b7 ${t('ss.shipmentStatus.in_transit', 'en')}`,
    );
    expect(plain('en', { kind: 'ownership_transfer', params: {} })).toBe('');
  });

  it('says where a dispute stands in the collector\u2019s words, without a ruling', () => {
    expect(plain('en', { kind: 'dispute', params: { status: 'ruled' } })).toBe('Decided');
    expect(plain('en', { kind: 'dispute', params: { status: 'investigating' } })).toBe('Being looked into');
    expect(plain('en', { kind: 'dispute', params: { status: 'ruled', ruling: 'Refund the buyer' } as never })).toBe('Decided');
  });

  it('leaves warehouse moves and record corrections out', () => {
    const at = '2026-10-01T10:00:00.000Z';
    const kept = collectorTimeline([
      { at, kind: 'intake', params: {} },
      { at, kind: 'relocate', params: {} },
      { at, kind: 'bin_transfer', params: {} },
      { at, kind: 'correction', params: {} },
      { at, kind: 'sale', params: { amountMinor: 100 } },
    ]);
    expect(kept.map((e) => e.kind)).toEqual(['intake', 'sale']);
  });

  it('prints no raw value of the machine\u2019s', () => {
    for (const locale of LOCALES) {
      for (const event of EVERY_KIND) {
        const text = plain(locale, event);
        expect(text, `${locale} ${event.kind}`).not.toMatch(UUID);
        expect(text, `${locale} ${event.kind}`).not.toMatch(/cents|_|\u2205|undefined|null|\{|BIN-/);
        expect(text, `${locale} ${event.kind}`).not.toMatch(/\b(stored|listed|in transit|countered|ruled)\b/);
      }
    }
  });

  it('keeps each value an isolated run, so a value cannot reorder the sentence around it', () => {
    const raw = timelineDetail(tr('en'), { at: '2026-10-01T10:00:00.000Z', kind: 'sale', params: { amountMinor: 26_000 } });
    expect(raw).toBe('\u2068$260.00\u2069');
  });
});
