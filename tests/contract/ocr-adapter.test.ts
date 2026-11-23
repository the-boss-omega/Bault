import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import {
  SANDBOX_OCR_TEXT,
  SandboxOcrProvider,
  TesseractOcrProvider,
  createOcrProvider,
  type OcrBlock,
  type TesseractModule,
} from '@bault/adapters';
import {
  certificateShapeOk,
  guessCarrier,
  parseItem,
  parseLabel,
} from '../../apps/api/src/modules/inv/ocr-parse';

const GLYPHS: Record<string, string> = {
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11110 00001 00001 01110 00001 00001 11110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11100 10010 10001 10001 10001 10010 11100',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 01110 00010',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 10101 01010',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
  ':': '00000 01100 01100 00000 01100 01100 00000',
  '/': '00001 00001 00010 00100 01000 10000 10000',
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function textPng(lines: readonly string[], scale = 2): Buffer {
  const cell = 6 * scale;
  const row = 10 * scale;
  const margin = 4 * scale;
  const width = Math.max(...lines.map((l) => l.length)) * cell + 2 * margin;
  const height = lines.length * row + 2 * margin;
  const pixels = Buffer.alloc(width * height, 255);
  lines.forEach((line, r) => {
    [...line].forEach((ch, i) => {
      const rows = GLYPHS[ch]?.split(' ');
      if (!rows) throw new Error(`no glyph for "${ch}"`);
      rows.forEach((bits, y) => {
        [...bits].forEach((bit, x) => {
          if (bit !== '1') return;
          for (let dy = 0; dy < scale; dy += 1) {
            for (let dx = 0; dx < scale; dx += 1) {
              pixels[(margin + r * row + y * scale + dy) * width + margin + i * cell + x * scale + dx] = 0;
            }
          }
        });
      });
    });
  });
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const LABEL_FIXTURE = ['FROM: JOE DOE', '12 OAK ST', 'TRACKING 1Z999AA10123456784'];
const ITEM_FIXTURE = ['RAYQUAZA', 'GOLD STAR', 'CERT 12345678'];

const workerRequire = createRequire(
  join(dirname(fileURLToPath(import.meta.url)), '../../apps/worker/package.json'),
);

function tesseract(): TesseractOcrProvider {
  const data = dirname(workerRequire.resolve('@tesseract.js-data/eng/package.json'));
  return new TesseractOcrProvider({
    load: async () => workerRequire('tesseract.js') as TesseractModule,
    langPath: join(data, '4.0.0_best_int'),
  });
}

const blocks = (text: string, confidence = 0.8): OcrBlock[] =>
  text.split('\n').map((line) => ({ text: line, confidence }));

describe('the Tesseract provider on two synthetic photographs', () => {
  const reader = tesseract();
  afterAll(async () => {
    await reader.close();
  });

  it('builds fixtures that are small images and no customer data', () => {
    for (const png of [textPng(LABEL_FIXTURE), textPng(ITEM_FIXTURE, 3)]) {
      expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(png.length).toBeLessThan(50 * 1024);
    }
  });

  it('reads a parcel label into lines with a confidence each, and the parser finds the sender', async () => {
    const reading = await reader.read(textPng(LABEL_FIXTURE), 'label');
    expect(reading.blocks.length).toBeGreaterThanOrEqual(2);
    for (const block of reading.blocks) {
      expect(block.text).not.toBe('');
      expect(block.confidence).toBeGreaterThanOrEqual(0);
      expect(block.confidence).toBeLessThanOrEqual(1);
    }
    expect(reading.confidence).toBeGreaterThan(0);
    expect(reading.text).toMatch(/FROM/);
    expect(reading.text).toMatch(/DOE/);
    const parsed = parseLabel(reading.blocks);
    expect(parsed.fields.senderName).toMatch(/DOE/);
    expect(parsed.confidence.senderName).toBeGreaterThan(0);
  }, 120_000);

  it('reads a card into lines, and the parser finds the card name', async () => {
    const reading = await reader.read(textPng(ITEM_FIXTURE, 3), 'item');
    expect(reading.text).toMatch(/RAYQUAZA/);
    expect(reading.text).toMatch(/CERT/);
    const parsed = parseItem(reading.blocks);
    expect(parsed.fields.cardName).toBe('RAYQUAZA');
    expect(parsed.confidence.cardName).toBeGreaterThan(0);
  }, 120_000);

  it('refuses an empty image instead of reading nothing', async () => {
    await expect(reader.read(Buffer.alloc(0), 'item')).rejects.toThrow(/no image/);
  });
});

describe('the sandbox provider and the choice between them', () => {
  it('returns its canned text for each kind, line by line, with a confidence', async () => {
    const sandbox = new SandboxOcrProvider();
    const label = await sandbox.read(Buffer.from('any bytes'), 'label');
    expect(label.text).toBe(SANDBOX_OCR_TEXT.label);
    expect(label.blocks.every((b) => b.confidence === 0.9)).toBe(true);
    const item = await new SandboxOcrProvider({ item: 'RAYQUAZA\nPSA 10' }).read(Buffer.from('x'), 'item');
    expect(item.blocks.map((b) => b.text)).toEqual(['RAYQUAZA', 'PSA 10']);
    await expect(sandbox.read(Buffer.alloc(0), 'label')).rejects.toThrow(/no image/);
  });

  it('uses the sandbox unless Tesseract is named, and never the sandbox in production', () => {
    expect(createOcrProvider({ NODE_ENV: 'test', OCR_PROVIDER: 'sandbox' })).toBeInstanceOf(SandboxOcrProvider);
    expect(() => createOcrProvider({ NODE_ENV: 'production', OCR_PROVIDER: 'sandbox' })).toThrow(/OCR_PROVIDER=tesseract/);
    expect(() => createOcrProvider({ NODE_ENV: 'test', OCR_PROVIDER: 'tesseract' })).toThrow(/worker/);
    const options = { load: async () => ({}) as TesseractModule, langPath: '/nowhere' };
    expect(createOcrProvider({ NODE_ENV: 'production', OCR_PROVIDER: 'tesseract' }, options)).toBeInstanceOf(
      TesseractOcrProvider,
    );
  });
});

describe('the parser on text alone: a parcel label', () => {
  it('reads every field of the sandbox label', () => {
    const { fields, confidence } = parseLabel(blocks(SANDBOX_OCR_TEXT.label, 0.9));
    expect(fields).toEqual({
      trackingNumber: '9400100000000000000000',
      carrier: 'USPS',
      senderName: 'SAM SENDER',
      senderAddress: '12 MAPLE STREET\nSPRINGFIELD IL 62704',
    });
    expect(confidence).toEqual({ trackingNumber: 0.9, carrier: 0.9, senderName: 0.9, senderAddress: 0.9 });
  });

  it('guesses the carrier from the shape of the number', () => {
    expect(guessCarrier('1Z999AA10123456784')).toBe('UPS');
    expect(guessCarrier('9400 1000 0000 0000 0000 00')).toBe('USPS');
    expect(guessCarrier('EC123456789US')).toBe('USPS');
    expect(guessCarrier('RR123456789GB')).toBe('Postal service');
    expect(guessCarrier('123456789012')).toBe('FedEx');
    expect(guessCarrier('123456789012345')).toBe('FedEx');
    expect(guessCarrier('9612345678901234567890')).toBe('FedEx');
    expect(guessCarrier('JJD0123456789012')).toBe('DHL');
    expect(guessCarrier('1234567890')).toBe('DHL');
    expect(guessCarrier('12345')).toBeNull();
  });

  it('takes the USPS number out of a barcode that carries the ZIP code first', () => {
    const { fields } = parseLabel(blocks('42062704 9205 5000 0000 0000 0000 00'));
    expect(fields.trackingNumber).toBe('9205500000000000000000');
    expect(fields.carrier).toBe('USPS');
  });

  it('does not take a ten-digit phone number for a DHL waybill unless the line says it is one', () => {
    expect(parseLabel(blocks('PHONE 5551234567')).fields.trackingNumber).toBeUndefined();
    expect(parseLabel(blocks('DHL WAYBILL 5551234567')).fields).toMatchObject({
      trackingNumber: '5551234567',
      carrier: 'DHL',
    });
  });

  it('reads a sender whose name is on the line after FROM, and stops the address at the addressee', () => {
    const text = ['SHIP FROM', 'ACME CARDS LLC', '1 MAIN RD', 'AUSTIN TX 78701', 'SHIP TO', 'CARD EMBASSY'].join('\n');
    const { fields } = parseLabel(blocks(text));
    expect(fields.senderName).toBe('ACME CARDS LLC');
    expect(fields.senderAddress).toBe('1 MAIN RD\nAUSTIN TX 78701');
  });

  it('guesses no sender without a FROM line, and nothing at all from nothing', () => {
    expect(parseLabel(blocks('SOME BOX\nFRAGILE')).fields).toEqual({});
    expect(parseLabel([]).fields).toEqual({});
  });
});

describe('the parser on text alone: a card', () => {
  it('reads every field of the sandbox card', () => {
    const { fields, confidence } = parseItem(blocks(SANDBOX_OCR_TEXT.item, 0.9));
    expect(fields).toEqual({
      cardName: 'RAYQUAZA-HOLO',
      setName: 'POKEMON EX DEOXYS',
      cardNumber: '107',
      year: '2005',
      gradingBody: 'PSA',
      grade: '9',
      certNumber: '12345678',
    });
    expect(Object.values(confidence).every((c) => c === 0.9)).toBe(true);
  });

  it('reads a set line, a slash number, a half grade and a Beckett label', () => {
    const text = ['RAYQUAZA VMAX', 'EVOLVING SKIES SET 218/203', '2021', 'BECKETT 9.5 GEM MINT', '0012345678'].join('\n');
    expect(parseItem(blocks(text)).fields).toEqual({
      cardName: 'RAYQUAZA VMAX',
      setName: 'EVOLVING SKIES SET',
      cardNumber: '218/203',
      year: '2021',
      gradingBody: 'BGS',
      grade: '9.5',
      certNumber: '0012345678',
    });
  });

  it('reads a grade from the grade words when no body is printed beside it', () => {
    expect(parseItem(blocks('GEM MT 10')).fields.grade).toBe('10');
  });

  it('suggests only a certificate number of the shape its grading body prints', () => {
    expect(parseItem(blocks('PSA 8\nCERT 1234567')).fields.certNumber).toBeUndefined();
    expect(parseItem(blocks('PSA 8\nCERT 12345678')).fields.certNumber).toBe('12345678');
    expect(parseItem(blocks('SGC 9\nCERT 123456789')).fields.certNumber).toBeUndefined();
    expect(parseItem(blocks('NO BODY\n1234567')).fields.certNumber).toBe('1234567');
  });
});

describe('certificate numbers are checked for shape only', () => {
  it.each([
    ['PSA', '12345678', true],
    ['PSA', '1234567', false],
    ['PSA', '123456789', false],
    ['BGS', '0012345678', true],
    ['BGS', '123456789', false],
    ['CGC', '1234567', true],
    ['CGC', '1234567890', true],
    ['CGC', '123456', false],
    ['CGC', '12345678901', false],
    ['SGC', '1234567', true],
    ['SGC', '12345678', true],
    ['SGC', '123456789', false],
    ['PSA', '1234567A', false],
  ] as const)('%s %s is %s', (body, cert, ok) => {
    expect(certificateShapeOk(body, cert)).toBe(ok);
  });
});
