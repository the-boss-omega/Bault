import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The catalogue is Rayquaza, and nothing else.
 *
 * The seeded catalogue is real Rayquaza cards, each with its real set, collector
 * number, rarity, illustrator, TCG id and its own photograph on disk. Other
 * collectibles creep back in through the side door: a fixture description in
 * an escrow or intake test, a doc comment, a design document. No behavioural
 * test can reach those, so the check is textual, and it runs over the
 * repository rather than over the running product.
 *
 * Directories that are not the product (`.claude/`, `node_modules`, build
 * output, coverage) are skipped.
 */

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

/** Files that legitimately contain a forbidden word, and why. */
const EXEMPT = [
  // This file names them in order to ban them.
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
    /**
     * The standing rule: every seeded item is a genuine collectible, described
     * exactly as its slab reads, with a real photograph and catalogue information
     * matching it. The serial IS the filename: the coupling is by convention
     * with nothing else to enforce it, so this is what enforces it.
     */
    const seed = readFileSync(join(root, 'apps', 'api', 'src', 'db', 'seed.ts'), 'utf8');
    const items = [...seed.matchAll(/serialNumber: '(SN-[^']+)'/g)].map((m) => m[1]!);
    expect(items.length).toBeGreaterThan(0);

    const photos = new Set(readdirSync(join(root, 'assets', 'images')));
    for (const serial of items) {
      const found = [...photos].some((p) => p.startsWith(`${serial}.`));
      expect(found, `${serial} has no photograph in assets/images`).toBe(true);
    }

    // And every description names the card the photograph is of.
    const descriptions = [...seed.matchAll(/serialNumber: '(SN-[^']+)',[\s\S]{0,400}?description: '([^']+)'/g)];
    expect(descriptions.length).toBe(items.length);
    for (const [, serial, description] of descriptions) {
      expect(description!.toLowerCase(), `${serial} is not a Rayquaza`).toContain('rayquaza');
    }
  });

  it('creates only Rayquaza in the test fixtures that name a card at all', () => {
    /**
     * Fixture descriptions are mostly labels — "Band 1: self-accept", "Atomicity"
     * — which name no collectible and are left alone. What is checked is that
     * none of them names a DIFFERENT one, which the forbidden-word sweep above
     * already covers; this pins the positive case for the fixtures that do quote
     * a real card, so they stay quoting real ones.
     */
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
