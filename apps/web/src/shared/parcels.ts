import type { MessageKey, TranslateFn } from './i18n';
import type { StatusTone } from './ui/primitives';

/**
 * The SPA's vocabulary for inbound parcels.
 *
 * Statuses come straight from the API's `parcel_status` enum. They are listed
 * here in full rather than filtered to "the interesting ones": a status the UI
 * cannot name renders as a raw enum value, which is how `dispatched` and
 * `cancelled` ended up on the shipment tracking list describing states the API
 * never had.
 */
export type ParcelStatus =
  | 'expected'
  | 'received'
  | 'opened'
  | 'processed'
  | 'unclaimed'
  | 'disposed';

export const PARCEL_TONE: Record<string, StatusTone> = {
  expected: 'neutral',
  received: 'info',
  opened: 'warning',
  processed: 'success',
  // Somebody's property with no owner attached — the one state that needs a
  // person to do something about it.
  unclaimed: 'error',
  disposed: 'violet',
};

const STATUS_KEY: Record<string, MessageKey> = {
  expected: 'parcel.status.expected',
  received: 'parcel.status.received',
  opened: 'parcel.status.opened',
  processed: 'parcel.status.processed',
  unclaimed: 'parcel.status.unclaimed',
  disposed: 'parcel.status.disposed',
};

export function parcelStatusLabel(t: TranslateFn, status: string): string {
  const key = STATUS_KEY[status];
  return key ? t(key) : status.replace(/_/g, ' ');
}

const CONDITION_KEY: Record<string, MessageKey> = {
  sound: 'parcel.condition.sound',
  packaging_damaged: 'parcel.condition.packaging_damaged',
  contents_damaged: 'parcel.condition.contents_damaged',
};

export function parcelConditionLabel(t: TranslateFn, condition: string): string {
  const key = CONDITION_KEY[condition];
  return key ? t(key) : condition.replace(/_/g, ' ');
}

/** The arrival check options an operator picks from when opening a parcel. */
export const PARCEL_CONDITIONS: readonly { key: string; labelKey: MessageKey }[] = [
  { key: 'sound', labelKey: 'parcel.condition.sound' },
  { key: 'packaging_damaged', labelKey: 'parcel.condition.packaging_damaged' },
  { key: 'contents_damaged', labelKey: 'parcel.condition.contents_damaged' },
];

/** One row of `GET /me/parcels`. */
export interface ParcelSummary {
  id: string;
  code: string;
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  declaredContents: string | null;
  internationalOrigin: boolean;
  expectedAt: string | null;
  receivedAt: string | null;
  openedAt: string | null;
  processedAt: string | null;
  forwardedAt: string | null;
  condition: string | null;
  conditionNotes: string | null;
  facilityCode: string | null;
  facilityName: string | null;
}

/** One row of `GET /parcels` — the warehouse queue. */
export interface ParcelQueueRow extends Omit<ParcelSummary, 'declaredContents'> {
  addressedTo: string | null;
  ownerUsername: string | null;
  declaredContents: string | null;
  facilityRole: string | null;
}

/** `GET /me/inbound-addresses`. */
export interface InboundAddress {
  facilityId: string;
  code: string;
  name: string;
  role: 'primary' | 'forwarding';
  careOf: string;
  lines: string[];
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string | null;
  salesTaxBps: number;
  forwardingDays: number | null;
}

/** `GET /parcels/workflow/status`. */
export interface ParcelWorkflow {
  awaitingOpen: number;
  awaitingProcessing: number;
  unclaimed: number;
  oldestReceivedAt: string | null;
  oldestWaitingHours: number | null;
}

/**
 * The address block, as a person would write it on a label.
 *
 * Returned as lines rather than one joined string so the UI can render it in a
 * `<pre>`-like block and offer a copy button that copies exactly what a seller
 * needs to paste into a checkout.
 */
export function addressLines(address: InboundAddress): string[] {
  return [
    address.careOf,
    ...address.lines,
    `${address.city}, ${address.region} ${address.postalCode}`,
    address.country,
  ];
}

/** Basis points → a display percentage, e.g. 6625 → "6.625%". */
export function taxRateLabel(bps: number): string {
  if (bps === 0) return '0%';
  return `${(bps / 100).toFixed(3).replace(/\.?0+$/, '')}%`;
}

/**
 * What a purchase of `amountMinor` would cost in destination sales tax at this
 * address. Guidance only — Bault is not the seller and remits nobody's tax.
 */
export function estimatedTaxMinor(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10_000);
}
