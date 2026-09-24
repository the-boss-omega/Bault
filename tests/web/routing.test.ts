import { describe, it, expect } from 'vitest';
import { legacyRedirect } from '../../apps/web/src/shared/routing';

/**
 * Retired routes.
 *
 * Services stopped being a section of its own, so `#/services` and `#/shipping`
 * are dead URLs that users still hold in bookmarks and in the persisted
 * last-visited section. They must land somewhere useful rather than falling back
 * to the role's landing page.
 */
describe('legacy route redirects', () => {
  const route = (section: string, tab: string | null = null) => ({ section, tab, params: {} });

  it('sends /services to the merged service-request tab', () => {
    expect(legacyRedirect(route('services'))).toEqual({
      section: 'shipping-services',
      tab: 'requests',
    });
  });

  it('sends both halves of the old inbound workflow to the receiving bench', () => {
    /**
     * `parcels` and `intake` were two tabs describing one piece of work: a box is
     * received, opened, and its contents are booked in. "Book contents" on the
     * parcel bench SWITCHED TABS to a form on another screen, and the box was
     * closed out over there — so an operator crossed a tab boundary twice to work
     * through one box. They are one `receiving` tab now, and an operator's
     * bookmark for either half should reach the bench rather than falling back to
     * the section's landing tab.
     */
    expect(legacyRedirect(route('warehouse', 'parcels'))).toEqual({
      section: 'warehouse',
      tab: 'receiving',
    });
    expect(legacyRedirect(route('warehouse', 'intake'))).toEqual({
      section: 'warehouse',
      tab: 'receiving',
    });
  });

  it('sends the promoted marketplace tabs to their own sections', () => {
    /**
     * The Bault store and escrow left the marketplace's tab strip for the rail.
     * Neither was a way of browsing other collectors' shelves — the store is
     * stock the house sells itself, and an escrow deal was agreed somewhere else
     * and has no listing anywhere — but the FAQ, bookmarks and old notification
     * links still say `#/marketplace/house`. Falling back to Browse would answer
     * "where is the Bault store?" with somebody else's shelf.
     */
    expect(legacyRedirect(route('marketplace', 'house'))).toEqual({
      section: 'bault-store',
      tab: null,
    });
    expect(legacyRedirect(route('marketplace', 'escrow'))).toEqual({
      section: 'escrow',
      tab: null,
    });
  });

  it('leaves the marketplace tabs that stayed behind alone', () => {
    for (const tab of ['browse', 'sell', 'listings', 'offers', 'trade', 'store']) {
      expect(legacyRedirect(route('marketplace', tab))).toBeNull();
    }
  });

  it('leaves the warehouse tabs that still exist alone', () => {
    expect(legacyRedirect(route('warehouse', 'receiving'))).toBeNull();
    expect(legacyRedirect(route('warehouse', 'inventory'))).toBeNull();
  });

  it('sends /shipping to the merged shipping tab', () => {
    expect(legacyRedirect(route('shipping'))).toEqual({
      section: 'shipping-services',
      tab: 'shipping',
    });
  });

  it('redirects regardless of the tab the old link carried', () => {
    expect(legacyRedirect(route('services', 'order'))?.section).toBe('shipping-services');
    expect(legacyRedirect(route('shipping', 'anything'))?.section).toBe('shipping-services');
  });

  it('leaves current sections alone', () => {
    for (const section of [
      'vault',
      'wallet',
      'marketplace',
      'bault-store',
      'escrow',
      'shipping-services',
      'warehouse',
      'notifications',
      'faq',
      'admin',
      'profile',
      '',
    ]) {
      expect(legacyRedirect(route(section))).toBeNull();
    }
  });

  it('never redirects a section that merely starts with a retired name', () => {
    expect(legacyRedirect(route('services-archive'))).toBeNull();
    expect(legacyRedirect(route('shipping-services'))).toBeNull();
  });
});
