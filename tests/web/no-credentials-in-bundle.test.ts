import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nothing in the shipped bundle is a credential.
 *
 * An `import.meta.env.DEV` guard in a component removes the JSX, but a string
 * in the i18n catalogue (one object literal that ships whole) stays in the
 * build. A line such as
 *
 *     Demo users (password ...): … eldar@bault.dev (manager)
 *
 * would then be readable in devtools by anyone, giving away the shared password
 * and the administrator's address. A guard that looks right in the source can
 * still fail, so the check is on the ARTEFACT: only the built output can say
 * whether it worked.
 *
 * Skipped locally when there is no build to look at; `pnpm --filter @bault/web
 * build` makes it meaningful. In CI a missing build FAILS: `ci.yml` builds the
 * SPA before the web suite, and the failure is what stops an edit from quietly
 * dropping that step.
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
      // No build here. Locally there is nothing to assert, and failing would
      // only teach people to run the suite with a stale dist/ to keep it quiet.
      // In CI (GitHub Actions sets CI=true) the build is a pipeline step, so its
      // absence is a broken pipeline, not a pass.
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
