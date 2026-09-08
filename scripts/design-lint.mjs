#!/usr/bin/env node
/**
 * The design-system linter.
 *
 * The brief this redesign was written against assumed a PostToolUse "slop
 * detector" that is not installed in this environment. This stands in for it: a
 * plain Node script, no dependencies, that fails on the specific ways a design
 * system rots — and only on those, because a linter that reports style opinions
 * gets switched off within a week.
 *
 * It checks five things, and each one is a rule from DESIGN.md that a person
 * could break by accident in a hurry:
 *
 *   1. PHYSICAL PROPERTIES. `margin-left`, `padding-right`, `left:`, `right:`,
 *      `text-align: left/right` in CSS; `ml-`/`mr-`/`pl-`/`pr-`/`text-left`/
 *      `text-right` class names in TSX. Bault is bilingual and mirrors through
 *      logical properties; one physical property is one screen that does not.
 *   2. OFF-SCALE VALUES. A px length that is not on the 4px spacing scale, not
 *      on the type scale, and not one of the handful of legitimate exceptions.
 *      This is what "12.5px, 13.5px, 14.5px" looked like before anybody named it.
 *   3. MORE THAN ONE RADIUS / SHADOW / BORDER WEIGHT. Hardcoded `border-radius`
 *      or `box-shadow` outside the token block.
 *   4. RAW COLOUR. A hex or rgb() literal outside the token block. Every colour
 *      in this product has a name and a job.
 *   5. MONO MISUSE. `--font-mono` applied to a selector that is not a code.
 *
 * Usage:
 *   node scripts/design-lint.mjs          # report and exit non-zero on findings
 *   node scripts/design-lint.mjs --quiet  # only the summary line
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const webSrc = join(repoRoot, 'apps', 'web', 'src');
const cssFile = join(webSrc, 'index.css');

/**
 * The token block is where colours, radii and shadows are ALLOWED to be
 * literals — that is what a token is. Everything after it must use the names.
 */
const TOKEN_BLOCK_END = '/* ============================================================\n   Application shell';

/** Lengths that are legitimately off the 4px scale, and why. */
const ALLOWED_PX = new Set([
  '1px', // the border weight
  '2px', // the focus ring, the state rail, the active tab mark
  '3px', // the radius, and the wider state rail on a register row
  '5px', // the register's ruling tick
  '6px', // the status dot
  '7px', // input padding-block
  '10px', // input padding-inline
  '11px',
  '0px',
]);

const TYPE_PX = new Set(['12px', '13px', '14px', '16px', '18px', '22px', '28px', '36px', '48px', '64px']);

/**
 * The scale is "a multiple of 4", not an enumerated list.
 *
 * The list was the first version and it was the wrong shape: it turned every
 * legitimate `min-width: 140px` on a flex basis into a finding, which is how a
 * linter teaches people to stop reading it. What actually went wrong in this
 * stylesheet was 12.5px, 13.5px and 14.5px — quarter-point nudges made screen by
 * screen. A multiple of 4 catches those and nothing else.
 */
function onScale(value) {
  const n = Number.parseFloat(value);
  return Number.isInteger(n) && n % 4 === 0;
}

/** Selectors that are genuinely codes and may take the mono face. */
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

/* ------------------------------------------------------------------ CSS */

/* Normalised: the working tree is CRLF on Windows and every offset below
   assumes single-character line endings. */
const css = readFileSync(cssFile, 'utf8').split('\r\n').join('\n');
const tokenEnd = css.indexOf(TOKEN_BLOCK_END);
if (tokenEnd < 0) throw new Error('token block marker not found in index.css');
const cssLines = css.split('\n');
const tokenEndLine = css.slice(0, tokenEnd).split('\n').length;
const rel = relative(repoRoot, cssFile).split(sep).join('/');

/** Strip comments so prose about `margin-left` is not a finding about one. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

const cssCode = stripComments(css).split('\n');

const PHYSICAL_CSS =
  /(?:^|[\s;{])(margin|padding|border)-(left|right)\b|(?:^|[\s;{])(left|right)\s*:|text-align\s*:\s*(left|right)\b/;

cssCode.forEach((line, i) => {
  const n = i + 1;
  if (PHYSICAL_CSS.test(line)) {
    report(rel, n, `physical property — use the inline-start/inline-end equivalent: ${line.trim()}`);
  }
  if (n <= tokenEndLine) return;

  // A breakpoint is a device width, not a spacing decision.
  const inMediaQuery = /@media/.test(line);
  if (!inMediaQuery) {
    for (const m of line.matchAll(/(?<![\w-])(\d+(?:\.\d+)?px)/g)) {
      const value = m[1];
      if (ALLOWED_PX.has(value) || onScale(value) || TYPE_PX.has(value)) continue;
      report(rel, n, `off-scale length ${value} — 4px base: ${line.trim()}`);
    }
  }
  if (/border-radius\s*:/.test(line) && !/var\(--radius|:\s*0|50%|var\(--r-/.test(line)) {
    report(rel, n, `hardcoded radius — there is one: ${line.trim()}`);
  }
  if (/box-shadow\s*:/.test(line) && !/var\(--shadow|:\s*none|inset/.test(line)) {
    report(rel, n, `hardcoded shadow — there is one, and it is for overlays: ${line.trim()}`);
  }
  for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)) {
    // rgba() over a token is how a scrim is written; a scrim is a legitimate literal.
    if (/rgba\(\s*(?:17|0)\s*,/.test(line) && /background|box-shadow/.test(line)) continue;
    report(rel, n, `raw colour ${m[0]} — every colour has a name: ${line.trim()}`);
  }
});

/* Mono misuse: walk each rule that sets --font-mono and check its selector. */
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

/* ------------------------------------------------------------------ TSX */

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

for (const file of walk(webSrc)) {
  const short = relative(repoRoot, file).split(sep).join('/');
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (PHYSICAL_CLASS.test(line)) report(short, i + 1, `physical utility class: ${line.trim()}`);
      if (PHYSICAL_STYLE.test(line)) {
        report(short, i + 1, `physical inline style — use marginInlineStart / textAlign: 'start': ${line.trim()}`);
      }
    });
}

/* ---------------------------------------------------------------- report */

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
