import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nothing in the shipped bundle is a credential.
 *
 * This exists because the obvious guard did not work. `SignInPage` has always
 * wrapped its demo-account line in `import.meta.env.DEV`, which is correct and
 * which everybody reading it assumed was enough. It is not: the guard removes
 * the JSX, and the SENTENCE lived in the i18n catalogue — one object literal
 * that ships whole. So a deployed build contained
 *
 *     Demo users (password ...): … eldar@bault.dev (manager)
 *
 * in plain text, and anyone who opened devtools could search for "password",
 * find the shared one and the administrator's address, and sign in as an
 * administrator. It was found by grepping `dist/` before putting the app behind
 * a public tunnel, which is not a thing anybody should have to remember to do.
 *
 * So the check is on the ARTEFACT, not on the source. A guard that looks right
 * is what caused this; only the built output can say whether it worked.
 *
 * Skipped when there is no build to look at — `pnpm --filter @bault/web build`
 * makes it meaningful. CI builds the web app, so it runs there.
 */

const DIST = join(process.cwd(), 'apps', 'web', 'dist', 'assets');

/**
 * Things that must never appear in a file served to a browser.
 *
 * Deliberately literal. A clever regex for "looks like a password" would catch
 * every hex colour in the stylesheet and be switched off within a week.
 */
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
      // No build here. Nothing to assert, and failing would only teach people
      // to run the suite with a stale dist/ to keep it quiet.
      expect(true).toBe(true);
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
