import { describe, it, expect } from 'vitest';
import { SEED, signIn } from './helpers/http';

interface Violation {
  field: string;
}

describe('PAY review queue filters', () => {
  it('refuses a date that is not a date with a 400 naming the field', async () => {
    const admin = await signIn(SEED.admin);
    for (const [query, field] of [
      ['from=not-a-date', 'from'],
      ['to=2026-13-45', 'to'],
      ['from=2026-02-30', 'from'],
      ['to=yesterday', 'to'],
      ['from=2026-W05', 'from'],
    ] as const) {
      const res = await admin.get(`/admin/wallet-requests?${query}`);
      expect(res.status, `${query}: ${JSON.stringify(res.body)}`).toBe(400);
      const violations = (res.body.error.details.violations ?? []) as Violation[];
      expect(violations.map((v) => v.field), query).toContain(field);
    }
  });

  it('refuses an unknown type or status by name', async () => {
    const admin = await signIn(SEED.admin);
    for (const [query, field] of [
      ['type=bogus', 'type'],
      ['status=bogus', 'status'],
    ] as const) {
      const res = await admin.get(`/admin/wallet-requests?${query}`);
      expect(res.status, query).toBe(400);
      expect(((res.body.error.details.violations ?? []) as Violation[]).map((v) => v.field), query).toContain(field);
    }
  });

  it('still filters by a valid range', async () => {
    const admin = await signIn(SEED.admin);
    const collector = await signIn(SEED.collector);
    const before = new Date(Date.now() - 1_000).toISOString();
    const created = await collector.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 1_500,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `queue-filter-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    });
    expect(created.status).toBe(201);
    const after = new Date(Date.now() + 60_000).toISOString();
    const ids = async (query: string) => {
      const res = await admin.get(`/admin/wallet-requests?${query}`);
      expect(res.status, query).toBe(200);
      return (res.body as { id: string }[]).map((r) => r.id);
    };

    expect(await ids(`from=${before}&to=${after}&type=cash_in&status=submitted`)).toContain(created.body.id);
    expect(await ids(`from=${after}`)).not.toContain(created.body.id);
    expect(await ids(`to=${before}`)).not.toContain(created.body.id);
    expect(await ids(`from=${before.slice(0, 10)}`)).toContain(created.body.id);

    await collector.post(`/finance/wallet-requests/${created.body.id}/cancel`, {});
  });
});
