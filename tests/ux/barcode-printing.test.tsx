import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Printing the labels an intake just produced.
 *
 * The bench books in a whole box now — a Rayquaza ex, a sealed pack and a graded
 * Gold Star, each its own unit with its own serial. Every one of them needs a
 * label stuck on it before it goes to its shelf, and the barcode is what every
 * later scan reads: the shelf scan, the pick, the dispatch.
 *
 * `printBarcode` opened one dialog per label, which was right when the bench
 * booked in one unit at a time. Twelve units meant twelve trips to the print
 * dialog, twelve confirmations, and no way for an operator who missed one to tell
 * which. `printBarcodes` is the whole run in a single dialog.
 *
 * These assert on the DOCUMENT the printer is handed, because that is the part
 * that has to be right — jsdom has no printer, so `print()` itself is stubbed.
 *
 * In the `ux` project rather than `web`: `web` runs on the node environment and
 * has no `HTMLIFrameElement` to spy on, and the print path is entirely about
 * writing a document into one.
 */

const { printBarcode, printBarcodes } = await import('../../apps/web/src/shared/Barcode');

/** The markup written into the hidden print iframe on the last call. */
let printed = '';
let printCalls = 0;

beforeEach(() => {
  printed = '';
  printCalls = 0;

  // jsdom implements neither, and both are called on the print iframe.
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
    // The payload is in the title so the print queue names the job usefully.
    expect(printed).toContain('<title>SN-MTORBD2B-9531</title>');
  });

  it('ejects no blank page after it', () => {
    /**
     * Every label breaks to a new page so a run comes out on label stock rather
     * than crammed onto one sheet — but the LAST one must not, or printing a
     * single label pushes an empty sheet out behind it.
     */
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
    // Twelve units used to mean twelve dialogs.
    printBarcodes(LABELS);

    expect(printCalls).toBe(1);
    for (const label of LABELS) {
      expect(printed).toContain(label.caption);
    }
    expect(printed.match(/class="label/g)).toHaveLength(LABELS.length);
  });

  it('puts each label on its own page, except the last', () => {
    printBarcodes(LABELS);

    // Two of the three break to a new page; the third ends the document.
    expect(printed.match(/class="label"/g)).toHaveLength(LABELS.length - 1);
    expect(printed.match(/class="label last"/g)).toHaveLength(1);
    expect(printed).toContain('page-break-after: always');
  });

  it('names the job by its size when there is more than one', () => {
    printBarcodes(LABELS);
    expect(printed).toContain('<title>3 labels</title>');
  });

  it('skips a payload it cannot encode rather than printing it blank', () => {
    /**
     * Code 128B covers printable ASCII. Anything outside it has no symbol, and a
     * label with no barcode on it is worse than no label — it looks printed.
     */
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
