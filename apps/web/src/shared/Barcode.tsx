import { useMemo } from 'react';
import { barcodeSvg, type BarcodeOptions } from './barcode128';
import { useT } from './i18n';
import { IconPrint } from './ui/icons';

/**
 * Scannable Code 128 barcode + a button that hands the label to the operating
 * system's print dialog.
 *
 * Rendering: the encoder returns SVG markup, injected with
 * `dangerouslySetInnerHTML`. That is safe here because the markup is produced
 * entirely by our own encoder — every payload character is validated against
 * Code 128B and the caption is XML-escaped, so no caller-supplied string reaches
 * the DOM unescaped.
 *
 * Printing: `printBarcode` writes a minimal, self-contained label document into a
 * hidden same-origin iframe and calls `print()` on it, which is what opens the
 * computer's print dialog / printer software with the barcode image. An iframe
 * rather than `window.open` avoids popup blockers, and INLINE SVG rather than an
 * `<img src="data:…">` avoids the classic blank-page race where the dialog opens
 * before the image has decoded.
 */
export function Barcode({ value, options }: { value: string; options?: BarcodeOptions }) {
  const t = useT();
  // Encoding is pure and cheap, but memoize so re-renders don't re-encode.
  const svg = useMemo(() => {
    try {
      return barcodeSvg(value, options);
    } catch {
      return null; // an unencodable payload degrades to plain text, never a crash
    }
  }, [value, options]);

  if (!svg) return <code dir="ltr">{value}</code>;
  return (
    <span
      className="barcode"
      title={t('barcode.scanHint')}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** One label to print: the payload that scans, and the line a human reads. */
export interface PrintableLabel {
  value: string;
  caption?: string;
}

/**
 * Open the print dialog with a one-label document.
 *
 * The iframe is removed after the dialog closes. `onafterprint` fires in every
 * modern browser, but a timeout backstop guarantees cleanup even where it does
 * not (older Safari), so repeated printing never leaks iframes into the DOM.
 */
export function printBarcode(value: string, caption?: string): void {
  printBarcodes([{ value, caption }]);
}

/**
 * Print a whole run in ONE dialog, one label per page.
 *
 * `printBarcode` handled a single label, which was right when the bench booked in
 * one unit at a time. It books in a box now, and twelve units meant twelve trips
 * to the print dialog — twelve confirmations, and no way for an operator who
 * missed one to tell which.
 *
 * `page-break-after` on every label but the last is what makes a run of twelve
 * come out as twelve label-stock pages rather than twelve barcodes crammed onto
 * one sheet. The last one is exempt so a single-label print does not eject a
 * blank page after it.
 */
export function printBarcodes(labels: readonly PrintableLabel[]): void {
  // Print at a larger module width than the screen: 3 modules keeps the
  // narrowest bar above the ~0.25mm most laser scanners need at 300dpi.
  const printable = labels
    .map((label) => {
      try {
        return { ...label, svg: barcodeSvg(label.value, { moduleWidth: 3, height: 90, showText: true }) };
      } catch {
        return null; // an unencodable payload is skipped, never printed blank
      }
    })
    .filter((l): l is PrintableLabel & { svg: string } => l !== null);

  if (printable.length === 0) return;

  const body = printable
    .map(
      (label, index) =>
        `<div class="label${index === printable.length - 1 ? ' last' : ''}">${label.svg}` +
        (label.caption ? `<div class="caption">${escapeHtml(label.caption)}</div>` : '') +
        `</div>`,
    )
    .join('');

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    return;
  }

  const title =
    printable.length === 1 ? escapeHtml(printable[0]!.value) : `${printable.length} labels`;

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
      `<style>` +
      `@page { margin: 8mm; }` +
      `body { margin: 0; font-family: ui-monospace, Consolas, monospace; }` +
      `.label { text-align: center; page-break-after: always; break-after: page;` +
      ` display: flex; flex-direction: column; align-items: center;` +
      ` justify-content: center; min-height: 100vh; }` +
      // The last label does not eject a page after it, so printing one label
      // does not push a blank sheet out behind it.
      `.label.last { page-break-after: auto; break-after: auto; }` +
      `.label svg { display: block; margin: 0 auto; }` +
      `.label .caption { margin-top: 6px; font-size: 12px; }` +
      `</style></head><body>${body}</body></html>`,
  );
  doc.close();

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    frame.remove();
  };
  win.onafterprint = cleanup;

  // The document is fully inline, so it is ready as soon as write/close returns;
  // focus() is required for the dialog to attach to the iframe in Firefox.
  win.focus();
  win.print();
  window.setTimeout(cleanup, 60_000);
}

/**
 * Print every label in a run, in one dialog.
 *
 * Offered beside the labels an intake just produced. Disabled-by-absence rather
 * than disabled-and-grey: with nothing to print there is nothing to render.
 */
export function BarcodePrintAllButton({
  labels,
  className = 'btn btn--gold',
}: {
  labels: readonly PrintableLabel[];
  className?: string;
}) {
  const t = useT();
  if (labels.length === 0) return null;
  return (
    <button
      type="button"
      className={className}
      title={t('barcode.printAll', { count: labels.length })}
      onClick={() => printBarcodes(labels)}
    >
      <IconPrint />
      {t('barcode.printAll', { count: labels.length })}
    </button>
  );
}

/** Print button, rendered next to a barcode wherever one is displayed. */
export function BarcodePrintButton({
  value,
  caption,
  className = 'btn btn--ghost btn--sm',
}: {
  value: string;
  caption?: string;
  className?: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className={className}
      title={t('barcode.print')}
      aria-label={t('barcode.printOf', { value })}
      onClick={() => printBarcode(value, caption)}
    >
      <IconPrint />
      {t('barcode.print')}
    </button>
  );
}

/**
 * The common pairing: the scannable symbol plus its print button.
 *
 * The caption is shown on screen as well as printed. It used to go only to the
 * printer, so a bench of freshly minted labels was a row of identical-looking
 * barcodes with nothing saying which card each one belonged to.
 */
export function BarcodeLabel({
  value,
  caption,
  options,
}: {
  value: string;
  caption?: string;
  options?: BarcodeOptions;
}) {
  return (
    <div className="barcode-label">
      <Barcode value={value} options={options} />
      {caption && caption !== value && <span className="barcode-caption">{caption}</span>}
      <BarcodePrintButton value={value} caption={caption} />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
