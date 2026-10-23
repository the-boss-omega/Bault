import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = join(process.cwd(), 'apps', 'web', 'dist', 'assets');

const FORBIDDEN: { needle: string; why: string }[] = [
  { needle: '11111111', why: 'the shared seed password' },
  { needle: 'eldar@bault.dev', why: "the administrator's address" },
  { needle: 'hermon@bault.dev', why: "the warehouse operator's address" },
  { needle: 'red@bault.dev', why: "a collector's address" },
  { needle: 'golden@bault.dev', why: "a collector's address" },
  { needle: 'Demo users', why: 'the demo-account line, which names both' },
];

describe('the built bundle', () => {
  it('carries no seeded credentials', () => {
    if (!existsSync(DIST)) {
      expect(
        !process.env.CI,
        `no build at ${DIST}: CI must run \`pnpm --filter @bault/web build\` before this suite`,
      ).toBe(true);
      return;
    }

    const files = readdirSync(DIST).filter((f) => /\.(js|css)$/.test(f));
    expect(files.length, 'no built assets found').toBeGreaterThan(0);

    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(DIST, file), 'utf8');
      for (const { needle, why } of FORBIDDEN) {
        if (text.includes(needle)) hits.push(`${file} contains ${needle} — ${why}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
