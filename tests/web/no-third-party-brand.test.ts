import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * No other company's name anywhere in the SPA's source (E20 / F058).
 *
 * The FAQ was another company's — ShipMyCards' — copied verbatim, with its
 * addresses, phone number, payment account and a personal referral link, and
 * the i18n catalogue carried three strings attributing it. A brand check on
 * the message catalogue alone had an allowance for exactly those strings, so it
 * could never have caught the thing it existed for.
 *
 * This check has no allowance. It reads every file under `apps/web/src`, of
 * every type, so the name cannot come back in a comment, a fixture, a style
 * sheet or a string table. Case and spacing do not matter: "ShipMyCards",
 * "shipmycards.com" and "Ship My Cards" are all the same company.
 */
const BRAND = /ship\s*my\s*cards/i;

describe('the SPA source names no other company', () => {
  const root = join(__dirname, '..', '..');
  const src = join(root, 'apps', 'web', 'src');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  }

  it('reads the whole tree', () => {
    expect(walk(src).length).toBeGreaterThan(50);
  });

  it('never mentions ShipMyCards, in any spelling, in any file', () => {
    const offenders: string[] = [];
    for (const file of walk(src)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (BRAND.test(line)) offenders.push(`${relative(root, file).split(sep).join('/')}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
