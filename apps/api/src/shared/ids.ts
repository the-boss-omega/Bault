import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function prefixedId(prefix: string, length = 8): string {
  let suffix = '';
  for (let i = 0; i < length; i += 1) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${suffix}`;
}

export const ID_PREFIX = {
  owner: 'OW',
  item: 'SN',
  bin: 'BIN',
  shipment: 'SHP',
  serviceRequest: 'SR',
  dispute: 'DSP',
  lot: 'LOT',
  transaction: 'TXN',
  disposal: 'DSL',
  parcel: 'PKG',
  ticket: 'TKT',
  gradingSubmission: 'GSB',
  shipmentGroup: 'GRP',
  escrow: 'ESC',
  houseListing: 'HSE',
  houseOrder: 'ORD',
} as const;

export const newShipmentCode = () => prefixedId(ID_PREFIX.shipment);
