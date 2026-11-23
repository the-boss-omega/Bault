export type OcrKind = 'label' | 'item';

export interface OcrBlock {
  text: string;
  confidence: number;
}

export interface OcrReading {
  text: string;
  confidence: number;
  blocks: OcrBlock[];
}

export interface OcrProvider {
  readonly name: 'tesseract' | 'sandbox';
  read(imageBytes: Buffer, kind: OcrKind): Promise<OcrReading>;
  close(): Promise<void>;
}

export const SANDBOX_OCR_TEXT: Readonly<Record<OcrKind, string>> = Object.freeze({
  label: [
    'USPS PRIORITY MAIL',
    'FROM: SAM SENDER',
    '12 MAPLE STREET',
    'SPRINGFIELD IL 62704',
    'SHIP TO: CARD EMBASSY',
    'USPS TRACKING # 9400 1000 0000 0000 0000 00',
  ].join('\n'),
  item: ['2005 POKEMON EX DEOXYS #107', 'RAYQUAZA-HOLO', 'GOLD STAR', 'PSA 9 MINT', 'CERT 12345678'].join('\n'),
});

export const SANDBOX_OCR_CONFIDENCE = 0.9;

const unit = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;

function linesOf(text: string, confidence: number): OcrBlock[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ text: line, confidence: unit(confidence) }));
}

function overall(blocks: readonly OcrBlock[]): number {
  if (blocks.length === 0) return 0;
  return unit(blocks.reduce((sum, b) => sum + b.confidence, 0) / blocks.length);
}

export class SandboxOcrProvider implements OcrProvider {
  readonly name = 'sandbox' as const;
  private readonly canned: Record<OcrKind, string>;

  constructor(canned: Partial<Record<OcrKind, string>> = {}) {
    this.canned = { ...SANDBOX_OCR_TEXT, ...canned };
  }

  async read(imageBytes: Buffer, kind: OcrKind): Promise<OcrReading> {
    if (!imageBytes || imageBytes.length === 0) throw new Error('There is no image to read');
    const blocks = linesOf(this.canned[kind], SANDBOX_OCR_CONFIDENCE);
    return { text: blocks.map((b) => b.text).join('\n'), confidence: overall(blocks), blocks };
  }

  async close(): Promise<void> {}
}

interface TesseractLine {
  text: string;
  confidence: number;
}

interface TesseractPage {
  text: string;
  confidence: number;
  blocks?: { paragraphs?: { lines?: TesseractLine[] }[] }[] | null;
}

export interface TesseractWorker {
  recognize(image: Buffer, options?: Record<string, unknown>, output?: Record<string, boolean>): Promise<{ data: TesseractPage }>;
  terminate(): Promise<unknown>;
}

export interface TesseractModule {
  createWorker(langs: string, oem?: number, options?: Record<string, unknown>): Promise<TesseractWorker>;
}

export interface TesseractOptions {
  load: () => Promise<TesseractModule>;
  langPath: string;
}

export class TesseractOcrProvider implements OcrProvider {
  readonly name = 'tesseract' as const;
  private worker: Promise<TesseractWorker> | null = null;

  constructor(private readonly options: TesseractOptions) {
    if (!options.langPath) throw new Error('TesseractOcrProvider needs the directory that holds eng.traineddata');
  }

  private start(): Promise<TesseractWorker> {
    this.worker ??= this.options
      .load()
      .then((tesseract) =>
        tesseract.createWorker('eng', 1, { langPath: this.options.langPath, gzip: true, cacheMethod: 'none' }),
      )
      .catch((err: unknown) => {
        this.worker = null;
        throw err;
      });
    return this.worker;
  }

  async read(imageBytes: Buffer, _kind: OcrKind): Promise<OcrReading> {
    if (!imageBytes || imageBytes.length === 0) throw new Error('There is no image to read');
    const worker = await this.start();
    const { data } = await worker.recognize(imageBytes, {}, { text: true, blocks: true });
    const blocks: OcrBlock[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          const text = line.text.replace(/\s+/g, ' ').trim();
          if (text) blocks.push({ text, confidence: unit(line.confidence / 100) });
        }
      }
    }
    if (blocks.length === 0) blocks.push(...linesOf(data.text ?? '', (data.confidence ?? 0) / 100));
    return {
      text: blocks.map((b) => b.text).join('\n'),
      confidence: unit((data.confidence ?? 0) / 100),
      blocks,
    };
  }

  async close(): Promise<void> {
    const running = this.worker;
    this.worker = null;
    if (running) await (await running).terminate();
  }
}

export type OcrSelection = {
  NODE_ENV: 'development' | 'test' | 'production';
  OCR_PROVIDER: 'tesseract' | 'sandbox';
};

export function createOcrProvider(env: OcrSelection, tesseract?: TesseractOptions): OcrProvider {
  if (env.OCR_PROVIDER === 'tesseract') {
    if (!tesseract) throw new Error('OCR_PROVIDER=tesseract runs in the worker, which loads Tesseract.js');
    return new TesseractOcrProvider(tesseract);
  }
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'OCR_PROVIDER=sandbox returns the same made-up text for every photograph. Use OCR_PROVIDER=tesseract.',
    );
  }
  return new SandboxOcrProvider();
}
