import { AppError } from '../../shared/errors/app-error';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { assemblePdf, escapeText } from '../cst/report-pdf';

export function makeItemSerial(): string {
  return prefixedId(`${ID_PREFIX.item}-${Date.now().toString(36).toUpperCase()}`, 6);
}

export function makeLotSerial(): string {
  return prefixedId(`${ID_PREFIX.lot}-${Date.now().toString(36).toUpperCase()}`, 6);
}

export function makeItemBarcode(serial: string): string {
  return serial;
}

export function makeBinSerial(): string {
  return prefixedId(ID_PREFIX.bin);
}

export function makeBinBarcode(serial: string): string {
  return serial;
}

const CODE128_PATTERNS = [
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
const START_C = 105;
const SWITCH_TO_C = 99;
const SWITCH_TO_B = 100;
const STOP = 106;

const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

export function code128Symbols(value: string): number[] {
  if (value.length === 0) throw AppError.validation('A label needs a code');
  for (let k = 0; k < value.length; k += 1) {
    const cc = value.charCodeAt(k);
    if (cc < 32 || cc > 126) {
      throw AppError.validation(`Code 128 cannot carry ${JSON.stringify(value)}`);
    }
  }
  const n = value.length;
  const digitsFrom = (k: number) => {
    let j = k;
    while (isDigit(value[j])) j += 1;
    return j - k;
  };

  const lead = digitsFrom(0);
  let set: 'B' | 'C' = lead >= 4 || (lead === n && n % 2 === 0) ? 'C' : 'B';
  const symbols = [set === 'C' ? START_C : START_B];
  let i = 0;
  while (i < n) {
    if (set === 'C') {
      if (digitsFrom(i) >= 2) {
        symbols.push(Number(value.slice(i, i + 2)));
        i += 2;
      } else {
        symbols.push(SWITCH_TO_B);
        set = 'B';
      }
      continue;
    }
    const run = digitsFrom(i);
    if (run >= 6 || (run >= 4 && i + run === n)) {
      if (run % 2 === 1) {
        symbols.push(value.charCodeAt(i) - 32);
        i += 1;
      }
      symbols.push(SWITCH_TO_C);
      set = 'C';
      continue;
    }
    symbols.push(value.charCodeAt(i) - 32);
    i += 1;
  }
  const check = symbols.reduce((sum, v, k) => sum + v * Math.max(k, 1), 0) % 103;
  return [...symbols, check, STOP];
}

export function code128Widths(value: string): number[] {
  return code128Symbols(value).flatMap((s) => [...CODE128_PATTERNS[s]!].map(Number));
}

const PT_PER_MM = 72 / 25.4;

export const LABEL = {
  widthMm: 50,
  heightMm: 25,
  dpi: 203,
  barcodeWidthMm: 40,
  barcodeHeightMm: 10,
  quietZoneMm: 3,
  textPt: 8,
} as const;

export interface LabelContent {
  code: string;
  caption: string;
}

const PAGE_W = Number((LABEL.widthMm * PT_PER_MM).toFixed(2));
const PAGE_H = Number((LABEL.heightMm * PT_PER_MM).toFixed(2));
const DOT = 72 / LABEL.dpi;
const PAGE_DOTS = Math.floor((LABEL.widthMm * LABEL.dpi) / 25.4);
const MAX_DOTS = Math.floor((LABEL.barcodeWidthMm * LABEL.dpi) / 25.4);
const BAR_BOTTOM = 12.5 * PT_PER_MM;
const BAR_HEIGHT = LABEL.barcodeHeightMm * PT_PER_MM;
const CODE_BASELINE = 9.4 * PT_PER_MM;
const CAPTION_BASELINE = 5.8 * PT_PER_MM;
const COURIER_ADVANCE = 0.6;
const TEXT_SPAN = PAGE_W - 2 * LABEL.quietZoneMm * PT_PER_MM;

const fmt = (n: number) => Number(n.toFixed(4)).toString();

function centredText(text: string, baseline: number): string {
  const s = text.replace(/[^\x20-\x7e]/g, '?');
  const natural = s.length * COURIER_ADVANCE * LABEL.textPt;
  const size =
    natural > TEXT_SPAN ? Math.floor((TEXT_SPAN / (s.length * COURIER_ADVANCE)) * 10) / 10 : LABEL.textPt;
  const x = (PAGE_W - s.length * COURIER_ADVANCE * size) / 2;
  return `BT /F1 ${fmt(size)} Tf ${fmt(x)} ${fmt(baseline)} Td (${escapeText(s)}) Tj ET`;
}

function labelPage(label: LabelContent): string {
  const widths = code128Widths(label.code);
  const modules = widths.reduce((a, b) => a + b, 0);
  const dotsPerModule = Math.floor(MAX_DOTS / modules);
  if (dotsPerModule < 1) {
    throw AppError.validation(`${JSON.stringify(label.code)} is too long to print on a ${LABEL.widthMm} mm label`);
  }
  let cursor = Math.floor((PAGE_DOTS - modules * dotsPerModule) / 2);
  const lines = ['0 g'];
  widths.forEach((w, k) => {
    const dots = w * dotsPerModule;
    if (k % 2 === 0) {
      lines.push(`${fmt(cursor * DOT)} ${fmt(BAR_BOTTOM)} ${fmt(dots * DOT)} ${fmt(BAR_HEIGHT)} re`);
    }
    cursor += dots;
  });
  lines.push('f');
  lines.push(centredText(label.code, CODE_BASELINE));
  if (label.caption) lines.push(centredText(label.caption, CAPTION_BASELINE));
  return lines.join('\n');
}

export const MAX_LABELS_PER_BATCH = 100;

export function renderLabelsPdf(labels: readonly LabelContent[]): Buffer {
  if (labels.length === 0) throw AppError.validation('No labels to print');
  return assemblePdf(
    labels.map((label) => ({ width: PAGE_W, height: PAGE_H, content: labelPage(label) })),
    ['Courier'],
  );
}
