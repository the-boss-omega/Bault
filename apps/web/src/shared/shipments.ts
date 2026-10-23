import type { MessageKey, TranslateFn } from './i18n';
import type { StatusTone } from './ui/primitives';

export interface ShipmentSummary {
  id: string;
  code: string | null;
  status: string;
  username: string | null;
  customerName: string | null;
  recipientName: string | null;
  carrier: string | null;
  serviceLevel: string | null;
  trackingNumber: string | null;
  labelRefused?: { at: string | null; reason: string | null } | null;
  estimatedDeliveryAt: string | null;
  rush: boolean;
  cost: number | null;
  currency: string | null;
  itemIds: string[];
  items: { id: string; serialNumber: string | null; barcode: string | null; description: string | null }[];
  directParcel: { code: string; trackingNumber: string | null } | null;
  destinationAddress: string;
  destinationCountry: string;
  destinationPostalCode: string;
  serviceKey: string | null;
  serviceMode: string;
  fulfilmentMethod: string;
  quoteMinor: number | null;
  quoteNotes: string | null;
  declaredValueMinor: number;
  insuredValueMinor: number;
  insurancePremiumMinor: number;
  signatureRequired: boolean;
  addOns: { key: string }[];
  boxSize: string | null;
  customerNotes: string | null;
  groupId: string | null;
  paymentDueAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  restockingFeeMinor: number;
  mergedIntoShipmentId: string | null;
  createdAt: string;
  updatedAt: string | null;
  fulfilledAt: string | null;
}

export const SHIPMENT_TONE: Record<string, StatusTone> = {
  requested: 'warning',
  awaiting_payment: 'error',
  rates_selected: 'info',
  picking: 'info',
  packed: 'info',
  labeled: 'info',
  shipped: 'gold',
  in_transit: 'gold',
  delivered: 'success',
  exception: 'error',
  cancelled: 'neutral',
};

export function shipmentStatusLabel(t: TranslateFn, status: string): string {
  return t(`ss.shipmentStatus.${status}` as MessageKey);
}

export function matchesShipmentSearch(shipment: ShipmentSummary, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return [
    shipment.username ?? '',
    shipment.customerName ?? '',
    shipment.recipientName ?? '',
    shipment.trackingNumber ?? '',
    shipment.status,
    shipment.carrier ?? '',
    shipment.code ?? '',
    shipment.createdAt.slice(0, 10),
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

export const PREPARING_STATUSES: readonly string[] = [
  'requested',
  'awaiting_payment',
  'rates_selected',
  'picking',
  'packed',
  'labeled',
];

export function isInTransit(status: string): boolean {
  return status === 'shipped' || status === 'in_transit';
}
