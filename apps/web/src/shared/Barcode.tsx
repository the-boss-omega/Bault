import { useMemo } from 'react';
import { barcodeSvg, type BarcodeOptions } from './barcode128';
import { useT } from './i18n';
import { IconPrint } from './ui/icons';

export function Barcode({ value, options }: { value: string; options?: BarcodeOptions }) {
  const t = useT();
  const svg = useMemo(() => {
    try {
      return barcodeSvg(value, options);
    } catch {
      return null;
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

export interface PrintableLabel {
  value: string;
  caption?: string;
}

export function printBarcode(value: string, caption?: string): void {
  printBarcodes([{ value, caption }]);
}

export function printBarcodes(labels: readonly PrintableLabel[]): void {
  const printable = labels
    .map((label) => {
      try {
        return { ...label, svg: barcodeSvg(label.value, { moduleWidth: 3, height: 90, showText: true }) };
      } catch {
        return null;
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

  win.focus();
  win.print();
  window.setTimeout(cleanup, 60_000);
}

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
