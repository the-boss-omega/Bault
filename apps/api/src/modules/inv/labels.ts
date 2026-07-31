import { randomInt } from 'node:crypto';

/**
 * Barcode/label payloads (T049).
 *
 * Generates the DATA encoded in Code 128 labels for items and shelves. The
 * warehouse console renders the actual scannable barcode from these strings; a
 * keyboard-wedge scanner reads them straight back into the relocate/dispatch
 * flows. Kept dependency-free here; visual rendering lives in the web console.
 */
export function makeItemSerial(): string {
  // Item IDs carry the BC- ("barcode") prefix so every scannable item label is
  // recognizable at a glance across the warehouse and marketplace.
  return `BC-${Date.now().toString(36).toUpperCase()}-${randomInt(1000, 9999)}`;
}

/**
 * A lot is stored and treated as a SINGLE item, but carries the LOT- prefix so an
 * operator can tell at a glance that the label covers many pieces (Req 9.4/10.5).
 */
export function makeLotSerial(): string {
  return `LOT-${Date.now().toString(36).toUpperCase()}-${randomInt(1000, 9999)}`;
}

export function makeItemBarcode(serial: string): string {
  // Code 128 accepts full ASCII; the serial is a compact, unique payload.
  return serial;
}

export function makeShelfBarcode(zone: string, index: number): string {
  return `BIN-${zone.toUpperCase()}-${String(index).padStart(3, '0')}`;
}
