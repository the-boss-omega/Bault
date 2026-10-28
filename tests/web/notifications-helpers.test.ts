import { describe, it, expect } from 'vitest';
import { byDay, notificationBarcode, notificationGlyph } from '../../apps/web/src/shared/notifications';
import { dayKey, formatDayHeading, formatTime } from '../../apps/web/src/shared/money';

const n = (id: string, createdAt: string) => ({ id, eventType: 'item_received', content: {}, channel: 'in_app', status: 'sent', createdAt });

describe('what a notification says about the card it is about', () => {
  it('reads the serial of the card from an item event', () => {
    expect(notificationBarcode({ itemId: 'x', barcode: 'SN-DR97-0001', message: 'm' })).toBe('SN-DR97-0001');
    expect(notificationBarcode({ barcode: 'SN-CL10-0005' })).toBe('SN-CL10-0005');
  });

  it('reads nothing from what is not a serial, or from no content at all', () => {
    for (const content of [null, undefined, 'a string', 42, {}, { barcode: 7 }, { barcode: 'HSE-72WWGK6N' }, { barcode: 'not a serial' }]) {
      expect(notificationBarcode(content)).toBeNull();
    }
  });
});

describe('the kind of thing an event is about, for the mark in front of it', () => {
  it('sorts the events the product has by the way their names start', () => {
    expect(notificationGlyph('item_received')).toBe('card');
    expect(notificationGlyph('hold_placed')).toBe('card');
    expect(notificationGlyph('offer_received')).toBe('market');
    expect(notificationGlyph('swap_completed')).toBe('market');
    expect(notificationGlyph('escrow_funded')).toBe('escrow');
    expect(notificationGlyph('wallet_request_completed')).toBe('wallet');
    expect(notificationGlyph('topup_settled')).toBe('wallet');
    expect(notificationGlyph('parcel_received')).toBe('inbox');
    expect(notificationGlyph('shipment_out')).toBe('shipping');
    expect(notificationGlyph('white_glove_quoted')).toBe('shipping');
    expect(notificationGlyph('support_ticket_replied')).toBe('help');
    expect(notificationGlyph('something_new')).toBe('bell');
  });
});

describe('a feed in days', () => {
  it('groups a feed that is newest first into runs of one calendar day, keeping the order', () => {
    const feed = [n('a', '2026-10-27T12:30:00Z'), n('b', '2026-10-27T12:00:00Z'), n('c', '2026-10-25T12:00:00Z')];
    const days = byDay(feed);
    expect(days.map((d) => d.items.map((i) => i.id))).toEqual([['a', 'b'], ['c']]);
    expect(days[0]!.first.id).toBe('a');
    expect(days[0]!.key).toBe(dayKey('2026-10-27T12:30:00Z'));
  });

  it('is an empty list of days for an empty feed', () => {
    expect(byDay([])).toEqual([]);
  });
});

describe('the words for a day and a time', () => {
  // Local noon, so no time zone moves it to another day.
  const noon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0).toISOString();
  const now = new Date(2026, 9, 27, 15, 0, 0);

  it('says today and yesterday in the page’s language, from the browser’s own tables, then just the date', () => {
    expect(formatDayHeading(noon(2026, 10, 27), 'en', now)).toMatch(/^today · .*October 27/i);
    expect(formatDayHeading(noon(2026, 10, 26), 'en', now)).toMatch(/^yesterday · .*October 26/i);
    expect(formatDayHeading(noon(2026, 10, 24), 'en', now)).toMatch(/^[A-Za-z]+, October 24$/);
    expect(formatDayHeading(noon(2026, 10, 27), 'he', now)).toMatch(/^היום · /);
    expect(formatDayHeading(noon(2026, 10, 26), 'he', now)).toMatch(/^אתמול · /);
  });

  it('adds the year when the day is not this year’s', () => {
    expect(formatDayHeading(noon(2025, 12, 31), 'en', now)).toContain('2025');
    expect(formatDayHeading(noon(2026, 3, 3), 'en', now)).not.toContain('2026');
  });

  it('is a time of day and nothing else', () => {
    expect(formatTime(new Date(2026, 9, 27, 6, 8).toISOString(), 'en')).toBe('6:08 AM');
    expect(formatTime(new Date(2026, 9, 27, 18, 5).toISOString(), 'he')).toBe('18:05');
    expect(formatTime(null, 'en')).toBe('—');
    expect(formatTime('not a date', 'en')).toBe('not a date');
  });
});
