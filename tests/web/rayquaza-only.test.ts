import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const FORBIDDEN = [
  'charizard',
  'pikachu',
  'blastoise',
  'venusaur',
  'bulbasaur',
  'mewtwo',
  'umbreon',
  'lugia',
  'blue-eyes',
  'black lotus',
  'mickey mantle',
  'lebron',
  'luka',
  'fleer jordan',
  'topps chrome',
  'panini prizm',
  'amazing fantasy',
];

const EXEMPT = [
  join('tests', 'web', 'rayquaza-only.test.ts'),
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.claude', 'coverage', 'assets1']);
const EXTENSIONS = ['.ts', '.tsx', '.md', '.css', '.sql'];

function walk(dir: string, root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, root, out);
    } else if (EXTENSIONS.some((e) => entry.endsWith(e))) {
      out.push(relative(root, full));
    }
  }
  return out;
}

describe('the catalogue is Rayquaza only', () => {
  const root = join(__dirname, '..', '..');
  const files = walk(root, root).filter((f) => !EXEMPT.includes(f));

  it('names no other collectible anywhere in the repository', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(root, file), 'utf8').toLowerCase();
      for (const word of FORBIDDEN) {
        if (text.includes(word)) offenders.push(`${file.split(sep).join('/')} :: ${word}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('seeds only Rayquaza, each with a photograph keyed by its serial', () => {
    const seed = readFileSync(join(root, 'apps', 'api', 'src', 'db', 'seed.ts'), 'utf8');
    const items = [...seed.matchAll(/serialNumber: '(SN-[^']+)'/g)].map((m) => m[1]!);
    expect(items.length).toBeGreaterThan(0);

    const photos = new Set(readdirSync(join(root, 'assets', 'images')));
    for (const serial of items) {
      const found = [...photos].some((p) => p.startsWith(`${serial}.`));
      expect(found, `${serial} has no photograph in assets/images`).toBe(true);
    }

    const descriptions = [...seed.matchAll(/serialNumber: '(SN-[^']+)',[\s\S]{0,400}?description: '([^']+)'/g)];
    expect(descriptions.length).toBe(items.length);
    for (const [, serial, description] of descriptions) {
      expect(description!.toLowerCase(), `${serial} is not a Rayquaza`).toContain('rayquaza');
    }
  });

  it('creates only Rayquaza in the test fixtures that name a card at all', () => {
    const fixtures = files.filter((f) => f.startsWith('tests') && (f.endsWith('.ts') || f.endsWith('.tsx')));
    const named = fixtures.flatMap((f) =>
      [...readFileSync(join(root, f), 'utf8').matchAll(/description: '(\d{4} [^']+)'/g)].map((m) => m[1]!),
    );
    expect(named.length).toBeGreaterThan(0);
    for (const description of named) {
      expect(description.toLowerCase(), `${description} is not a Rayquaza`).toContain('rayquaza');
    }
  });
});
