import { describe, it, expect } from 'vitest';
import { SandboxShippingAdapter } from '@bault/adapters';

/**
 * Shipping adapter contract (T102, Principle XIII). Asserts the adapter honors its
 * interface for rates, labels, and tracking. A real ShipStation/Easyship adapter
 * must pass this same suite, guaranteeing swappability.
 */
describe('contract: ShippingAdapter', () => {
  const adapter = new SandboxShippingAdapter();
  const req = { destination: { country: 'IL', postalCode: '00000' }, items: [{ weightGrams: 500 }], rush: false };

  it('returns carrier rates with cost + service level', async () => {
    const rates = await adapter.getRates(req);
    expect(rates.length).toBeGreaterThan(0);
    for (const r of rates) {
      expect(r.carrier).toBeTruthy();
      expect(r.serviceLevel).toBeTruthy();
      expect(Number.isInteger(r.costMinor)).toBe(true);
    }
  });

  it('rush rates cost more than standard', async () => {
    const std = (await adapter.getRates({ ...req, rush: false }))[0];
    const rush = (await adapter.getRates({ ...req, rush: true }))[0];
    expect(rush.costMinor).toBeGreaterThan(std.costMinor);
  });

  it('buys a label with a tracking number and returns tracking status', async () => {
    const rates = await adapter.getRates(req);
    const label = await adapter.buyLabel(rates[0], req);
    expect(label.trackingNumber).toBeTruthy();
    expect(label.labelObjectKey).toBeTruthy();
    const tracking = await adapter.getTracking(label.trackingNumber);
    expect(['in_transit', 'delivered', 'exception', 'unknown']).toContain(tracking.status);
  });
});
