#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const webSrc = join(repoRoot, 'apps', 'web', 'src');
const cssFile = join(webSrc, 'index.css');

const TOKEN_BLOCK_END = '/* ============================================================\n   Application shell';

const ALLOWED_PX = new Set([
  '1px',
  '2px',
  '3px',
  '5px',
  '6px',
  '7px',
  '10px',
  '11px',
  '0px',
]);

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

const PHYSICAL_CSS =
  /(?:^|[\s;{])(margin|padding|border)-(left|right)\b|(?:^|[\s;{])(left|right)\s*:|text-align\s*:\s*(left|right)\b/;

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
  if (n <= tokenEndLine) return;

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
    if (/rgba\(\s*(?:17|0)\s*,/.test(line) && /background|box-shadow/.test(line)) continue;
    report(rel, n, `raw colour ${m[0]} — every colour has a name: ${line.trim()}`);
  }
});

// The theme and motion layers sit outside the token-block rules above, but the
// logical-properties rule and the reduced-motion guarantee apply to them too.
for (const name of ['theme.css', 'slab.css', 'components.css', 'landing.css', 'app.css', 'gallery.css', 'motion.css']) {
  const file = join(webSrc, name);
  const short = relative(repoRoot, file).split(sep).join('/');
  const raw = readFileSync(file, 'utf8');
  stripComments(raw)
    .split('\n')
    .forEach((line, i) => {
      if (PHYSICAL_CSS.test(line)) report(short, i + 1, `physical property — use the inline-start/inline-end equivalent: ${line.trim()}`);
    });
  if (name === 'motion.css' && !/@media \(prefers-reduced-motion: reduce\)/.test(raw)) {
    report(short, 1, 'motion layer has no prefers-reduced-motion: reduce block');
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
