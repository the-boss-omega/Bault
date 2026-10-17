import { describe, it, expect } from 'vitest';
import { SEED, signIn } from './helpers/http';

/**
 * Is every price loaded?
 *
 * No migration inserts a single `pricing_rule`. The seed does, so every
 * development database is priced — and a production database built by
 * migration alone is not: `PricingService.price` throws "No pricing rule for
 * action" on the first intake, and the actions that only TRY a rule quietly
 * fall back to another price, to a figure in the code, or to nothing at all.
 * The launch procedure needs one place that says, action by action, which of
 * those it is.
 *
 * Requires a running API + a freshly seeded DB (which prices everything).
 */

type Coverage = {
  ready: boolean;
  summary: { total: number; priced: number; missing: number };
  actions: Array<{
    actionType: string;
    resolution: string;
    fallsBackTo: string | null;
    status: string;
    rule: { id: string; model: string; value: number } | null;
  }>;
  unknownRules: Array<{ actionType: string }>;
};

describe('E6 pricing coverage', () => {
  it('is for administrators only', async () => {
    for (const email of [SEED.collector, SEED.operator]) {
      const c = await signIn(email);
      expect((await c.get('/admin/pricing/coverage')).status).toBe(403);
    }
  });

  it('lists every action type the code charges for', async () => {
    const admin = await signIn(SEED.admin);
    const res = await admin.get('/admin/pricing/coverage');
    expect(res.status).toBe(200);
    const body = res.body as Coverage;
    const types = body.actions.map((a) => a.actionType);

    // The ones whose absence stops the action outright...
    for (const t of [
      'intake',
      'parcel_processing',
      'parcel_forwarding',
      'storage',
      'service',
      'shipping',
      'marketplace_fee',
    ]) {
      expect(types, `${t} is not listed`).toContain(t);
      expect(body.actions.find((a) => a.actionType === t)!.resolution).toBe('required');
    }
    // ...and the families that fall back to something else when unpriced.
    for (const t of [
      'intake_lot',
      'storage_oversized',
      'grading_fee:psa_value',
      'consignment_fee:card_show',
      'service_fee:video_review',
      'service_fee:condition_inspection',
      'service_fee:deslab',
      'shipping_rush',
      'shipping_addon:gps_tracker',
      'show_pickup',
      'white_glove:domestic',
      'membership:folio',
      'escrow_fee',
      'cash_out_fee',
      'chargeback_fee',
    ]) {
      expect(types, `${t} is not listed`).toContain(t);
    }
    expect(new Set(types).size).toBe(types.length);

    // A fallback names what it falls back to, so "unpriced" can be read as
    // "charged the flat service fee" rather than as "free".
    expect(body.actions.find((a) => a.actionType === 'grading_fee:psa_value')!.fallsBackTo).toBe('service');
    expect(body.actions.find((a) => a.actionType === 'intake_lot')!.fallsBackTo).toBe('intake');
    expect(body.actions.find((a) => a.actionType === 'shipping_rush')!.resolution).toBe('free_if_unpriced');
  });

  it('confirms the seeded database prices every one of them', async () => {
    const admin = await signIn(SEED.admin);
    const body = (await admin.get('/admin/pricing/coverage')).body as Coverage;

    const missing = body.actions.filter((a) => a.status === 'missing').map((a) => a.actionType);
    expect(missing).toEqual([]);
    expect(body.summary.missing).toBe(0);
    expect(body.summary.total).toBe(body.actions.length);
    expect(body.ready).toBe(true);
    for (const a of body.actions.filter((x) => x.resolution !== 'code_constant')) {
      expect(a.rule, `${a.actionType} has no rule`).not.toBeNull();
    }
    expect(Array.isArray(body.unknownRules)).toBe(true);
  });
});
