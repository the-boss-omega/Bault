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

    it('a theme.css that is no longer in the shape the lint reads', () => {
      const r = withChange((d) => edit(d, 'theme.css', (t) => t.replaceAll(":root[data-theme='dark']", ":root[data-theme='night']")));
      expect(r.status).toBe(1);
      expect(r.out).toContain('theme.css is not in the shape the lint reads');
    });

    it('a dark theme that does not tell the browser it is dark', () => {
      const r = withChange((d) =>
        edit(d, 'theme.css', (text) => text.replace(/:root\[data-theme='dark'\] \{\n {2}color-scheme: dark;\n\}/, ":root[data-theme='dark'] {\n}")),
      );
      expect(r.status).toBe(1);
      expect(r.out).toContain("must declare color-scheme: dark");
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

    it('arithmetic on a radius token, which is a size the family does not have', () => {
      const r = withChange((d) => appendFileSync(join(d, 'landing.css'), '\n.x { border-radius: calc(var(--r-xl) + 6px); }\n'));
      expect(r.status).toBe(1);
      expect(r.out).toContain('hardcoded radius calc(var(--r-xl) + 6px)');
    });

    it('lets the radius tokens, a circle, none and container-relative corners through', () => {
      const r = withChange((d) =>
        appendFileSync(
          join(d, 'screens.css'),
          '\n.a { border-radius: var(--r-lg); }\n.b { border-radius: var(--r-xl) var(--r-xl) 0 0; }\n.c { border-radius: 50%; }\n.d { border-radius: 0; }\n.e { border-radius: 3cqw; }\n.f { border-start-end-radius: var(--r-bar); }\n',
        ),
      );
      expect(r.out).toContain('design-lint: clean');
    });

    it('space that is off the 4px grid', () => {
      const r = withChange((d) => appendFileSync(join(d, 'screens.css'), '\n.x { padding: 7px 12px; }\n.y { gap: 5px; margin-inline-start: -9px; }\n'));
      expect(r.status).toBe(1);
      expect(r.out).toContain('padding 7px is off the 4px grid');
      expect(r.out).toContain('gap 5px is off the 4px grid');
      expect(r.out).toContain('margin-inline-start 9px is off the 4px grid');
    });

    it('space off the grid in index.css too, and a length that is on no scale at all', () => {
      const r = withChange((d) => appendFileSync(join(d, 'index.css'), '\n.x { padding: 7px 12px; }\n.y { margin-block-start: 3px; width: 11px; }\n'));
      expect(r.status).toBe(1);
      expect(r.out).toContain('index.css:');
      expect(r.out).toContain('padding 7px is off the 4px grid');
      expect(r.out).toContain('margin-block-start 3px is off the 4px grid');
      expect(r.out).toContain('off-scale length 11px');
    });

    it('lets multiples of four, the half steps, tokens, and sizes that are not space through', () => {
      const r = withChange((d) =>
        appendFileSync(
          join(d, 'screens.css'),
          '\n.a { padding: 4px 6px 10px 6px; padding-inline-start: 14px; margin: -12px 2px; }\n.b { gap: 1px var(--sp-3); inset: calc(var(--sp-3) + 6px) 0; }\n.c { inline-size: 26px; font-size: 13px; border-inline-start: 3px solid var(--border); }\n',
        ),
      );
      expect(r.out).toContain('design-lint: clean');
    });

    it('a colour with no name', () => {
      const r = withChange((d) => appendFileSync(join(d, 'gallery.css'), '\n.x { color: oklch(0.5 0.2 30); }\n.y { color: #123abc; }\n'));
      expect(r.out).toContain('raw colour oklch(0.5 0.2 30)');
      expect(r.out).toContain('raw colour #123abc');
    });

    it('lets pure black and white shades through, and a custom property that points at a name', () => {
      const r = withChange((d) =>
        appendFileSync(join(d, 'gallery.css'), '\n.x { box-shadow: 0 4px 12px oklch(0 0 0 / 40%); }\n.y { --edge: var(--border); --veil: oklch(0 0 0 / 20%); }\n'),
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

    it('the first-edition stylesheet is held to the same rules as the layers', () => {
      const r = withChange((d) =>
        appendFileSync(
          join(d, 'index.css'),
          [
            '.a { margin-left: 4px; }',
            "[dir='rtl'] .b { margin-inline: 0; }",
            '.c { border-radius: 7px; }',
            '.d { box-shadow: 0 2px 4px #123456; }',
            '.e { color: #123abc; }',
            '.f { font-family: var(--font-mono); }',
            '.g { animation: wobble 2s linear infinite; }',
            '.h { font-size: 15px; }',
            '.i { font: 500 17px/1.3 var(--font-display); }',
            '',
          ].join('\n'),
        ),
      );
      expect(r.status).toBe(1);
      expect(r.out).toContain('physical property');
      expect(r.out).toContain('direction branch');
      expect(r.out).toContain('hardcoded radius');
      expect(r.out).toContain('hardcoded shadow');
      expect(r.out).toContain('raw colour #123abc');
      expect(r.out).toContain('mono on a non-code selector');
      expect(r.out).toContain('unlisted infinite animation "wobble"');
      expect(r.out).toContain('15px is not a step of the type scale');
      expect(r.out).toContain('17px is not a step of the type scale');
    });

    it('lets the type scale, a token and a size relative to the text through in index.css, and the sizes of single objects in a layer', () => {
      const r = withChange((d) => {
        appendFileSync(
          join(d, 'index.css'),
          ['.a { font-size: 14px; }', '.b { font-size: var(--fs-sm); }', '.c { font-size: 0.95em; }', '.d { font: 500 13px/1.3 var(--font-mono); }', ''].join('\n'),
        );
        appendFileSync(join(d, 'screens.css'), '\n.e { font: 500 112px/1 var(--font-display); font-size: 11.5px; }\n');
      });
      expect(r.out).toContain('design-lint: clean');
    });

    it('a date forced left to right, which a Hebrew page draws the wrong way round', () => {
      const r = withChange((d) =>
        writeFileSync(join(d, 'probe.tsx'), 'export const A = () => (\n  <span className="hint" dir="ltr">\n    {formatDate(x, locale)}\n  </span>\n);\n'),
      );
      expect(r.status).toBe(1);
      expect(r.out).toContain('a date forced left to right');
    });

    it('lets a serial be an island and a date stand in the direction of the page', () => {
      const r = withChange((d) =>
        writeFileSync(
          join(d, 'probe.tsx'),
          'export const A = () => (\n  <p>\n    <bdi dir="ltr">{serial}</bdi> · <span className="date">{formatDate(x, locale)}</span>\n    <input dir="ltr" value={formatDate(x, locale)} />\n  </p>\n);\n',
        ),
      );
      expect(r.out).toContain('design-lint: clean');
    });

    it('a physical utility class or inline style in a component', () => {
      const r = withChange((d) => writeFileSync(join(d, 'probe.tsx'), 'export const A = () => <div className="ml-4 text-left" style={{ marginLeft: 4 }} />;\n'));
      expect(r.out).toContain('physical utility class');
      expect(r.out).toContain('physical inline style');
    });

    it('print on the paper, or text on the room, that stops being readable', () => {
      const paper = withChange((d) => edit(d, 'theme.css', (t) => t.replace('--paper-ink: #15130f;', '--paper-ink: #9a968c;')));
      expect(paper.out).toMatch(/--paper-ink on --paper is [\d.]+:1 in the (light|dark) theme/);

      const room = withChange((d) => edit(d, 'theme.css', (t) => t.replace('--room-ink: oklch(0.93 0 0);', '--room-ink: oklch(0.4 0 0);')));
      expect(room.out).toMatch(/--room-ink on --room(-deep|-raised|-case|-pool)? is [\d.]+:1/);
    });

    it('a physical property in a layer', () => {
      const r = withChange((d) => appendFileSync(join(d, 'components.css'), '\n.x { margin-left: 4px; }\n'));
      expect(r.out).toContain('physical property');
    });
  });

  /**
   * The same rules, said the other way: a reviewer planted seventeen violations that were each equivalent to
   * one a rule already forbade, and the lint caught one. Each is planted again here, in the spelling that
   * got past it, and in the place that got past it.
   */
  describe('does not let the same mistake through in another spelling', () => {
    let copy = '';

    beforeAll(() => {
      copy = mkdtempSync(join(tmpdir(), 'design-lint-spelling-'));
    });

    afterAll(() => {
      rmSync(copy, { recursive: true, force: true });
    });

    function planted(file: string, text: string) {
      rmSync(copy, { recursive: true, force: true });
      cpSync(SRC, copy, { recursive: true });
      writeFileSync(join(copy, file), text);
      return lint(copy);
    }

    const cases: Array<[string, string, string, RegExp]> = [
      ['a four-value margin that names a side', 'app.css', '.x { margin: 0 8px 0 0; }', /four-value shorthand names its right/],
      ['a four-value padding that names a side', 'screens.css', '.x { padding: var(--sp-1) 0 var(--sp-1) var(--sp-3); }', /four-value shorthand names its right/],
      ['a four-value inset that names a side', 'screens.css', '.x { inset: 0 0 0 12px; }', /four-value shorthand names its right/],
      ['a float', 'app.css', '.x { float: left; }', /physical property/],
      ['a clear', 'app.css', '.x { clear: right; }', /physical property/],
      ['a physical corner', 'landing.css', '.x { border-top-left-radius: var(--r-lg); }', /physical property/],
      ['corners that are not mirrored', 'landing.css', '.x { border-radius: var(--r-lg) 0 0 var(--r-lg); }', /corners that are not mirrored/],
      ['space in rem', 'screens.css', '.x { padding: 0.3rem; }', /off the 4px grid/],
      ['space in em', 'screens.css', '.x { margin-block-start: 0.5em; }', /glyph's own size/],
      ['an angle that points one way', 'gallery.css', '.x { background: linear-gradient(90deg, var(--card), var(--muted)); }', /points one way/],
      ['a conic angle that points one way', 'gallery.css', '.x { background: conic-gradient(from 30deg, var(--card), var(--muted)); }', /points one way/],
      ['a move that goes the same way in both languages', 'motion.css', '.x { transform: translateX(12px); }', /goes the same way in both languages/],
      ['a three-dimensional move', 'motion.css', '.x { transform: translate3d(-100%, 0, 0); }', /goes the same way in both languages/],
      ['the translate property', 'motion.css', '.x { translate: 8px 0; }', /goes the same way in both languages/],
      ['a position that names a side', 'app.css', '.x { background: url(a.png) no-repeat right center; }', /names left or right/],
      ['a loop spelled with its longhand', 'slab.css', '.x { animation-name: wobble; animation-duration: 2s; animation-iteration-count: infinite; }', /unlisted infinite animation "wobble"/],
      ['a loop with no name beside its count', 'slab.css', '.x { animation-iteration-count: infinite; }', /no animation-name beside it/],
      ['a loop that is second in a list', 'slab.css', '.x { animation: slab-breathe 7s linear infinite, wobble 2s linear infinite; }', /unlisted infinite animation "wobble"/],
      ['a named colour', 'gallery.css', '.x { color: rebeccapurple; border-color: red; }', /the colour "rebeccapurple" has no name/],
      ['a named colour in a gradient', 'gallery.css', '.x { background: linear-gradient(var(--card), tomato); }', /the colour "tomato" has no name/],
      ['a colour function the lint did not know', 'gallery.css', '.x { color: lab(50% 40 59); }', /raw colour lab\(50% 40 59\)/],
      ['a colour named in a layer, as a custom property', 'components.css', ':root { --mine: #ff8800; }', /colours are named in theme.css, not in a layer/],
      ['the paper, brighter, with no ring', 'app.css', '.x {\n  background: var(--paper-bright);\n}', /paints a fixed-palette surface/],
      ['a block that takes its own text\'s direction and aligns to it', 'app.css', '.x { unicode-bidi: plaintext; text-align: start; }', /hangs from that text's edge/],
    ];

    for (const [name, file, css, expected] of cases) {
      it(name, () => {
        const r = planted(file, `\n${css}\n`);
        expect(r.status).toBe(1);
        expect(r.out).toMatch(expected);
      });
    }

    it('a stylesheet nobody listed, which is held the same way the day it is added', () => {
      const r = planted('brand-new.css', '.x { margin-left: 4px; color: #123abc; animation: wobble 2s linear infinite; }\n');
      expect(r.status).toBe(1);
      expect(r.out).toContain('brand-new.css');
      expect(r.out).toContain('physical property');
      expect(r.out).toContain('raw colour #123abc');
      expect(r.out).toContain('unlisted infinite animation "wobble"');
    });

    it('a date made another way and forced left to right', () => {
      for (const call of ['d.toLocaleDateString(locale)', 'new Intl.DateTimeFormat(locale).format(d)', 'd.toLocaleTimeString(locale)']) {
        const r = planted('probe.tsx', `export const A = () => (\n  <span dir="ltr">\n    {${call}}\n  </span>\n);\n`);
        expect(r.status).toBe(1);
        expect(r.out).toContain('a date forced left to right');
      }
    });

    it('a timer that never stops', () => {
      const r = planted('probe.tsx', 'useEffect(() => {\n  const id = setInterval(() => setTick((n) => n + 1), 1000);\n  return () => clearInterval(id);\n}, []);\n');
      expect(r.status).toBe(1);
      expect(r.out).toContain('an interval that runs for as long as the page is open');
    });

    it('a physical corner or a float in an inline style', () => {
      const r = planted('probe.tsx', "export const A = () => <div style={{ float: 'left', borderTopLeftRadius: 4 }} />;\n");
      expect(r.out).toContain('physical inline style');
    });

    it('lets what is symmetric, mirrored or declared through', () => {
      const r = planted(
        'screens.css',
        [
          '.a { padding: 4px 8px; margin: 0 var(--sp-2) 0 var(--sp-2); inset: 0 4px; }',
          '.b { border-radius: var(--r-lg) var(--r-lg) 0 0; }',
          '.c { background: linear-gradient(calc(90deg * var(--dir)), var(--card), var(--muted)); }',
          '.d { background: linear-gradient(180deg, var(--card), var(--muted)); }',
          '.e { transform: translateX(calc(12px * var(--dir))); }',
          '.f { transform: translateX(var(--tab-x, 0)) translateY(-4px) rotate(20deg); }',
          '.g { padding: 0.5rem 0.25rem; margin-block: 0.125rem; }',
          '.h { color: black; background: white; border-color: transparent; outline-color: currentColor; }',
          '.i { /* design-lint-allow: a hatch, either diagonal reads the same */ background: repeating-linear-gradient(135deg, var(--card) 0 4px, transparent 4px 8px); }',
          '.j { animation: slab-breathe 7s linear infinite; }',
          '.k { unicode-bidi: plaintext; text-align: var(--text-start); }',
          '.l { padding-block-start: 0.4em; /* design-lint-allow: attached to the glyph */ }',
          '',
        ].join('\n'),
      );
      expect(r.out).toContain('design-lint: clean');
    });
  });
});
