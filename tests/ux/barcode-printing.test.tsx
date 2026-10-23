import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { printBarcode, printBarcodes } = await import('../../apps/web/src/shared/Barcode');

let printed = '';
let printCalls = 0;

beforeEach(() => {
  printed = '';
  printCalls = 0;

  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue({
    focus: () => {},
    print: () => {
      printCalls += 1;
    },
    onafterprint: null,
  } as unknown as Window);

  vi.spyOn(HTMLIFrameElement.prototype, 'contentDocument', 'get').mockReturnValue({
    open: () => {},
    write: (html: string) => {
      printed = html;
    },
    close: () => {},
  } as unknown as Document);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const LABELS = [
  { value: 'SN-MTORBD2B-9531', caption: '2003 EX Dragon Rayquaza ex #97/97' },
  { value: 'SN-MTORBD2O-2244', caption: '2021 Evolving Skies sealed pack' },
  { value: 'SN-MTORBD2Z-8482', caption: '2005 EX Deoxys Rayquaza Gold Star #107/107' },
];

describe('printing one label', () => {
  it('opens a single dialog carrying the barcode and its caption', () => {
    printBarcode('SN-MTORBD2B-9531', '2003 EX Dragon Rayquaza ex #97/97');

    expect(printCalls).toBe(1);
    expect(printed).toContain('<svg');
    expect(printed).toContain('2003 EX Dragon Rayquaza ex #97/97');
    expect(printed).toContain('<title>SN-MTORBD2B-9531</title>');
  });

  it('ejects no blank page after it', () => {
    printBarcode('SN-MTORBD2B-9531');
    expect(printed).toContain('class="label last"');
    expect(printed).toContain('.label.last { page-break-after: auto');
  });

  it('escapes a caption rather than injecting it', () => {
    printBarcode('SN-MTORBD2B-9531', '<script>alert(1)</script>');
    expect(printed).not.toContain('<script>alert(1)</script>');
    expect(printed).toContain('&lt;script&gt;');
  });
});

describe('printing a whole intake run', () => {
  it('sends every label to ONE dialog', () => {
    printBarcodes(LABELS);

    expect(printCalls).toBe(1);
    for (const label of LABELS) {
      expect(printed).toContain(label.caption);
    }
    expect(printed.match(/class="label/g)).toHaveLength(LABELS.length);
  });

  it('puts each label on its own page, except the last', () => {
    printBarcodes(LABELS);

    expect(printed.match(/class="label"/g)).toHaveLength(LABELS.length - 1);
    expect(printed.match(/class="label last"/g)).toHaveLength(1);
    expect(printed).toContain('page-break-after: always');
  });

  it('names the job by its size when there is more than one', () => {
    printBarcodes(LABELS);
    expect(printed).toContain('<title>3 labels</title>');
  });

  it('skips a payload it cannot encode rather than printing it blank', () => {
    printBarcodes([{ value: 'SN-GOOD-0001' }, { value: 'ראיקוואזה' }]);

    expect(printCalls).toBe(1);
    expect(printed.match(/class="label/g)).toHaveLength(1);
    expect(printed).toContain('SN-GOOD-0001');
  });

  it('opens no dialog at all when nothing can be printed', () => {
    printBarcodes([]);
    expect(printCalls).toBe(0);

    printBarcodes([{ value: 'ראיקוואזה' }]);
    expect(printCalls).toBe(0);
  });
});
