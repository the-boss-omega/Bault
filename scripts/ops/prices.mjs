#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { apiBase, argValue, hasFlag, Session, signInAdmin } from './session.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FILE = resolve(here, '..', '..', 'infra', 'production', 'prices.json');

const TRIGGERS = new Set(['per_event', 'daily', 'weekly', 'monthly']);
const STORAGE_ACTIONS = new Set(['storage', 'storage_oversized']);
const STORAGE_PARAMETERS = ['freeDays', 'periodDays', 'percentOfIntakeBps'];
const TIER_PARAMETERS = ['storedItems', 'insuredShipments', 'insuredValueCapMinor', 'postageCreditMinor', 'commissionWaivedOnMinor'];

const say = (msg = '') => process.stdout.write(`${msg}\n`);

export function parseAmount(entry) {
  const where = keyOf(entry);
  const hasFixed = entry.fixed !== undefined;
  const hasPercent = entry.percent !== undefined;
  if (hasFixed === hasPercent) throw new Error(`${where}: give exactly one of "fixed" ("$5.00") or "percent" ("5%")`);
  if (hasFixed) {
    const m = /^\$(\d+)(?:\.(\d{2}))?$/.exec(String(entry.fixed).trim());
    if (!m) throw new Error(`${where}: "fixed" must look like "$5.00", not ${JSON.stringify(entry.fixed)}`);
    return { model: 'fixed', value: Number(m[1]) * 100 + Number(m[2] ?? 0) };
  }
  const m = /^(\d+)(?:\.(\d{1,2}))?%$/.exec(String(entry.percent).trim());
  if (!m) throw new Error(`${where}: "percent" must look like "5%" or "2.5%", not ${JSON.stringify(entry.percent)}`);
  const value = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (value > 10_000) throw new Error(`${where}: a percentage is at most 100%`);
  return { model: 'percentage', value };
}

export function keyOf(rule) {
  return rule.itemClass ? `${rule.actionType} (${rule.itemClass})` : rule.actionType;
}

export function parsePriceFile(doc) {
  if (!doc || !Array.isArray(doc.rules)) throw new Error('The price file needs a "rules" list.');
  if (doc.currency !== undefined && doc.currency !== 'USD') throw new Error('Every price is in USD; the API sets no other currency.');
  if (typeof doc.reviewed !== 'boolean') throw new Error('The price file needs "reviewed": true or false.');
  const seen = new Set();
  const rules = doc.rules.map((entry) => {
    if (typeof entry.actionType !== 'string' || entry.actionType.trim() === '') {
      throw new Error(`Every rule needs an actionType: ${JSON.stringify(entry)}`);
    }
    const where = keyOf(entry);
    if (seen.has(where)) throw new Error(`${where} is in the file twice`);
    seen.add(where);
    if (typeof entry.description !== 'string' || entry.description.trim() === '') {
      throw new Error(`${where}: a description is required; customers read it on the price list`);
    }
    if (!TRIGGERS.has(entry.billingTrigger)) {
      throw new Error(`${where}: billingTrigger must be one of ${[...TRIGGERS].join(', ')}`);
    }
    if (entry.actionType.startsWith('membership:') && entry.parameters !== undefined) {
      throw new Error(`${where}: leave parameters out; a membership's allowances come from the tier catalogue`);
    }
    if (STORAGE_ACTIONS.has(entry.actionType)) {
      for (const p of STORAGE_PARAMETERS) {
        const n = entry.parameters?.[p];
        if (!Number.isInteger(n) || n < 0) {
          throw new Error(`${where}: parameters.${p} must be a whole number; the storage sweep reads it`);
        }
      }
    }
    return {
      actionType: entry.actionType,
      itemClass: entry.itemClass ?? null,
      ...parseAmount(entry),
      billingTrigger: entry.billingTrigger,
      description: entry.description.trim(),
      parameters: entry.parameters ?? null,
    };
  });
  return { reviewed: doc.reviewed, rules };
}

export function readPriceFile(path) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`Could not read ${path}: ${e.message}`);
  }
  return parsePriceFile(doc);
}

export function withTierParameters(rules, tiers) {
  return rules.map((rule) => {
    if (!rule.actionType.startsWith('membership:')) return rule;
    const tier = tiers.find((t) => t.feeActionType === rule.actionType);
    if (!tier) throw new Error(`${rule.actionType} is not a tier the API knows`);
    return { ...rule, parameters: Object.fromEntries(TIER_PARAMETERS.map((p) => [p, tier[p]])) };
  });
}

function canonical(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function inForce(serverRules, now = new Date()) {
  const current = new Map();
  for (const r of serverRules) {
    const from = Date.parse(r.effectiveFrom);
    const to = r.effectiveTo ? Date.parse(r.effectiveTo) : null;
    if (from > now.getTime() || (to !== null && to <= now.getTime())) continue;
    const key = keyOf(r);
    const held = current.get(key);
    if (!held || Date.parse(held.effectiveFrom) < from) current.set(key, r);
  }
  return current;
}

export function differences(want, have) {
  const out = [];
  if (want.model !== have.model) out.push('model');
  if (want.value !== have.value) out.push('value');
  if (want.billingTrigger !== have.billingTrigger) out.push('billingTrigger');
  if (want.description !== (have.description ?? '').trim()) out.push('description');
  if (canonical(want.parameters) !== canonical(have.parameters)) out.push('parameters');
  return out;
}

export function plan(rules, serverRules, now = new Date()) {
  const current = inForce(serverRules, now);
  return rules.map((rule) => {
    const have = current.get(keyOf(rule)) ?? null;
    if (!have) return { rule, have, action: 'load', changes: [] };
    const changes = differences(rule, have);
    return { rule, have, action: changes.length === 0 ? 'same' : 'differs', changes };
  });
}

export function gaps(coverage, rules) {
  const catchAll = new Set(rules.filter((r) => !r.itemClass).map((r) => r.actionType));
  const known = new Set(coverage.actions.map((a) => a.actionType));
  return {
    unpriced: coverage.actions
      .filter((a) => a.resolution !== 'code_constant' && !catchAll.has(a.actionType))
      .map((a) => a.actionType),
    unknown: [...new Set(rules.map((r) => r.actionType))].filter((t) => !known.has(t)),
  };
}

export function money(rule) {
  return rule.model === 'fixed'
    ? `$${Math.floor(rule.value / 100)}.${String(rule.value % 100).padStart(2, '0')}`
    : `${rule.value / 100}%`;
}

function tally(summary) {
  const unpriced = summary.total - summary.priced - summary.codeConstant;
  return `${summary.priced} priced by a rule, ${summary.codeConstant} set in the code, ${unpriced} without a rule of their own`;
}

function payload(rule) {
  return {
    actionType: rule.actionType,
    ...(rule.itemClass ? { itemClass: rule.itemClass } : {}),
    description: rule.description,
    model: rule.model,
    value: rule.value,
    billingTrigger: rule.billingTrigger,
    ...(rule.parameters ? { parameters: rule.parameters } : {}),
  };
}

async function expectOk(res, what) {
  if (res.status >= 200 && res.status < 300) return res.body;
  throw new Error(`${what} answered ${res.status}: ${res.body?.error?.message ?? res.text?.slice(0, 200)}`);
}

function printPlan(steps) {
  const load = steps.filter((s) => s.action === 'load');
  const differs = steps.filter((s) => s.action === 'differs');
  const same = steps.filter((s) => s.action === 'same');
  for (const s of load) say(`  load     ${keyOf(s.rule)}  ${money(s.rule)} ${s.rule.billingTrigger}`);
  for (const s of differs) {
    say(`  differs  ${keyOf(s.rule)}  file ${money(s.rule)}, server ${money(s.have)}  (${s.changes.join(', ')})`);
  }
  say(`  ${load.length} to load, ${differs.length} different from the file, ${same.length} already match.`);
  return { load, differs, same };
}

const USAGE = `Usage: pnpm prices:load --url https://<site> [--file <prices.json>] [--dry-run | --check] [--update] [--allow-unreviewed]

Signs in as an administrator (BAULT_ADMIN_IDENTIFIER, BAULT_ADMIN_PASSWORD and
BAULT_ADMIN_TOTP, or asked for), compares the file with the rules in force, and
creates a rule for every price the server does not have yet.

  --dry-run           show what would be loaded; change nothing
  --check             change nothing; exit 1 unless the server matches the file and coverage is ready
  --update            also replace rules whose price or terms differ from the file
  --allow-unreviewed  load a file whose "reviewed" is false (staging only)`;

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (hasFlag(argv, '--help')) {
    say(USAGE);
    return 0;
  }
  const base = apiBase(argValue(argv, '--url'));
  const file = resolve(argValue(argv, '--file') ?? DEFAULT_FILE);
  const dryRun = hasFlag(argv, '--dry-run');
  const check = hasFlag(argv, '--check');
  const update = hasFlag(argv, '--update');
  const parsed = readPriceFile(file);

  const tiers = await expectOk(await new Session(base).get('/membership/tiers'), 'GET /membership/tiers');
  const rules = withTierParameters(parsed.rules, tiers.tiers);
  const admin = await signInAdmin(base, { env });
  const coverage = await expectOk(await admin.get('/admin/pricing/coverage'), 'GET /admin/pricing/coverage');
  const serverRules = await expectOk(await admin.get('/pricing/rules'), 'GET /pricing/rules');

  say(`Prices from ${file}`);
  say(`Server ${base}: coverage ${coverage.ready ? 'ready' : 'NOT ready'}; ${tally(coverage.summary)}.`);
  const missing = gaps(coverage, rules);
  for (const t of missing.unpriced) say(`  NOT IN FILE  ${t} (the API charges for it; add a rule to the file)`);
  for (const t of missing.unknown) say(`  UNKNOWN      ${t} (the API has no such action; remove it from the file)`);
  for (const u of coverage.unknownRules ?? []) say(`  note: the server has a rule for ${u.actionType}, which the code no longer charges`);

  const steps = plan(rules, serverRules);
  const { load, differs } = printPlan(steps);
  const complete = missing.unpriced.length === 0 && missing.unknown.length === 0;

  if (check) {
    const ok = complete && load.length === 0 && differs.length === 0 && coverage.ready;
    say(ok ? 'CHECK PASSED: the server matches the file.' : 'CHECK FAILED: see above.');
    return ok ? 0 : 1;
  }
  if (dryRun) {
    say('Dry run: nothing changed.');
    return 0;
  }
  if (!complete) {
    say('Refusing to load: the file does not match what the API charges for. Fix the lines above first.');
    return 1;
  }
  const writes = [...load, ...(update ? differs : [])];
  if (writes.length > 0 && !parsed.reviewed && !hasFlag(argv, '--allow-unreviewed')) {
    say(`Refusing to load: ${file} still says "reviewed": false. Its numbers are the development seed's placeholders.`);
    say('Review every price, set "reviewed": true, and run this again. On staging you may pass --allow-unreviewed.');
    return 1;
  }
  if (!parsed.reviewed && writes.length > 0) say('Loading UNREVIEWED placeholder prices (--allow-unreviewed).');

  for (const s of writes) {
    await expectOk(await admin.post('/pricing/rules', payload(s.rule)), `Creating ${keyOf(s.rule)}`);
    say(`  loaded   ${keyOf(s.rule)}  ${money(s.rule)}`);
  }
  if (differs.length > 0 && !update) say(`${differs.length} rule(s) differ from the file and were left alone; --update replaces them.`);

  const after = await expectOk(await admin.get('/admin/pricing/coverage'), 'GET /admin/pricing/coverage');
  say(`Loaded ${writes.length}. Coverage is now ${after.ready ? 'ready' : 'NOT ready'}; ${tally(after.summary)}.`);
  return after.ready ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      process.stderr.write(`prices: ${e.message}\n`);
      process.exit(1);
    },
  );
}
