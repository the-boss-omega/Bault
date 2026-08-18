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
