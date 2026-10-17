import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  billableActions,
  coverage,
  type RuleInForce,
} from '../../apps/api/src/modules/prc/billable-actions';

/**
 * The pricing-coverage catalogue, without a database.
 *
 * Two things are pinned here. What each kind of missing rule is REPORTED as —
 * the integration suite only ever sees the seeded database, where nothing is
 * missing. And that the catalogue is complete: a service that starts pricing a
 * new action type by string literal, without the catalogue knowing, is the
 * exact way an unpriced action reaches production unseen.
 */

const rule = (actionType: string, over: Partial<RuleInForce> = {}): RuleInForce => ({
  id: `rule-${actionType}`,
  actionType,
  itemClass: null,
  model: 'fixed',
  value: 100,
  currency: 'USD',
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  ...over,
});

const fullyPriced = () =>
  billableActions()
    .filter((a) => a.resolution !== 'code_constant')
    .map((a) => rule(a.actionType));

describe('coverage of the rules in force', () => {
  it('is ready when every rule-priced action has its own rule', () => {
    const report = coverage(billableActions(), fullyPriced());
    expect(report.ready).toBe(true);
    expect(report.summary.missing).toBe(0);
    expect(report.unknownRules).toEqual([]);
  });

  it('reports an empty database — migrations alone — as missing every required price', () => {
    const report = coverage(billableActions(), []);
    expect(report.ready).toBe(false);
    const missing = report.actions.filter((a) => a.status === 'missing').map((a) => a.actionType);
    for (const t of ['intake', 'service', 'storage', 'shipping', 'marketplace_fee', 'parcel_processing']) {
      expect(missing).toContain(t);
    }
    // With its parent gone too, a fallback has nothing to fall back to.
    expect(missing).toContain('grading_fee:psa_value');
    // A free-if-unpriced action is free, and says so rather than "missing".
    expect(report.actions.find((a) => a.actionType === 'shipping_rush')!.status).toBe('free');
    expect(report.actions.find((a) => a.actionType === 'shipping_addon:gps_tracker')!.status).toBe('code_default');
    expect(report.actions.find((a) => a.actionType === 'cash_out_fee')!.status).toBe('code_constant');
  });

  it('reports a tier priced only by its fallback as falling back, and not ready', () => {
    const rules = fullyPriced().filter((r) => r.actionType !== 'grading_fee:psa_value');
    const report = coverage(billableActions(), rules);
    const row = report.actions.find((a) => a.actionType === 'grading_fee:psa_value')!;
    expect(row.status).toBe('falls_back');
    expect(row.fallsBackTo).toBe('service');
    expect(report.ready).toBe(false);
  });

  it('does not count a class-specific rule as pricing the whole action', () => {
    const rules = [
      ...fullyPriced().filter((r) => r.actionType !== 'intake'),
      rule('intake', { id: 'card-only', itemClass: 'trading_card' }),
    ];
    const row = coverage(billableActions(), rules).actions.find((a) => a.actionType === 'intake')!;
    expect(row.status).toBe('missing');
    expect(row.classRules).toBe(1);
  });

  it('reports the newest catch-all rule, which is the one that charges', () => {
    const rules = [
      ...fullyPriced().filter((r) => r.actionType !== 'service'),
      rule('service', { id: 'old', value: 1_000, effectiveFrom: '2026-01-01T00:00:00.000Z' }),
      rule('service', { id: 'new', value: 2_000, effectiveFrom: '2026-06-01T00:00:00.000Z' }),
    ];
    const row = coverage(billableActions(), rules).actions.find((a) => a.actionType === 'service')!;
    expect(row.rule).toMatchObject({ id: 'new', value: 2_000 });
  });

  it('lists a rule the code never reads — a typo is a price that will never be charged', () => {
    const report = coverage(billableActions(), [...fullyPriced(), rule('grading_fee:psa_valeu')]);
    expect(report.unknownRules.map((r) => r.actionType)).toEqual(['grading_fee:psa_valeu']);
  });
});

describe('the catalogue is complete', () => {
  const root = join(__dirname, '..', '..');

  function sources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sources(full, out);
      else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
    }
    return out;
  }

  it('names every action type the API and the worker price by literal', () => {
    const files = [
      ...sources(join(root, 'apps', 'api', 'src', 'modules')),
      ...sources(join(root, 'apps', 'worker', 'src')),
    ];
    const patterns = [
      // pricing.price('x') / tryPrice('x')
      /\b(?:price|tryPrice)\(\s*'([a-z_:]+)'/g,
      // BillingService.charge(tx, { ..., actionType: 'x' }) and feeActionType: 'x'
      /\b(?:feeActionType|actionType):\s*'([a-z_:]+)'/g,
      // FOO_ACTION = 'x'
      /_ACTION\s*=\s*'([a-z_:]+)'/g,
      // the worker's SQL: action_type IN ('a', 'b') / action_type = 'x'
      /action_type\s*(?:IN\s*\(([^)]*)\)|=\s*'([a-z_:]+)')/g,
    ];
    const found = new Set<string>();
    for (const file of files) {
      if (file.endsWith('billable-actions.ts')) continue;
      const text = readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        for (const m of text.matchAll(pattern)) {
          const raw = m.slice(1).filter(Boolean).join(',');
          for (const t of raw.match(/[a-z_:]+/g) ?? []) found.add(t);
        }
      }
    }
    expect(found.size).toBeGreaterThan(10); // the scan found the real call sites

    const known = billableActions().map((a) => a.actionType);
    // A literal ending in ':' is a family prefix built up in SQL
    // ('membership:' || tier); it is covered when the family has members.
    const unknown = [...found].filter((t) =>
      t.endsWith(':') ? !known.some((k) => k.startsWith(t)) : !known.includes(t),
    );
    expect(unknown, 'priced in the code but missing from billable-actions.ts').toEqual([]);
  });
});
