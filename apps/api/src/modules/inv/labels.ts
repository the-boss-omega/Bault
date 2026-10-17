import { randomInt } from 'node:crypto';
import { ID_PREFIX, prefixedId } from '../../shared/ids';

/**
 * Barcode/label payloads (T049).
 *
 * Generates the DATA encoded in Code 128 labels for items and shelves. The
 * warehouse console renders the actual scannable barcode from these strings; a
 * keyboard-wedge scanner reads them straight back into the relocate/dispatch
 * flows. Kept dependency-free here; visual rendering lives in the web console.
 */
export function makeItemSerial(): string {
  // Item serials carry the SN- ("serial number") prefix so every scannable item
  // label is recognizable at a glance across the warehouse and marketplace. The
  // barcode is this same string (see makeItemBarcode).
  return `${ID_PREFIX.item}-${Date.now().toString(36).toUpperCase()}-${randomInt(1000, 9999)}`;
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

/**
 * A shelf's SERIAL: its identity, and the string on its label.
 *
 * Drawn at random from the shared alphabet (no 0/O or 1/I to confuse), so it
 * means nothing beyond "this shelf": it is not a count that two operators can
 * race on, it does not reveal how much shelving the building has, and it does
 * not change when the shelf moves zone. The zone stays a separate, changeable
 * label. See `0019_bins_get_a_serial`.
 */
export function makeBinSerial(): string {
  return prefixedId(ID_PREFIX.bin);
}

/**
 * The barcode IS the serial, exactly as it is for an item.
 *
 * One string on the label, and no second identifier that can disagree with it.
 */
export function makeBinBarcode(serial: string): string {
  return serial;
}
