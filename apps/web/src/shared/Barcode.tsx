import { useMemo } from 'react';
import { barcodeSvg, type BarcodeOptions } from './barcode128';
import { useT } from './i18n';

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

/**
 * Open the print dialog with a one-label document.
 *
 * The iframe is removed after the dialog closes. `onafterprint` fires in every
 * modern browser, but a timeout backstop guarantees cleanup even where it does
 * not (older Safari), so repeated printing never leaks iframes into the DOM.
 */
export function printBarcode(value: string, caption?: string): void {
  let svg: string;
  try {
    // Print at a larger module width than the screen: 3 modules keeps the
    // narrowest bar above the ~0.25mm most laser scanners need at 300dpi.
    svg = barcodeSvg(value, { moduleWidth: 3, height: 90, showText: true });
  } catch {
    return; // unencodable payload — nothing sensible to print
  }

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

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(value)}</title>` +
      `<style>` +
      `@page { margin: 8mm; }` +
      `body { margin: 0; display: flex; align-items: center; justify-content: center; }` +
      `.label { font-family: ui-monospace, Consolas, monospace; text-align: center; }` +
      `.label svg { display: block; margin: 0 auto; }` +
      `.label .caption { margin-top: 6px; font-size: 12px; }` +
      `</style></head><body><div class="label">${svg}` +
      (caption ? `<div class="caption">${escapeHtml(caption)}</div>` : '') +
      `</div></body></html>`,
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

/** Print button, rendered next to a barcode wherever one is displayed. */
export function BarcodePrintButton({
  value,
  caption,
  className = 'btn btn--ghost',
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
      🖨 {t('barcode.print')}
    </button>
  );
}

/** The common pairing: the scannable symbol plus its print button. */
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
