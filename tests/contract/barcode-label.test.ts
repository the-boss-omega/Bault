import { describe, it, expect } from 'vitest';
import { renderLabelsPdf, LABEL } from '../../apps/api/src/modules/inv/labels';

const MM = 72 / 25.4;

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
  '114131', '311141', '411131', '211412', '211214', '211232',
];
const STOP = '2331112';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Page {
  mediaBox: number[];
  rects: Rect[];
  texts: { x: number; y: number; size: number; text: string }[];
}

function pagesOf(pdf: Buffer): Page[] {
  const src = pdf.toString('latin1');
  expect(src.startsWith('%PDF-1.4\n')).toBe(true);
  expect(src.endsWith('%%EOF')).toBe(true);
  const objects = new Map<number, string>();
  for (const m of src.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)) {
    objects.set(Number(m[1]), m[2]!);
    expect(src.indexOf(`${m[1]} 0 obj\n`)).toBe(m.index);
  }
  const pagesObj = [...objects.values()].find((o) => o.includes('/Type /Pages'))!;
  const kids = [...pagesObj.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  expect(pagesObj).toContain(`/Count ${kids.length}`);
  return kids.map((id) => {
    const page = objects.get(id)!;
    const mediaBox = page
      .match(/\/MediaBox \[([^\]]+)\]/)![1]!
      .trim()
      .split(/\s+/)
      .map(Number);
    const contentId = Number(page.match(/\/Contents (\d+) 0 R/)![1]);
    const stream = objects.get(contentId)!;
    const content = stream.match(/stream\n([\s\S]*)\nendstream/)![1]!;
    expect(stream).toContain(`/Length ${Buffer.byteLength(content, 'latin1')} `);
    const rects = [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      w: Number(m[3]),
      h: Number(m[4]),
    }));
    const texts = [
      ...content.matchAll(/BT \/F\d+ ([\d.]+) Tf ([\d.]+) ([\d.]+) Td \(((?:\\.|[^\\)])*)\) Tj ET/g),
    ].map((m) => ({
      size: Number(m[1]),
      x: Number(m[2]),
      y: Number(m[3]),
      text: m[4]!.replace(/\\(.)/g, '$1'),
    }));
    return { mediaBox, rects, texts };
  });
}

function widthsOf(rects: Rect[]): { widths: number[]; left: number; right: number } {
  const bars = [...rects].sort((a, b) => a.x - b.x);
  const widths: number[] = [];
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i]!;
    if (i > 0) {
      const prev = bars[i - 1]!;
      widths.push(bar.x - (prev.x + prev.w));
    }
    widths.push(bar.w);
  }
  const last = bars[bars.length - 1]!;
  return { widths, left: bars[0]!.x, right: last.x + last.w };
}

function decodeCode128(widths: number[]): string {
  const module = widths.slice(0, 6).reduce((a, b) => a + b, 0) / 11;
  const units = widths.map((w) => Math.round(w / module));
  widths.forEach((w, i) => expect(Math.abs(w - units[i]! * module)).toBeLessThan(module * 0.05));
  expect(units.slice(-7).join('')).toBe(STOP);
  const body = units.slice(0, -7);
  expect(body.length % 6).toBe(0);
  const values: number[] = [];
  for (let i = 0; i < body.length; i += 6) {
    const v = PATTERNS.indexOf(body.slice(i, i + 6).join(''));
    expect(v).toBeGreaterThanOrEqual(0);
    values.push(v);
  }
  const [start, ...rest] = values;
  const check = rest.pop()!;
  const sum = rest.reduce((acc, v, i) => acc + v * (i + 1), start!);
  expect(sum % 103).toBe(check);

  let set = start === 103 ? 'A' : start === 104 ? 'B' : start === 105 ? 'C' : '?';
  expect(set).not.toBe('?');
  let out = '';
  for (const v of rest) {
    if (set === 'C') {
      if (v < 100) out += String(v).padStart(2, '0');
      else if (v === 100) set = 'B';
      else if (v === 101) set = 'A';
      else throw new Error(`unexpected ${v} in set C`);
    } else if (set === 'B') {
      if (v < 96) out += String.fromCharCode(v + 32);
      else if (v === 99) set = 'C';
      else if (v === 101) set = 'A';
      else throw new Error(`unexpected ${v} in set B`);
    } else {
      if (v < 64) out += String.fromCharCode(v + 32);
      else if (v < 96) out += String.fromCharCode(v - 64);
      else if (v === 99) set = 'C';
      else if (v === 100) set = 'B';
      else throw new Error(`unexpected ${v} in set A`);
    }
  }
  return out;
}

const ITEM = { code: 'SN-MTORBD2B-9531', caption: 'SN-MTORBD2B-9531' };
const PARCEL = { code: 'PKG-7KQ2M9XA', caption: 'PKG-7KQ2M9XA' };

describe('the barcode label', () => {
  it('is a 50 by 25 mm page: its MediaBox is exactly 141.73 by 70.87 points', () => {
    const [page] = pagesOf(renderLabelsPdf([ITEM]));
    expect(page!.mediaBox).toEqual([0, 0, 141.73, 70.87]);
  });

  for (const code of [ITEM.code, PARCEL.code, 'SN-123456-0042', '1234567890', '12345', 'BIN-AB12', 'a(b)c\\d 99']) {
    it(`decodes back to ${code}`, () => {
      const [page] = pagesOf(renderLabelsPdf([{ code, caption: code }]));
      expect(decodeCode128(widthsOf(page!.rects).widths)).toBe(code);
    });
  }

  it('draws its bars 10 mm tall, at most 40 mm wide, on whole printer dots at 203 dpi', () => {
    for (const label of [ITEM, PARCEL]) {
      const [page] = pagesOf(renderLabelsPdf([label]));
      const { widths, left, right } = widthsOf(page!.rects);
      const dot = 72 / 203;
      for (const r of page!.rects) expect(r.h).toBeCloseTo(10 * MM, 2);
      expect(right - left).toBeLessThanOrEqual(40 * MM + 0.01);
      expect(right - left).toBeGreaterThan(20 * MM);
      for (const w of widths) expect(Math.abs(w / dot - Math.round(w / dot))).toBeLessThan(0.02);
    }
  });

  it('leaves its quiet zones empty: nothing within 3 mm either side of the bars, across their height', () => {
    for (const label of [ITEM, PARCEL]) {
      const [page] = pagesOf(renderLabelsPdf([label]));
      const { left, right } = widthsOf(page!.rects);
      const bottom = Math.min(...page!.rects.map((r) => r.y));
      const top = Math.max(...page!.rects.map((r) => r.y + r.h));
      expect(left).toBeGreaterThanOrEqual(3 * MM);
      expect(page!.mediaBox[2]! - right).toBeGreaterThanOrEqual(3 * MM);
      for (const r of page!.rects) {
        expect(r.x).toBeGreaterThanOrEqual(left);
        expect(r.x + r.w).toBeLessThanOrEqual(right + 0.001);
      }
      for (const t of page!.texts) {
        expect(t.y + t.size <= bottom || t.y >= top).toBe(true);
      }
    }
  });

  it('prints the code under the bars in an 8 pt monospace face, and the serial or parcel code on the line below', () => {
    const pdf = renderLabelsPdf([{ code: 'SN-MTORBD2B-9531', caption: 'SN-EVS194-0009' }]);
    const [page] = pagesOf(pdf);
    expect(pdf.toString('latin1')).toContain('/BaseFont /Courier');
    const [first, second] = [...page!.texts].sort((a, b) => b.y - a.y);
    expect(page!.texts).toHaveLength(2);
    expect(first!.text).toBe('SN-MTORBD2B-9531');
    expect(first!.size).toBe(8);
    expect(second!.text).toBe('SN-EVS194-0009');
    expect(second!.y).toBeLessThan(first!.y);
    for (const t of page!.texts) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.text.length * t.size * 0.6).toBeLessThanOrEqual(141.73);
    }
  });

  it('gives a batch of three three pages, one label each', () => {
    const codes = ['SN-AAAA1111-0001', 'SN-BBBB2222-0002', PARCEL.code];
    const pages = pagesOf(renderLabelsPdf(codes.map((code) => ({ code, caption: code }))));
    expect(pages).toHaveLength(3);
    pages.forEach((page, i) => {
      expect(page.mediaBox).toEqual([0, 0, 141.73, 70.87]);
      expect(decodeCode128(widthsOf(page.rects).widths)).toBe(codes[i]);
    });
  });

  it('refuses a code Code 128 cannot carry rather than printing a wrong one', () => {
    expect(() => renderLabelsPdf([{ code: 'SN-ÄÖ', caption: '' }])).toThrow();
    expect(() => renderLabelsPdf([{ code: '', caption: '' }])).toThrow();
    expect(() => renderLabelsPdf([{ code: 'X'.repeat(40), caption: '' }])).toThrow();
    expect(() => renderLabelsPdf([])).toThrow();
  });

  it('states its own size', () => {
    expect(LABEL).toMatchObject({ widthMm: 50, heightMm: 25, dpi: 203 });
  });
});
