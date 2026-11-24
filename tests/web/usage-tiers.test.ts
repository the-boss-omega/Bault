import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  HONOURED_ALLOWANCES,
  TIER_KEYS,
  TIER_RULES,
  TIER_WINDOW_DAYS,
  UNLIMITED,
  covers,
  discountedMinor,
  honouredAllowance,
  isTierKey,
  nextTier,
  remaining,
  tierFor,
  tierRule,
} from '../../apps/api/src/modules/mem/tiers';
import { discountedMinor as webDiscountedMinor } from '../../apps/web/src/shared/tiers';

const ROOT = join(__dirname, '..', '..');

describe('the tier rules', () => {
  it('are the owner’s defaults: Bronze for everyone, Silver at 10 or $500.00, Gold at 30 or $2,000.00', () => {
    expect(TIER_WINDOW_DAYS).toBe(90);
    expect(TIER_RULES).toEqual([
      { key: 'bronze', minActions: 0, minSpentMinor: 0, discountBps: 0 },
      { key: 'silver', minActions: 10, minSpentMinor: 50_000, discountBps: 1_000 },
      { key: 'gold', minActions: 30, minSpentMinor: 200_000, discountBps: 2_000 },
    ]);
    expect(TIER_RULES.map((r) => r.key)).toEqual([...TIER_KEYS]);
  });

  it('only ever ask more for a higher tier and give more back', () => {
    for (let i = 1; i < TIER_RULES.length; i += 1) {
      expect(TIER_RULES[i]!.minActions).toBeGreaterThan(TIER_RULES[i - 1]!.minActions);
      expect(TIER_RULES[i]!.minSpentMinor).toBeGreaterThan(TIER_RULES[i - 1]!.minSpentMinor);
      expect(TIER_RULES[i]!.discountBps).toBeGreaterThan(TIER_RULES[i - 1]!.discountBps);
    }
  });

  it('are the rows migration 0046 starts the database with, before the API brings them in step', () => {
    const sql = readFileSync(
      join(ROOT, 'apps/api/src/db/migrations/0046_memberships_become_usage_tiers.sql'),
      'utf8',
    );
    for (const r of TIER_RULES) {
      expect(sql).toContain(`('${r.key}', ${r.minActions}, ${r.minSpentMinor}, ${r.discountBps})`);
    }
    expect(sql).toContain(`- ${TIER_WINDOW_DAYS})::timestamp`);
  });

  it('reach a tier on either count, whichever comes first', () => {
    expect(tierFor({ actions: 0, spentMinor: 0 })).toBe('bronze');
    expect(tierFor({ actions: 9, spentMinor: 49_999 })).toBe('bronze');
    expect(tierFor({ actions: 10, spentMinor: 0 })).toBe('silver');
    expect(tierFor({ actions: 1, spentMinor: 50_000 })).toBe('silver');
    expect(tierFor({ actions: 29, spentMinor: 199_999 })).toBe('silver');
    expect(tierFor({ actions: 30, spentMinor: 0 })).toBe('gold');
    expect(tierFor({ actions: 0, spentMinor: 200_000 })).toBe('gold');
  });

  it('say what is left to reach the next tier, and nothing past Gold', () => {
    expect(nextTier('bronze', { actions: 4, spentMinor: 12_000 })).toEqual({
      tier: 'silver',
      minActions: 10,
      minSpentMinor: 50_000,
      actionsToGo: 6,
      spentToGoMinor: 38_000,
    });
    expect(nextTier('silver', { actions: 40, spentMinor: 0 })).toMatchObject({ tier: 'gold', actionsToGo: 0 });
    expect(nextTier('gold', { actions: 0, spentMinor: 0 })).toBeNull();
  });

  it('resolve tier keys, and fall back to Bronze for anything else', () => {
    expect(isTierKey('silver')).toBe(true);
    expect(isTierKey('platinum')).toBe(false);
    expect(tierRule('platinum').key).toBe('bronze');
    expect(tierRule(null).key).toBe('bronze');
  });
});

describe('the discount', () => {
  it('takes the tier’s share off and rounds to the nearest cent', () => {
    expect(discountedMinor(1_000, 0)).toBe(1_000);
    expect(discountedMinor(1_000, 1_000)).toBe(900);
    expect(discountedMinor(1_000, 2_000)).toBe(800);
    expect(discountedMinor(99, 1_000)).toBe(89);
    expect(discountedMinor(1, 2_000)).toBe(1);
    expect(discountedMinor(0, 2_000)).toBe(0);
  });

  it('is worked out the same way on the page as on the server', () => {
    for (const list of [0, 1, 5, 99, 100, 499, 1_234, 9_999, 150_000]) {
      for (const r of TIER_RULES) expect(webDiscountedMinor(list, r.discountBps)).toBe(discountedMinor(list, r.discountBps));
    }
  });
});

describe('a paid membership’s honoured allowances', () => {
  const bronze = honouredAllowance('bronze')!;

  it('are kept for every tier that was sold, and nothing else', () => {
    expect(HONOURED_ALLOWANCES.map((a) => a.key)).toEqual([...TIER_KEYS]);
    expect(honouredAllowance('platinum')).toBeUndefined();
    expect(honouredAllowance(null)).toBeUndefined();
  });

  it('cover an action until the allowance is spent, and then simply do not', () => {
    expect(covers(bronze, 'intake', 3)).toBe(true);
    expect(remaining(bronze, 'intake', 3)).toBe(1);
    expect(covers(bronze, 'intake', 4)).toBe(false);
    expect(covers(bronze, 'service_fee:video_review', 0)).toBe(false);
    const gold = honouredAllowance('gold')!;
    expect(remaining(gold, 'service_fee:deslab', 500)).toBe(UNLIMITED);
  });
});
