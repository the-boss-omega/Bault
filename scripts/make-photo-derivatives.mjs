#!/usr/bin/env node
// Writes assets/images/w640/<name>.webp for every photograph in assets/images.
//
// The card photographs are 0.5 to 1.4 MB PNGs. A slab shows one at most 400 px
// wide, so the front page was moving eight megabytes to draw five of them.
// CardPhoto asks for the 640 px WebP first and falls back to the original, so
// this script is an optimisation and nothing breaks if it has not been run.
//
//   node scripts/make-photo-derivatives.mjs [--width 640] [--quality 0.84]
//
// It uses the Chromium that design-screens already drives (canvas -> WebP), so
// it adds no dependency.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(repoRoot, 'assets', 'images');
const outDir = join(srcDir, 'w640');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const width = opt('width', 640);
const quality = opt('quality', 0.84);

const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await chromium.launch({ executablePath, channel: executablePath ? undefined : 'chrome' });
const page = await browser.newPage();
mkdirSync(outDir, { recursive: true });

let before = 0;
let after = 0;
for (const file of readdirSync(srcDir).sort()) {
  const ext = extname(file).toLowerCase();
  if (ext !== '.png' && ext !== '.jpg') continue;
  const bytes = readFileSync(join(srcDir, file));
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  const dataUrl = await page.evaluate(
    async ({ src, w, q }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const scale = Math.min(1, w / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', q);
    },
    { src: `data:${mime};base64,${bytes.toString('base64')}`, w: width, q: quality },
  );
  const out = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(join(outDir, `${basename(file, ext)}.webp`), out);
  before += bytes.length;
  after += out.length;
  process.stdout.write(`  ${file}  ${(bytes.length / 1024).toFixed(0)} kB -> ${(out.length / 1024).toFixed(0)} kB\n`);
}
await browser.close();
process.stdout.write(`\n${(before / 1024 / 1024).toFixed(1)} MB -> ${(after / 1024 / 1024).toFixed(1)} MB\n`);
