import type { MessageKey, TranslateFn } from './i18n';
import type { StatusTone } from './ui/primitives';

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

export const PARCEL_CONDITIONS: readonly { key: string; labelKey: MessageKey }[] = [
  { key: 'sound', labelKey: 'parcel.condition.sound' },
  { key: 'packaging_damaged', labelKey: 'parcel.condition.packaging_damaged' },
  { key: 'contents_damaged', labelKey: 'parcel.condition.contents_damaged' },
];

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

export interface ParcelQueueRow extends Omit<ParcelSummary, 'declaredContents'> {
  addressedTo: string | null;
  ownerUsername: string | null;
  declaredContents: string | null;
  facilityRole: string | null;
  itemCount: number;
}

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

export interface ParcelWorkflow {
  awaitingOpen: number;
  awaitingProcessing: number;
  unclaimed: number;
  oldestReceivedAt: string | null;
  oldestWaitingHours: number | null;
}

export function addressLines(address: InboundAddress): string[] {
  return [
    address.careOf,
    ...address.lines,
    `${address.city}, ${address.region} ${address.postalCode}`,
    address.country,
  ];
}

export function taxRateLabel(bps: number): string {
  if (bps === 0) return '0%';
  return `${(bps / 100).toFixed(3).replace(/\.?0+$/, '')}%`;
}

export function estimatedTaxMinor(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10_000);
}
