import { describe, it, expect } from 'vitest';
import { billableActions, coverage } from '../../apps/api/src/modules/prc/billable-actions';
import { ITEM_CLASSES } from '../../apps/api/src/modules/inv/item-classes';
import { MEMBERSHIP_TIERS } from '../../apps/api/src/modules/mem/tiers';
import { ESCROW_FEE_ACTION, ESCROW_FEE_BPS } from '../../apps/api/src/modules/esc/escrow-terms';
import {
  CASHOUT_FEE_ACTION,
  CASHOUT_LARGE_BPS,
  CHARGEBACK_FEE_ACTION,
  CHARGEBACK_FEE_MINOR,
} from '../../apps/api/src/modules/pay/money-terms';
import {
  DEFAULT_FILE,
  keyOf,
  parseAmount,
  parsePriceFile,
  plan,
  readPriceFile,
  withTierParameters,
} from '../../scripts/ops/prices.mjs';

const file = readPriceFile(DEFAULT_FILE);
const rules = withTierParameters(file.rules, MEMBERSHIP_TIERS);

const asServerRules = (list: typeof rules) =>
  list.map((r) => ({
    id: keyOf(r),
    actionType: r.actionType,
    itemClass: r.itemClass,
    model: r.model,
    value: r.value,
    currency: 'USD',
    effectiveFrom: new Date(0),
  }));

const rule = (over: Record<string, unknown> = {}) => ({
  actionType: 'service',
  fixed: '$20.00',
  billingTrigger: 'per_event',
  description: 'A service',
  ...over,
});

describe('infra/production/prices.json', () => {
  it('prices every action the API charges for, so a new billable action without a price fails here', () => {
    const result = coverage(billableActions(), asServerRules(rules));
    const notReady = result.actions.filter((a) => a.status !== 'priced' && a.status !== 'code_constant');
    expect(notReady.map((a) => a.actionType)).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.unknownRules).toEqual([]);
  });

  it('gives a percentage only to an action priced on an amount, as the API requires', () => {
    const onAmount = new Set(billableActions().filter((a) => a.percentOf).map((a) => a.actionType));
    for (const r of rules.filter((x) => x.model === 'percentage')) expect(onAmount, keyOf(r)).toContain(r.actionType);
  });

  it('names only item classes the intake bench knows', () => {
    const known = new Set(ITEM_CLASSES.map((c) => c.key));
    for (const r of rules.filter((x) => x.itemClass)) expect(known, keyOf(r)).toContain(r.itemClass);
  });

  it('publishes the fees the code charges from constants at exactly those constants', () => {
    const constants: Record<string, { model: string; value: number }> = {
      [ESCROW_FEE_ACTION]: { model: 'percentage', value: ESCROW_FEE_BPS },
      [CASHOUT_FEE_ACTION]: { model: 'percentage', value: CASHOUT_LARGE_BPS },
      [CHARGEBACK_FEE_ACTION]: { model: 'fixed', value: CHARGEBACK_FEE_MINOR },
    };
    const codeConstant = new Set(
      billableActions()
        .filter((a) => a.resolution === 'code_constant')
        .map((a) => a.actionType),
    );
    for (const r of rules.filter((x) => codeConstant.has(x.actionType))) {
      expect(constants[r.actionType], `${r.actionType} has no constant to check against`).toBeDefined();
      expect({ model: r.model, value: r.value }, r.actionType).toEqual(constants[r.actionType]);
    }
  });

  it('gives each membership the allowances of its tier, and both storage rules the terms the sweep reads', () => {
    for (const tier of MEMBERSHIP_TIERS) {
      const r = rules.find((x) => x.actionType === tier.feeActionType)!;
      expect(r.parameters).toMatchObject({ storedItems: tier.storedItems, postageCreditMinor: tier.postageCreditMinor });
      expect(r.billingTrigger).toBe('monthly');
    }
    for (const actionType of ['storage', 'storage_oversized']) {
      const r = rules.find((x) => x.actionType === actionType)!;
      expect(Object.keys(r.parameters ?? {}).sort()).toEqual(['freeDays', 'percentOfIntakeBps', 'periodDays']);
    }
  });

  it('is marked as not yet reviewed until somebody has decided the prices', () => {
    expect(typeof file.reviewed).toBe('boolean');
  });
});

describe('scripts/ops/prices.mjs', () => {
  it('reads prices as dollars and percentages', () => {
    expect(parseAmount(rule({ fixed: '$5.00' }))).toEqual({ model: 'fixed', value: 500 });
    expect(parseAmount(rule({ fixed: '$0.00' }))).toEqual({ model: 'fixed', value: 0 });
    expect(parseAmount(rule({ fixed: '$1500' }))).toEqual({ model: 'fixed', value: 150_000 });
    expect(parseAmount(rule({ fixed: undefined, percent: '5%' }))).toEqual({ model: 'percentage', value: 500 });
    expect(parseAmount(rule({ fixed: undefined, percent: '2.5%' }))).toEqual({ model: 'percentage', value: 250 });
    expect(parseAmount(rule({ fixed: undefined, percent: '12.25%' }))).toEqual({ model: 'percentage', value: 1225 });
    for (const bad of [
      rule({ fixed: '5' }),
      rule({ fixed: '$5.5' }),
      rule({ fixed: '$1,000.00' }),
      rule({ fixed: undefined, percent: '101%' }),
      rule({ percent: '5%' }),
      rule({ fixed: undefined }),
    ]) {
      expect(() => parseAmount(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('refuses a file a loader could get wrong', () => {
    const doc = (list: unknown[], reviewed: unknown = false) => ({ reviewed, rules: list });
    expect(() => parsePriceFile(doc([rule(), rule()]))).toThrow(/twice/);
    expect(() => parsePriceFile(doc([rule({ description: ' ' })]))).toThrow(/description/);
    expect(() => parsePriceFile(doc([rule({ billingTrigger: 'yearly' })]))).toThrow(/billingTrigger/);
    expect(() =>
      parsePriceFile(doc([rule({ actionType: 'membership:folio', parameters: { storedItems: 1 } })])),
    ).toThrow(/tier catalogue/);
    expect(() => parsePriceFile(doc([rule({ actionType: 'storage' })]))).toThrow(/freeDays/);
    expect(() => parsePriceFile(doc([rule()], 'yes'))).toThrow(/reviewed/);
    expect(() => parsePriceFile({ ...doc([rule()]), currency: 'EUR' })).toThrow(/USD/);
    expect(parsePriceFile(doc([rule(), rule({ itemClass: 'trading_card' })])).rules).toHaveLength(2);
  });

  it('loads what the server lacks, leaves what matches, and reports what differs', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    const want = parsePriceFile({
      reviewed: true,
      rules: [rule(), rule({ actionType: 'shipping', fixed: '$0.00' }), rule({ actionType: 'intake', fixed: '$5.00' })],
    }).rules;
    const server = [
      { actionType: 'service', itemClass: null, model: 'fixed', value: 2000, billingTrigger: 'per_event', description: 'A service', parameters: null, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null },
      { actionType: 'shipping', itemClass: null, model: 'fixed', value: 0, billingTrigger: 'per_event', description: 'A service', parameters: null, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null },
      { actionType: 'shipping', itemClass: null, model: 'fixed', value: 300, billingTrigger: 'per_event', description: 'A service', parameters: null, effectiveFrom: '2026-02-01T00:00:00Z', effectiveTo: null },
      { actionType: 'intake', itemClass: null, model: 'fixed', value: 500, billingTrigger: 'per_event', description: 'A service', parameters: null, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2026-03-01T00:00:00Z' },
      { actionType: 'intake', itemClass: null, model: 'fixed', value: 500, billingTrigger: 'per_event', description: 'A service', parameters: null, effectiveFrom: '2027-01-01T00:00:00Z', effectiveTo: null },
    ];
    const steps = plan(want, server, now);
    expect(steps.map((s: { action: string }) => s.action)).toEqual(['same', 'differs', 'load']);
    expect(steps[1].changes).toEqual(['value']);
  });
});
