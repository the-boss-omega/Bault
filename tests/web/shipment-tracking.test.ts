import { describe, it, expect } from 'vitest';
import {
  SHIPMENT_TONE,
  matchesShipmentSearch,
  type ShipmentSummary,
} from '../../apps/web/src/shared/shipments';
import { legacyRedirect } from '../../apps/web/src/shared/routing';

/**
 * Shipment tracking search.
 *
 * The tracking tab stopped being a lookup and became a list, so search is now
 * the ONLY way a user narrows it down. That makes "search finds the shipment"
 * a correctness property rather than a convenience, and it is pinned here.
 */
function shipment(overrides: Partial<ShipmentSummary> = {}): ShipmentSummary {
  return {
    id: '9f1b2c3d-0000-4000-8000-000000000001',
    code: 'SHP-7K2M9QRS',
    status: 'in_transit',
    username: 'golden',
    customerName: 'Golden Marsh',
    recipientName: 'Golden Marsh',
    carrier: 'DHL',
    serviceLevel: 'Express',
    trackingNumber: 'SBX-SEED-0001',
    estimatedDeliveryAt: '2026-08-09T12:00:00.000Z',
    rush: true,
    cost: 3500,
    currency: 'USD',
    itemIds: ['i1'],
    destinationAddress: 'Golden Marsh, 55 Wall St, New York 10005, US',
    createdAt: '2026-08-05T09:30:00.000Z',
    updatedAt: '2026-08-06T11:00:00.000Z',
    fulfilledAt: null,
    ...overrides,
  };
}

describe('shipment search', () => {
  const rows = [
    shipment(),
    shipment({
      id: '2',
      code: 'SHP-ZZZZ0000',
      username: 'red',
      customerName: 'Red Ashwood',
      recipientName: 'Red Ashwood',
      carrier: 'USPS',
      trackingNumber: '9400111899223456781234',
      status: 'delivered',
      createdAt: '2026-07-02T08:00:00.000Z',
    }),
  ];

  it('returns everything for an empty query', () => {
    expect(rows.filter((s) => matchesShipmentSearch(s, ''))).toHaveLength(2);
    expect(rows.filter((s) => matchesShipmentSearch(s, '   '))).toHaveLength(2);
  });

  it('searches by permanent username', () => {
    const hits = rows.filter((s) => matchesShipmentSearch(s, 'golden'));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.username).toBe('golden');
  });

  it('searches by customer name', () => {
    expect(rows.filter((s) => matchesShipmentSearch(s, 'Ashwood'))).toHaveLength(1);
  });

  it('searches by carrier tracking number', () => {
    expect(rows.filter((s) => matchesShipmentSearch(s, '9400111899223456781234'))).toHaveLength(1);
    // A partial tracking number is the realistic case — people paste fragments.
    expect(rows.filter((s) => matchesShipmentSearch(s, 'SBX-SEED'))).toHaveLength(1);
  });

  it('searches by shipment status', () => {
    expect(rows.filter((s) => matchesShipmentSearch(s, 'delivered'))).toHaveLength(1);
    expect(rows.filter((s) => matchesShipmentSearch(s, 'in_transit'))).toHaveLength(1);
  });

  it('searches by creation date', () => {
    expect(rows.filter((s) => matchesShipmentSearch(s, '2026-08-05'))).toHaveLength(1);
    // A whole month narrows rather than matching everything.
    expect(rows.filter((s) => matchesShipmentSearch(s, '2026-07'))).toHaveLength(1);
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(matchesShipmentSearch(rows[0]!, '  GOLDEN  ')).toBe(true);
    expect(matchesShipmentSearch(rows[0]!, 'dhl')).toBe(true);
  });

  it('does not require the internal id — and does not match on it either', () => {
    // The internal id is never presented as something to search for; it exists
    // for React keys and the drawer route.
    expect(matchesShipmentSearch(rows[0]!, '9f1b2c3d-0000-4000-8000-000000000001')).toBe(false);
  });

  it('still matches a shipment that has no tracking number yet', () => {
    const fresh = shipment({ trackingNumber: null, carrier: null, status: 'requested' });
    expect(matchesShipmentSearch(fresh, 'golden')).toBe(true);
    expect(matchesShipmentSearch(fresh, 'requested')).toBe(true);
  });
});

describe('shipment status tones', () => {
  it('covers every status the API enum can produce', () => {
    // Mirrors `shipmentStatus` in apps/api/src/modules/shp/shp.schema.ts.
    const apiStatuses = [
      'requested',
      'rates_selected',
      'picking',
      'packed',
      'labeled',
      'shipped',
      'in_transit',
      'delivered',
      'exception',
    ];
    for (const status of apiStatuses) {
      expect(SHIPMENT_TONE[status], `missing tone for ${status}`).toBeTruthy();
    }
  });

  it('marks only delivery as success and only exception as an error', () => {
    expect(SHIPMENT_TONE.delivered).toBe('success');
    expect(SHIPMENT_TONE.exception).toBe('error');
    expect(SHIPMENT_TONE.in_transit).not.toBe('success');
  });
});

describe('retired wallet tabs still resolve', () => {
  const route = (section: string, tab: string | null = null) => ({ section, tab, params: {} });

  it('sends the old top-up tab to Cash in', () => {
    expect(legacyRedirect(route('wallet', 'topup'))).toEqual({ section: 'wallet', tab: 'cash-in' });
  });

  it('sends the old withdrawals tab to Cash out', () => {
    expect(legacyRedirect(route('wallet', 'withdrawals'))).toEqual({
      section: 'wallet',
      tab: 'cash-out',
    });
  });

  it('leaves the current wallet tabs alone', () => {
    for (const tab of ['overview', 'transactions', 'cash-in', 'cash-out', 'requests']) {
      expect(legacyRedirect(route('wallet', tab))).toBeNull();
    }
    expect(legacyRedirect(route('wallet'))).toBeNull();
  });

  it('does not redirect a same-named tab in another section', () => {
    // `LEGACY_TABS` is keyed by section precisely so this cannot happen.
    expect(legacyRedirect(route('vault', 'topup'))).toBeNull();
  });
});
