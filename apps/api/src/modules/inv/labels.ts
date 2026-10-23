import { randomInt } from 'node:crypto';
import { ID_PREFIX, prefixedId } from '../../shared/ids';

export function makeItemSerial(): string {
  return `${ID_PREFIX.item}-${Date.now().toString(36).toUpperCase()}-${randomInt(1000, 9999)}`;
}

export function makeLotSerial(): string {
  return `LOT-${Date.now().toString(36).toUpperCase()}-${randomInt(1000, 9999)}`;
}

export function makeItemBarcode(serial: string): string {
  return serial;
}

export function makeBinSerial(): string {
  return prefixedId(ID_PREFIX.bin);
}

export function makeBinBarcode(serial: string): string {
  return serial;
}
