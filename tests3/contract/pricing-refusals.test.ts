import { beforeAll, describe, it, expect } from 'vitest';

process.env.NODE_ENV = 'test';

let pricing: typeof import('../../apps/api/src/modules/prc/pricing.service');

beforeAll(async () => {
  await import('../../apps/api/node_modules/reflect-metadata/Reflect.js');
  pricing = await import('../../apps/api/src/modules/prc/pricing.service');
});

function rows(result: unknown[] | Error) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { select: () => chain } as never;
}

const percentRule = {
  id: 'rule-1',
  actionType: 'marketplace_fee',
  itemClass: null,
  model: 'percentage',
  value: 500,
  currency: 'USD',
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
};

describe('pricing that cannot be worked out', () => {
  it('reaches the caller when the database fails, rather than reading as no rule', async () => {
    const svc = new pricing.PricingService(rows(new Error('connection terminated')));
    await expect(svc.tryPrice('shipping_rush')).rejects.toThrow('connection terminated');
  });

  it('is still null when no rule is in force', async () => {
    const svc = new pricing.PricingService(rows([]));
    await expect(svc.tryPrice('shipping_rush')).resolves.toBeNull();
  });

  it('refuses a percentage rule given no amount to take it of', async () => {
    const svc = new pricing.PricingService(rows([percentRule]));
    await expect(svc.price('marketplace_fee')).rejects.toMatchObject({ status: 400 });
  });
});
