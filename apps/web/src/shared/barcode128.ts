/**
 * Dependency-free Code 128 barcode renderer.
 *
 * The API already MINTS barcode payloads — `makeItemSerial()` produces a random
 * `BC-<base36 time>-<4 digits>` item label, `makeShelfBarcode()` produces `BIN-…`,
 * and lots get `LOT-…` (see apps/api/src/modules/inv/labels.ts). Those are just
 * STRINGS, though: nothing in the platform ever drew the scannable bars. This
 * module closes that gap by encoding a payload into real Code 128 and emitting an
 * SVG, so a warehouse operator can print a label a keyboard-wedge scanner reads
 * straight back into the relocate / dispatch flows.
 *
 * Code Set B is used throughout. It covers every printable ASCII character
 * (32–126), which is a superset of everything the platform mints (upper-case
 * letters, digits and dashes). Code C would pack digit pairs more densely, but
 * set B keeps the encoder small enough to be obviously correct — and label real
 * estate is not scarce here.
 *
 * SVG (rather than canvas/PNG) is deliberate: bar edges stay crisp at any print
 * DPI, which is what makes the difference between a label that scans first time
 * and one that does not.
 */

/**
 * The 107 Code 128 symbol patterns, indexed by symbol value.
 *
 * Each string is a run-length encoding of the symbol: digits alternate
 * bar,space,bar,space,bar,space, and each digit is that run's width in modules.
 * Values 0–102 are data, 103/104/105 are START A/B/C, and 106 is STOP (13
 * modules — the only 7-run pattern, because it carries the terminating bar).
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const;

const START_B = 104;
const STOP = 106;

/** Quiet zone: scanners need ≥10 blank modules either side to find the symbol. */
const QUIET_MODULES = 10;

export interface BarcodeOptions {
  /** Width of one module (the narrowest bar) in px. 2 prints reliably at 300dpi. */
  moduleWidth?: number;
  /** Height of the bars in px, excluding the human-readable caption. */
  height?: number;
  /** Render the payload as text under the bars (Code 128 convention). */
  showText?: boolean;
}

/**
 * Encode a payload to Code 128 symbol values (start + data + checksum + stop).
 * Throws on characters set B cannot represent, so a bad label fails loudly at
 * render time rather than printing a symbol no scanner can read.
 */
function encode(value: string): number[] {
  const data: number[] = [];
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new Error(`Code 128B cannot encode "${char}" (charCode ${code})`);
    }
    data.push(code - 32); // set B: value = ASCII - 32
  }

  // Modulo-103 checksum, weighted by 1-based position; the start value has weight 1.
  let checksum = START_B;
  data.forEach((v, i) => {
    checksum += v * (i + 1);
  });

  return [START_B, ...data, checksum % 103, STOP];
}

/** Widths of the alternating bar/space runs, starting with a bar. */
function runs(symbols: number[]): number[] {
  const out: number[] = [];
  for (const symbol of symbols) {
    const pattern = PATTERNS[symbol];
    if (!pattern) throw new Error(`No Code 128 pattern for symbol ${symbol}`);
    for (const digit of pattern) out.push(Number(digit));
  }
  return out;
}

/**
 * Render `value` as a Code 128 SVG string.
 *
 * The output is self-contained (no CSS, no external refs) so the exact same
 * markup can be inlined into a page, embedded in a print document, or written to
 * a `.svg` file and handed to any other program.
 */
export function barcodeSvg(value: string, options: BarcodeOptions = {}): string {
  const moduleWidth = options.moduleWidth ?? 2;
  const height = options.height ?? 64;
  const showText = options.showText ?? true;

  const widths = runs(encode(value));
  const modules = widths.reduce((sum, w) => sum + w, 0);
  const totalModules = modules + QUIET_MODULES * 2;
  const width = totalModules * moduleWidth;
  const captionHeight = showText ? 18 : 0;
  const totalHeight = height + captionHeight;

  // Walk the run lengths, emitting a rect for every bar (even index) and simply
  // advancing the cursor for every space (odd index).
  const bars: string[] = [];
  let cursor = QUIET_MODULES;
  widths.forEach((runWidth, i) => {
    if (i % 2 === 0) {
      bars.push(
        `<rect x="${cursor * moduleWidth}" y="0" width="${runWidth * moduleWidth}" height="${height}" />`,
      );
    }
    cursor += runWidth;
  });

  const caption = showText
    ? `<text x="${width / 2}" y="${height + 14}" text-anchor="middle" ` +
      `font-family="ui-monospace, Consolas, monospace" font-size="12" fill="#000">${escapeXml(value)}</text>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" ` +
    `viewBox="0 0 ${width} ${totalHeight}" role="img" aria-label="Barcode ${escapeXml(value)}">` +
    `<rect x="0" y="0" width="${width}" height="${totalHeight}" fill="#fff" />` +
    `<g fill="#000">${bars.join('')}</g>${caption}</svg>`
  );
}

/** Escape the five XML metacharacters so a payload can never break the markup. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** The SVG as a `data:` URL — a standalone image file usable as an `<img src>`. */
export function barcodeDataUrl(value: string, options: BarcodeOptions = {}): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(barcodeSvg(value, options))}`;
}
