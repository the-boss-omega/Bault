#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { contrast, mixOklab, over, parseColor } from './lib/color.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// DESIGN_LINT_SRC points the lint at another copy of the web source; the lint's own tests use it.
const webSrc = process.env.DESIGN_LINT_SRC ?? join(repoRoot, 'apps', 'web', 'src');
const cssFile = join(webSrc, 'index.css');

const TOKEN_BLOCK_END = '/* ============================================================\n   Application shell';

// Lengths in index.css that are not on the 4px scale: the hairline, the half steps
// (2, 6, 10) and the 3px bar that marks a state down a row's leading edge.
const ALLOWED_PX = new Set(['0px', '1px', '2px', '3px', '6px', '10px']);

const TYPE_PX = new Set(['12px', '13px', '14px', '16px', '18px', '22px', '28px', '36px', '48px', '64px']);

function onScale(value) {
  const n = Number.parseFloat(value);
  return Number.isInteger(n) && n % 4 === 0;
}

const CODE_SELECTORS = [
  '.code',
  'code',
  '.mono',
  '.serial',
  '.code-inline',
  '.rail-count',
  '.state-count',
  '.barcode',
  '.detail-value[dir=',
  '.data-table td[dir=',
];

const findings = [];
const quiet = process.argv.includes('--quiet');

function report(file, line, message) {
  findings.push({ file, line, message });
}

const css = readFileSync(cssFile, 'utf8').split('\r\n').join('\n');
const tokenEnd = css.indexOf(TOKEN_BLOCK_END);
if (tokenEnd < 0) throw new Error('token block marker not found in index.css');
const cssLines = css.split('\n');
const tokenEndLine = css.slice(0, tokenEnd).split('\n').length;
const rel = relative(repoRoot, cssFile).split(sep).join('/');

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

const cssCode = stripComments(css).split('\n');

/**
 * Space is laid out on the 4px grid, Tailwind's spacing scale, which the kit uses:
 * padding, margin, gap and inset are multiples of four or one of its half steps
 * (2, 6, 10 and 14px), with the 1px hairline for optical nudges. Sizes are not held
 * to it here (a glyph is the size it is drawn at); the spaces between things are.
 * It holds for index.css after its token block, and for every layer.
 */
const SPACING_HALF_STEPS = new Set(['1px', '2px', '6px', '10px', '14px']);
const SPACING_DECLARATION = /(?:^|[\s;{])((?:padding|margin|inset)(?:-[\w-]+)?|gap|row-gap|column-gap)\s*:\s*([^;{}]+)/g;

/**
 * One radius family. A corner is a --r-* token (or the kit's --radius), nothing, a circle,
 * or a size relative to its container (the slab's corners scale with the slab). Arithmetic on
 * a token is not a size the family has: if a corner needs one, it is named in theme.css.
 */
const RADIUS_DECLARATION = /border(?:-(?:start|end)-(?:start|end))?-radius\s*:\s*([^;]+);/;
function checkRadius(file, line, text) {
  const radius = RADIUS_DECLARATION.exec(text)?.[1]?.trim();
  if (!radius || /cqw/.test(radius)) return;
  const atoms = radius.replace(/var\(--(?:r-[\w-]+|radius)\)/g, 'T');
  if (!/^(?:T|0|50%|inherit|initial|unset)(?:\s*\/?\s*(?:T|0|50%))*$/.test(atoms)) {
    report(file, line, `hardcoded radius ${radius} — use a --r-* token (there is one family, and it is named in theme.css): ${text.trim()}`);
  }
}

function checkSpacing(file, line, text) {
  for (const decl of text.matchAll(SPACING_DECLARATION)) {
    for (const px of decl[2].matchAll(/(?<![\w.-])-?(\d+(?:\.\d+)?px)/g)) {
      if (px[1] === '0px' || SPACING_HALF_STEPS.has(px[1]) || onScale(px[1])) continue;
      report(file, line, `${decl[1]} ${px[1]} is off the 4px grid — use a multiple of four, a half step (2, 6, 10, 14) or a --sp-* token: ${text.trim()}`);
    }
  }
}

const PHYSICAL_CSS =
  /(?:^|[\s;{])(margin|padding|border)-(left|right)\b|(?:^|[\s;{])(left|right)\s*:|text-align\s*:\s*(left|right)\b/;

/**
 * Logical properties place things, but they cannot turn a gradient, a transform
 * origin or a background position around. Those multiply by --dir, which
 * theme.css sets once, and that is the only place the stylesheet may ask which way
 * the page is read.
 */
const DIRECTION_BRANCH = /\[dir\s*=|:dir\(/;
const PHYSICAL_KEYWORD =
  /(?:transform-origin|background-position|object-position|mask-position)\s*:[^;]*\b(?:left|right)\b|\bto\s+(?:top\s+|bottom\s+)?(?:left|right)\b/;

/**
 * The loops. Anything that animates forever has to be one of these: the ones that
 * say "waiting" (loaders) and the few living things (the foil on the brand mark
 * and the landing headline, the register's caret, the hero slab's breathing).
 * Adding a loop is allowed; doing it without being asked to name it here is not.
 */
const LOOPS = new Set([
  'shimmer',
  'btn-spin',
  'skel-pulse',
  'boot-breathe',
  'foil-rise',
  'foil-slide',
  'caret',
  'slab-breathe',
]);

function checkLoop(file, line, text) {
  const m = /animation\s*:\s*([\w-]+)[^;]*\binfinite\b/.exec(text);
  if (m && !LOOPS.has(m[1])) report(file, line, `unlisted infinite animation "${m[1]}" — name it in LOOPS in design-lint.mjs: ${text.trim()}`);
}

/**
 * A colour literal is a colour with no name. Pure black or white at some alpha is
 * not one (it only darkens or lightens what is under it, and it is how shadows,
 * glints and mask edges are written); anything else is named once, as a custom
 * property, and referenced. theme.css is where the names are made.
 */
const COLOUR_LITERAL = /oklch\([^)]*\)|hsla?\([^)]*\)|rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g;
const SHADE = /^(?:oklch\(\s*[01]\s+0\s+0(?:\s*\/\s*[\d.]+%?)?\s*\)|#(?:000|0000|fff|ffff|000000|ffffff))$/i;

/**
 * A declared, explained exemption.
 *
 * A `design-lint-allow: <why>` block comment on the line itself, or on either
 * of the two lines above it, silences every rule for that line. (Written
 * without the literal delimiters, which cannot appear inside this comment;
 * holding them apart with a zero-width space would put an invisible
 * character in source and an eslint error.) The comment is stripped
 * before the rules run (so the prose in it is never itself a finding), which is
 * why the ORIGINAL text is what is searched here.
 *
 * Exemptions are declared rather than argued with. A rule that cannot be
 * escaped gets switched off wholesale the first time it is wrong; one that can
 * be escaped in writing, in the file, next to the thing it excuses, stays on.
 */
const cssRaw = css.split('\n');
function allowed(index) {
  for (let i = Math.max(0, index - 2); i <= index; i += 1) {
    if (cssRaw[i]?.includes('design-lint-allow')) return true;
  }
  return false;
}

cssCode.forEach((line, i) => {
  const n = i + 1;
  if (allowed(i)) return;
  if (PHYSICAL_CSS.test(line)) {
    report(rel, n, `physical property — use the inline-start/inline-end equivalent: ${line.trim()}`);
  }
  if (DIRECTION_BRANCH.test(line)) {
    report(rel, n, `direction branch — read var(--dir) (theme.css) instead: ${line.trim()}`);
  }
  checkLoop(rel, n, line);
  if (n <= tokenEndLine) return;
  checkSpacing(rel, n, line);

  const inMediaQuery = /@media/.test(line);
  if (!inMediaQuery) {
    for (const m of line.matchAll(/(?<![\w-])(\d+(?:\.\d+)?px)/g)) {
      const value = m[1];
      if (ALLOWED_PX.has(value) || onScale(value) || TYPE_PX.has(value)) continue;
      report(rel, n, `off-scale length ${value} — 4px base: ${line.trim()}`);
    }
  }
  checkRadius(rel, n, line);
  if (/box-shadow\s*:/.test(line) && !/var\(--shadow|:\s*none|inset/.test(line)) {
    report(rel, n, `hardcoded shadow — there is one, and it is for overlays: ${line.trim()}`);
  }
  for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)) {
    if (/rgba\(\s*(?:17|0)\s*,/.test(line) && /background|box-shadow/.test(line)) continue;
    report(rel, n, `raw colour ${m[0]} — every colour has a name: ${line.trim()}`);
  }
});

/** The rules of a stylesheet (comments already blanked) as { selector, body, line }, at-rules flattened. */
function rulesOf(text) {
  const rules = [];
  const open = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      open.push({ head: text.slice(start, i).trim(), at: i + 1 });
      start = i + 1;
    } else if (ch === '}') {
      const rule = open.pop();
      if (rule && !rule.head.startsWith('@')) {
        rules.push({ selector: rule.head.replace(/\s+/g, ' '), body: text.slice(rule.at, i), line: text.slice(0, rule.at).split('\n').length });
      }
      start = i + 1;
    } else if (ch === ';' && open.length === 0) {
      start = i + 1;
    }
  }
  return rules;
}

/**
 * Two surfaces keep their palette in both themes, the paper (cream) and the room
 * (the dark a card is photographed against). The theme's focus ring is drawn from
 * the theme's own foreground, so on either of them it can be the wrong way round
 * (a light ring on cream, a dark ring on the room). A rule that paints one says
 * which ring reads on it, or says why it needs none.
 */
const FIXED_SURFACE = /background(?:-color)?\s*:[^;]*var\(--(?:paper|room[\w-]*)\)/;

// The theme and motion layers sit outside the token-block rules above, but the
// logical-properties rule, the direction rule, the colour rule and the
// reduced-motion guarantee apply to them too.
const LAYERS = ['theme.css', 'slab.css', 'components.css', 'landing.css', 'app.css', 'gallery.css', 'screens.css', 'motion.css'];
for (const name of LAYERS) {
  const file = join(webSrc, name);
  const short = relative(repoRoot, file).split(sep).join('/');
  const raw = readFileSync(file, 'utf8');
  const rawLines = raw.split('\n');
  const allowedHere = (index) => {
    for (let i = Math.max(0, index - 2); i <= index; i += 1) if (rawLines[i]?.includes('design-lint-allow')) return true;
    return false;
  };
  stripComments(raw)
    .split('\n')
    .forEach((line, i) => {
      if (allowedHere(i)) return;
      const n = i + 1;
      if (PHYSICAL_CSS.test(line)) report(short, n, `physical property — use the inline-start/inline-end equivalent: ${line.trim()}`);
      if (PHYSICAL_KEYWORD.test(line)) report(short, n, `physical keyword — multiply by var(--dir) instead of saying left or right: ${line.trim()}`);
      if (name !== 'theme.css' && DIRECTION_BRANCH.test(line)) {
        report(short, n, `direction branch — read var(--dir) (theme.css) instead: ${line.trim()}`);
      }
      checkLoop(short, n, line);
      checkSpacing(short, n, line);
      if (name !== 'theme.css') checkRadius(short, n, line);
      if (name !== 'theme.css' && !line.includes('data:image')) {
        for (const m of line.matchAll(COLOUR_LITERAL)) {
          // A colour that is the value of a custom property is being named, which is the point.
          if (/--[\w-]+\s*:[^;{}]*$/.test(line.slice(0, m.index))) continue;
          if (!SHADE.test(m[0])) report(short, n, `raw colour ${m[0]} — name it as a token in theme.css: ${line.trim()}`);
        }
      }
    });
  if (name !== 'theme.css') {
    for (const rule of rulesOf(stripComments(raw))) {
      if (!FIXED_SURFACE.test(rule.body) || /--focus-color\s*:/.test(rule.body)) continue;
      if (allowedHere(rule.line - 1)) continue;
      report(short, rule.line, `${rule.selector} paints a fixed-palette surface; set --focus-color to the ring that reads on it (or design-lint-allow why none can be focused there)`);
    }
  }
  if (name === 'motion.css') {
    const reduce = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(raw)?.[1] ?? null;
    if (reduce === null) report(short, 1, 'motion layer has no prefers-reduced-motion: reduce block');
    else if (!/animation:\s*none\s*!important/.test(reduce) || !/transition:\s*none\s*!important/.test(reduce) || !/scroll-behavior:\s*auto\s*!important/.test(reduce)) {
      report(short, 1, 'the reduced-motion block must turn off animation, transition and smooth scrolling for everything, with !important');
    }
  }
}

// ---- The theme's own numbers -------------------------------------------------
// theme.css is the one place colours are made, so it is the one place they are
// measured. Every pair the interface actually draws text or a boundary in is
// checked in BOTH themes, from the values in the file, so changing a token to
// something that fails cannot reach a push.

const themeFile = join(webSrc, 'theme.css');
const themeRel = relative(repoRoot, themeFile).split(sep).join('/');
const themeCss = readFileSync(themeFile, 'utf8').split('\r\n').join('\n');

/** The custom properties declared in the block that opens at `selector`: name to { value, line }. */
function blockOf(selector, from = 0) {
  const at = themeCss.indexOf(selector, from);
  if (at < 0) return null;
  const open = themeCss.indexOf('{', at);
  let depth = 0;
  let close = open;
  for (let i = open; i < themeCss.length; i += 1) {
    if (themeCss[i] === '{') depth += 1;
    else if (themeCss[i] === '}' && --depth === 0) {
      close = i;
      break;
    }
  }
  const firstLine = themeCss.slice(0, open + 1).split('\n').length;
  const out = new Map();
  themeCss
    .slice(open + 1, close)
    .split('\n')
    .forEach((line, i) => {
      const m = /^\s*(--[\w-]+)\s*:\s*(.+?);\s*$/.exec(line);
      if (m) out.set(m[1], { value: m[2], line: firstLine + i });
    });
  return out;
}

const part2 = themeCss.indexOf('Part 2');
const part3 = themeCss.indexOf('Part 3');
const lightBlock = blockOf(':root {');
const darkMedia = blockOf(":root:not([data-theme='light'])");
const darkExplicit = blockOf(":root[data-theme='dark']");
const mapping = blockOf(':root:root {', part2);
const bault = blockOf(':root {', part3);

if (!lightBlock || !darkMedia || !darkExplicit || !mapping || !bault) {
  report(themeRel, 1, 'theme.css is not in the shape the lint reads: light :root, the two dark blocks, the :root:root mapping and the Part 3 :root');
} else {
  // The system-dark block and the explicit dark block are one theme written twice.
  for (const [name, entry] of darkExplicit) {
    const twin = darkMedia.get(name);
    if (!twin || twin.value !== entry.value) {
      report(themeRel, entry.line, `${name} differs between the two dark blocks (the system-dark one has ${twin?.value ?? 'nothing'}); they are one theme written twice`);
    }
  }
  for (const name of darkMedia.keys()) {
    if (!darkExplicit.has(name)) report(themeRel, darkMedia.get(name).line, `${name} is in the system-dark block but not in the explicit dark one`);
  }

  const themes = { light: lightBlock, dark: darkExplicit };
  const resolve = (value, theme, depth = 0) => {
    const v = value.trim();
    if (depth > 8) return null;
    const ref = /^var\((--[\w-]+)\)$/.exec(v);
    if (ref) {
      const entry = themes[theme].get(ref[1]) ?? mapping.get(ref[1]) ?? bault.get(ref[1]);
      return entry ? resolve(entry.value, theme, depth + 1) : null;
    }
    const mix = /^color-mix\(\s*in oklab\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\)$/.exec(v);
    if (mix) {
      const [, a, pct, b] = mix;
      const first = resolve(a, theme, depth + 1);
      const second = resolve(b, theme, depth + 1);
      return first && second ? mixOklab(first, Number(pct), second) : null;
    }
    return parseColor(v);
  };
  const lineOf = (name, theme) => (themes[theme].get(name) ?? mapping.get(name) ?? bault.get(name))?.line ?? 1;

  const SURFACES = ['--background', '--card', '--popover', '--muted', '--secondary', '--accent'];
  const TEXT = 4.5;
  const BOUNDARY = 3;
  const THEME_PAIRS = [
    ['--foreground', SURFACES, TEXT, 'body text'],
    ['--card-foreground', ['--card'], TEXT, 'text on a card'],
    ['--popover-foreground', ['--popover'], TEXT, 'text on an overlay'],
    ['--secondary-foreground', ['--secondary'], TEXT, 'text on a secondary surface'],
    ['--accent-foreground', ['--accent'], TEXT, 'text on an accent surface'],
    ['--muted-foreground', SURFACES, TEXT, 'secondary text'],
    ['--primary-foreground', ['--primary'], TEXT, 'text on a primary button'],
    ['--destructive', ['--background', '--card', '--popover'], TEXT, 'error text'],
    ['--primary', ['--background', '--card'], BOUNDARY, 'the edge of a primary button'],
    ['--focus-color', ['--background', '--card', '--popover', '--muted'], BOUNDARY, 'a focus indicator (WCAG 1.4.11)'],
    ['--control-border', ['--background', '--card', '--muted'], BOUNDARY, "a field's edge (WCAG 1.4.11)"],
  ];
  const measure = (fgName, bgNames, min, why, theme) => {
    const fg = resolve(`var(${fgName})`, theme);
    for (const bgName of bgNames) {
      const bg = resolve(`var(${bgName})`, theme);
      if (!fg || !bg) {
        report(themeRel, lineOf(fgName, theme), `cannot resolve ${fg ? bgName : fgName} in the ${theme} theme to measure ${why}`);
        continue;
      }
      const ratio = contrast(over(fg, bg), bg);
      if (ratio < min) {
        report(themeRel, lineOf(fgName, theme), `${fgName} on ${bgName} is ${ratio.toFixed(2)}:1 in the ${theme} theme; ${why} needs ${min}:1`);
      }
    }
  };
  for (const theme of Object.keys(themes)) {
    for (const [fg, bgs, min, why] of THEME_PAIRS) measure(fg, bgs, min, why, theme);
  }

  // Two surfaces keep their palette in both themes: the paper and the room.
  const PAPER = ['--paper', '--paper-bright'];
  const ROOM = ['--room-deep', '--room', '--room-raised', '--room-case', '--room-pool'];
  for (const theme of Object.keys(themes)) {
    measure('--paper-ink', PAPER, 7, 'print on the paper', theme);
    measure('--paper-ink-2', PAPER, TEXT, 'copy on the paper', theme);
    measure('--paper-ink-3', PAPER, TEXT, 'labels on the paper', theme);
    measure('--room-ink', ROOM, 7, 'text and focus rings on the room', theme);
  }
}

const monoRules = [...cssCode.entries()].filter(([, l]) => /font-family:\s*var\(--font-mono\)/.test(l));
for (const [i] of monoRules) {
  let j = i;
  while (j > 0 && !cssCode[j].includes('{')) j -= 1;
  let k = j;
  const selectorLines = [];
  while (k >= 0 && cssCode[k].trim() !== '' && !cssCode[k].includes('}')) {
    selectorLines.unshift(cssCode[k]);
    if (cssCode[k].includes('{')) break;
    k -= 1;
  }
  while (k > 0 && cssCode[k - 1].trim().endsWith(',')) {
    k -= 1;
    selectorLines.unshift(cssCode[k]);
  }
  const selector = selectorLines.join(' ');
  if (!CODE_SELECTORS.some((c) => selector.includes(c))) {
    report(rel, i + 1, `mono on a non-code selector (${selector.trim().slice(0, 60)}) — mono is for serials, bins and barcodes`);
  }
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const PHYSICAL_CLASS = /\b(?:ml|mr|pl|pr)-\d|\btext-(?:left|right)\b/;
const PHYSICAL_STYLE = /\b(?:marginLeft|marginRight|paddingLeft|paddingRight|textAlign:\s*['"](?:left|right)['"])/;

/**
 * A locale-formatted date is not a left-to-right island. Forced left to right, a Hebrew date
 * (day, month, year) is drawn the other way round; read in the page's direction it keeps the
 * order its language gives it. Serials, codes and amounts are islands; dates are not.
 */
const FORCED_LTR = /\bdir=(?:"ltr"|\{'ltr'\})/;
const DATE_CALL = /\bformatDate(?:Time)?\(/;

for (const file of walk(webSrc)) {
  const short = relative(repoRoot, file).split(sep).join('/');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (FORCED_LTR.test(line) && !/<(?:input|textarea|select)\b/.test(line)) {
      // From the opening tag to the first closing one.
      const inner = lines.slice(i, i + 6).join('\n').split(/<\/[a-z]+>/)[0];
      if (DATE_CALL.test(inner)) {
        report(short, i + 1, `a date forced left to right is drawn the wrong way round in Hebrew — drop dir="ltr" (className="date" if it stands alone): ${line.trim()}`);
      }
    }
    if (PHYSICAL_CLASS.test(line)) report(short, i + 1, `physical utility class: ${line.trim()}`);
    if (PHYSICAL_STYLE.test(line)) {
      report(short, i + 1, `physical inline style — use marginInlineStart / textAlign: 'start': ${line.trim()}`);
    }
    if (/behavior\s*:\s*['"]smooth['"]/.test(line)) {
      report(short, i + 1, `smooth scrolling that ignores prefers-reduced-motion — choose 'auto' when it is set: ${line.trim()}`);
    }
  });
}

if (!quiet) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, items] of byFile) {
    process.stdout.write(`\n${file}\n`);
    for (const it of items) process.stdout.write(`  ${file}:${it.line} — ${it.message}\n`);
  }
}

process.stdout.write(
  findings.length === 0
    ? '\ndesign-lint: clean\n'
    : `\ndesign-lint: ${findings.length} finding(s)\n`,
);
process.exit(findings.length === 0 ? 0 : 1);
