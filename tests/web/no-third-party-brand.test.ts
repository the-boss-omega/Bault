import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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
