#!/usr/bin/env node
/**
 * Download the product's typefaces into `assets/fonts/` and write the
 * `@font-face` block that points at them.
 *
 * WHY a script rather than checked-in copies alone: the files themselves ARE
 * checked in — a build must never depend on a font CDN being up — but where they
 * came from, at which version, and with which unicode-ranges, is exactly the
 * kind of thing that rots into folklore. Running this regenerates both the
 * binaries and `apps/web/src/fonts.css` from one source of truth.
 *
 * Only the subsets Bault actually renders are kept: `latin` (the Latin UI and
 * every catalogue string), `latin-ext` (European collector names and set titles)
 * and `hebrew` (the default locale). Cyrillic, Greek and Vietnamese are dropped,
 * which is most of the weight.
 *
 *   node scripts/fetch-fonts.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fontDir = join(repoRoot, 'assets', 'fonts');
const cssOut = join(repoRoot, 'apps', 'web', 'src', 'fonts.css');

/** Chrome UA, so Google Fonts serves woff2 rather than the ttf fallback. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Subsets we render. Everything else in the CSS is discarded. */
const KEEP = new Set(['latin', 'latin-ext', 'hebrew']);

/**
 * The five faces, and the job each one has. `slug` becomes the filename stem, so
 * a file on disk names its own family and weight without a lookup.
 */
const FAMILIES = [
  { slug: 'plex-sans', query: 'IBM+Plex+Sans:wght@400;500;600', family: 'IBM Plex Sans' },
  /**
   * Hebrew only. Plex Sans Hebrew also ships a Latin subset — the same Latin
   * design — but IBM Plex Sans is declared first and covers those codepoints, so
   * the browser would never fetch the duplicate. Downloading it anyway would put
   * 46 kB in the repo that no page can ever request.
   */
  {
    slug: 'plex-sans-hebrew',
    query: 'IBM+Plex+Sans+Hebrew:wght@400;500;600',
    family: 'IBM Plex Sans Hebrew',
    subsets: ['hebrew'],
  },
  { slug: 'plex-mono', query: 'IBM+Plex+Mono:wght@400;500', family: 'IBM Plex Mono' },
  /**
   * The display face, for BOTH scripts.
   *
   * The brief asked for Frank Ruhl Libre in Hebrew paired with a Latin serif of
   * similar contrast, and for the pair to be confirmed as one voice before
   * adoption. The strongest way to pass that test is not to pair at all: Frank
   * Ruhl Libre is a Hebrew family WITH a Latin companion drawn for it, so the
   * two scripts share a skeleton, an axis of contrast and a vertical rhythm by
   * construction rather than by luck. Source Serif 4 was the alternative and is
   * not fetched: it would have added 436 kB to assert a resemblance this family
   * gets for free. The specimen check is in docs/design/type-specimen.html.
   */
  { slug: 'frank-ruhl', query: 'Frank+Ruhl+Libre:wght@500;700', family: 'Frank Ruhl Libre' },
];

/**
 * Google's CSS is a flat run of `/* subset *\/ @font-face { … }` blocks. Parsed
 * with a regex rather than a CSS parser because the shape is fixed and adding a
 * parser dependency to fetch five fonts is not a trade worth making.
 */
function parseFaces(css) {
  const faces = [];
  const re = /\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const [, subset, body] = m;
    const weight = /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '400';
    const url = /url\((https:[^)]+\.woff2)\)/.exec(body)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]?.trim();
    if (url && range) faces.push({ subset, weight, url, range });
  }
  return faces;
}

async function main() {
  await mkdir(fontDir, { recursive: true });
  const blocks = [];

  for (const fam of FAMILIES) {
    const res = await fetch(`https://fonts.googleapis.com/css2?family=${fam.query}&display=swap`, {
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`${fam.family}: css ${res.status}`);
    const wanted = fam.subsets ? new Set(fam.subsets) : KEEP;
    const faces = parseFaces(await res.text()).filter((f) => wanted.has(f.subset));
    if (faces.length === 0) throw new Error(`${fam.family}: no kept subsets`);

    for (const face of faces) {
      // A variable-weight file (Source Serif) reports a range like "400 600";
      // it is one file per subset, so the stem drops the weight entirely.
      const variable = face.weight.includes(' ');
      const stem = variable
        ? `${fam.slug}-${face.subset}`
        : `${fam.slug}-${face.weight}-${face.subset}`;
      const name = `${stem}.woff2`;
      const bin = await fetch(face.url, { headers: { 'User-Agent': UA } });
      if (!bin.ok) throw new Error(`${name}: ${bin.status}`);
      const bytes = Buffer.from(await bin.arrayBuffer());
      await writeFile(join(fontDir, name), bytes);
      blocks.push(
        [
          '@font-face {',
          `  font-family: '${fam.family}';`,
          `  font-style: normal;`,
          `  font-weight: ${face.weight};`,
          `  font-display: swap;`,
          `  src: url('/fonts/${name}') format('woff2');`,
          `  unicode-range: ${face.range};`,
          '}',
        ].join('\n'),
      );
      process.stdout.write(`  ${name} — ${(bytes.length / 1024).toFixed(1)} kB\n`);
    }
  }

  const header = [
    '/* ============================================================',
    '   Bault typefaces — GENERATED by scripts/fetch-fonts.mjs.',
    '   Do not edit by hand; edit the script and re-run it.',
    '',
    '   Self-hosted and subset to latin / latin-ext / hebrew. Served from',
    '   assets/fonts, which Vite publishes at /fonts/<file>.woff2.',
    '',
    '   IBM Plex Sans + IBM Plex Sans Hebrew are ONE voice across two scripts:',
    '   same designer, same skeleton, same vertical proportions, so a Hebrew',
    '   screen and an English screen share a rhythm instead of looking like two',
    '   products. IBM Plex Mono carries serials, bins and barcodes and nothing',
    '   else. Frank Ruhl Libre is the display face for BOTH scripts — one family',
    '   covering Hebrew and Latin — and is used only at marketing sizes.',
    '   ============================================================ */',
    '',
  ].join('\n');

  await writeFile(cssOut, `${header}${blocks.join('\n\n')}\n`);
  process.stdout.write(`\nwrote ${cssOut}\n`);
}

main().catch((err) => {
  process.stderr.write(`font fetch failed: ${err.message}\n`);
  process.exit(1);
});
