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
 * A shelf's SERIAL — its identity, and the string on its label.
 *
 * It used to be `BIN-<zone>-<nnn>`, built by counting the shelves already in
 * that zone. That was a name, not an identifier, and it had a name's problems:
 * the count raced between two operators building out the same zone, it was only
 * stable as long as no bin ever went away, it told anybody holding it how much
 * shelving the building has, and it baked the zone into the identity of the
 * shelf — so moving a shelf between zones either renamed it, invalidating the
 * label stuck to it, or left it lying about where it was.
 *
 * A serial from the shared alphabet has none of that. It is drawn at random from
 * characters chosen so a person reading a label cannot confuse 0 with O or 1
 * with I, it means nothing beyond "this shelf", and the zone goes back to being
 * what it always should have been on its own: a changeable label for a part of
 * the building. See `0019_bins_get_a_serial`.
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
