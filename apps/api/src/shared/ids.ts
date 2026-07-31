import { randomInt } from 'node:crypto';

/**
 * Human-recognizable, prefixed entity IDs (Requirement 9).
 *
 * Every entity type gets a scannable, glanceable code with its own prefix so a
 * warehouse operator or admin can tell what an ID refers to at a glance:
 *   OW-  owner (intake)      BC-  item/barcode      BIN- storage bin
 *   SHP- shipment            SR-  service request   DSP- dispute
 *   LOT- lot / batch         TXN- marketplace transaction
 *
 * Ambiguous characters (0/O, 1/I) are excluded for readability. Uniqueness is
 * ultimately enforced by DB unique indexes; callers retry on the rare collision.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function prefixedId(prefix: string, length = 8): string {
  let suffix = '';
  for (let i = 0; i < length; i += 1) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${suffix}`;
}

export const ID_PREFIX = {
  owner: 'OW',
  item: 'BC',
  bin: 'BIN',
  shipment: 'SHP',
  serviceRequest: 'SR',
  dispute: 'DSP',
  lot: 'LOT',
  transaction: 'TXN',
} as const;

export const newShipmentCode = () => prefixedId(ID_PREFIX.shipment);
