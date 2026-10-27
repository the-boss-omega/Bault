import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const LINT = join(ROOT, 'scripts', 'design-lint.mjs');
const SRC = join(ROOT, 'apps', 'web', 'src');

function lint(src?: string): { status: number | null; out: string } {
  const run = spawnSync(process.execPath, [LINT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: src ? { ...process.env, DESIGN_LINT_SRC: src } : process.env,
  });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

describe('design-lint', () => {
  it('passes on the real stylesheets and sources', () => {
    const real = lint();
    expect(real.out).toContain('design-lint: clean');
    expect(real.status).toBe(0);
  });

  describe('catches what it exists to catch', () => {
    let copy = '';

    beforeAll(() => {
      copy = mkdtempSync(join(tmpdir(), 'design-lint-'));
    });

    afterAll(() => {
      rmSync(copy, { recursive: true, force: true });
    });

    /** A fresh copy of the web source with one file changed, and what the lint says about it. */
    function withChange(change: (dir: string) => void) {
      rmSync(copy, { recursive: true, force: true });
      cpSync(SRC, copy, { recursive: true });
      change(copy);
      return lint(copy);
    }

    const edit = (dir: string, file: string, fn: (text: string) => string) =>
      writeFileSync(join(dir, file), fn(readFileSync(join(dir, file), 'utf8')));

    it('a text colour that fails AA in the light theme', () => {
      const r = withChange((d) => edit(d, 'theme.css', (t) => t.replace('--muted-foreground: #5f5f68;', '--muted-foreground: #b0b0b8;')));
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/--muted-foreground on --background is [\d.]+:1 in the light theme/);
    });

    it('a field border that fails 3:1 in the dark theme', () => {
      const r = withChange((d) =>
        edit(d, 'theme.css', (t) =>
          t.replace(
            '--control-border: color-mix(in oklab, var(--foreground) 46%, var(--background));',
            '--control-border: color-mix(in oklab, var(--foreground) 12%, var(--background));',
          ),
        ),
      );
      expect(r.out).toMatch(/--control-border on --background is [\d.]+:1 in the dark theme/);
    });

    it('a focus colour that fails 3:1', () => {
      const r = withChange((d) =>
        edit(d, 'theme.css', (t) =>
          t.replace(
            '--focus-color: color-mix(in oklab, var(--foreground) 72%, var(--background));',
            '--focus-color: var(--ring);',
          ),
        ),
      );
      expect(r.out).toMatch(/--focus-color on --background is [\d.]+:1 in the light theme/);
    });

    it('the two dark blocks drifting apart', () => {
      const r = withChange((d) => edit(d, 'theme.css', (t) => t.replace('    --card: #141414;', '    --card: #151515;')));
      expect(r.out).toContain('--card differs between the two dark blocks');
    });

    it('a [dir=rtl] branch outside theme.css', () => {
      const r = withChange((d) => appendFileSync(join(d, 'landing.css'), "\n[dir='rtl'] .x { margin-inline: 0; }\n"));
      expect(r.out).toContain('direction branch');
    });

    it('a left or right keyword in a transform origin or gradient', () => {
      const r = withChange((d) =>
        appendFileSync(join(d, 'app.css'), '\n.x { transform-origin: left center; }\n.y { background: linear-gradient(to right, red, blue); }\n'),
      );
      expect(r.out.match(/physical keyword/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('a border radius that is not from the family', () => {
      const r = withChange((d) => appendFileSync(join(d, 'screens.css'), '\n.x { border-radius: 7px; }\n'));
      expect(r.out).toContain('hardcoded radius 7px');
    });

    it('lets the radius tokens, a circle, none and container-relative corners through', () => {
      const r = withChange((d) =>
        appendFileSync(
          join(d, 'screens.css'),
          '\n.a { border-radius: var(--r-lg); }\n.b { border-radius: calc(var(--r-xl) + 6px); }\n.c { border-radius: 50%; }\n.d { border-radius: 0; }\n.e { border-radius: 3cqw; }\n.f { border-start-end-radius: var(--r-bar); }\n',
        ),
      );
      expect(r.out).toContain('design-lint: clean');
    });

    it('a colour with no name', () => {
      const r = withChange((d) => appendFileSync(join(d, 'gallery.css'), '\n.x { color: oklch(0.5 0.2 30); }\n.y { color: #123abc; }\n'));
      expect(r.out).toContain('raw colour oklch(0.5 0.2 30)');
      expect(r.out).toContain('raw colour #123abc');
    });

    it('lets pure black and white shades through, and custom property definitions', () => {
      const r = withChange((d) =>
        appendFileSync(join(d, 'gallery.css'), '\n.x { box-shadow: 0 4px 12px oklch(0 0 0 / 40%); }\n.y { --edge: oklch(0.6 0.1 40); }\n'),
      );
      expect(r.out).toContain('design-lint: clean');
    });

    it('a paper or room surface that does not say which focus ring reads on it', () => {
      const r = withChange((d) => appendFileSync(join(d, 'app.css'), '\n.x {\n  background: var(--paper);\n}\n'));
      expect(r.out).toContain('.x paints a fixed-palette surface');
    });

    it('lets a fixed-palette surface through once it names its ring', () => {
      const r = withChange((d) =>
        appendFileSync(join(d, 'app.css'), '\n.x {\n  --focus-color: var(--paper-ink);\n  background: var(--paper);\n}\n.y {\n  background: var(--room);\n  --focus-color: var(--room-ink);\n}\n'),
      );
      expect(r.out).toContain('design-lint: clean');
    });

    it('an infinite animation nobody listed', () => {
      const r = withChange((d) => appendFileSync(join(d, 'slab.css'), '\n.x { animation: wobble 2s linear infinite; }\n'));
      expect(r.out).toContain('unlisted infinite animation "wobble"');
    });

    it('a reduced-motion block that no longer silences everything', () => {
      const r = withChange((d) => edit(d, 'motion.css', (t) => t.replace('animation: none !important;', 'animation: none;')));
      expect(r.out).toContain('reduced-motion block must turn off');
    });

    it('smooth scrolling that ignores reduced motion', () => {
      const r = withChange((d) => writeFileSync(join(d, 'probe.tsx'), "el.scrollIntoView({ behavior: 'smooth' });\n"));
      expect(r.out).toContain('smooth scrolling that ignores prefers-reduced-motion');
    });

    it('a physical property in a layer', () => {
      const r = withChange((d) => appendFileSync(join(d, 'components.css'), '\n.x { margin-left: 4px; }\n'));
      expect(r.out).toContain('physical property');
    });
  });
});
