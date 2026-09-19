import { describe, it, expect } from 'vitest';
import { tierAction, type MembershipTier, type MyMembership } from '../../apps/web/src/shared/membership';

/**
 * What a tier's button does, and what it costs today.
 *
 * One button, four meanings — and two of them used to be priced wrong by the
 * API: re-joining your own tier during a cancellation charged a whole new cycle,
 * and an upgrade charged the new tier in full with nothing back for the old one.
 * The confirm sentence is built from this, so it has to say what the server does.
 */
const ORDER = ['folio', 'registry', 'trust'];
const tier = (key: string, priceMinor: number) => ({ key, priceMinor }) as MembershipTier;

const DAY = 86_400_000;
const START = Date.parse('2026-09-01T00:00:00Z');
const mine = (over: Partial<MyMembership> = {}): MyMembership =>
  ({
    tier: 'registry',
    status: 'active',
    scheduledTier: null,
    currentFeeMinor: 19_900,
    cycleLive: true,
    currentPeriodStart: new Date(START).toISOString(),
    currentPeriodEnd: new Date(START + 30 * DAY).toISOString(),
    ...over,
  }) as MyMembership;

describe('tier actions', () => {
  it('joining charges the full fee', () => {
    expect(tierAction(null, tier('folio', 3_900), ORDER)).toEqual({ kind: 'join', chargeMinor: 3_900 });
  });

  it('an upgrade credits the unused part of the cycle already paid for', () => {
    // Ten days into thirty: two thirds of $199.00 comes back.
    const a = tierAction(mine(), tier('trust', 69_900), ORDER, START + 10 * DAY);
    expect(a.kind).toBe('upgrade');
    if (a.kind !== 'upgrade') return;
    expect(a.creditMinor).toBe(13_266);
    expect(a.chargeMinor).toBe(69_900 - 13_266);
  });

  it('a downgrade costs nothing today and names the date it happens', () => {
    const a = tierAction(mine(), tier('folio', 3_900), ORDER, START + 5 * DAY);
    expect(a).toEqual({ kind: 'downgrade', effectiveFrom: new Date(START + 30 * DAY).toISOString() });
  });

  it('your own tier is "keep", never a purchase — including while cancelling', () => {
    expect(tierAction(mine({ status: 'cancelling' }), tier('registry', 19_900), ORDER).kind).toBe('keep');
    expect(tierAction(mine({ scheduledTier: 'folio' }), tier('registry', 19_900), ORDER).kind).toBe('keep');
  });

  it('a lapsed cycle earns no credit, because there is nothing unused to give back', () => {
    const a = tierAction(mine({ cycleLive: false }), tier('trust', 69_900), ORDER, START + 40 * DAY);
    expect(a).toEqual({ kind: 'upgrade', creditMinor: 0, chargeMinor: 69_900 });
  });
});
