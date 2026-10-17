import type { MessageKey, TranslateFn } from './i18n';
import type { StatusTone } from './ui/primitives';

/**
 * Shipment shapes and search, shared by the tracking list and its drawer.
 *
 * Kept out of the page component so the search rule is directly testable (see
 * `tests/web/shipment-tracking.test.ts`). The list is the only way a user finds
 * a shipment, so the search has to find it.
 */

/** One row of `GET /shipping/shipments`. */
export interface ShipmentSummary {
  /**
   * The immutable internal id. Present because the SPA needs a stable React key
   * and the drawer needs a handle for `?shipment=…`; it is never displayed as
   * something to read or type. The human-facing identifier is `code` (SHP-…).
   */
  id: string;
  code: string | null;
  status: string;
  /** The owner's permanent username, the customer-facing identifier. */
  username: string | null;
  /** The owner's name, derived by the API from their two name fields. */
  customerName: string | null;
  /** Who the parcel is addressed to, as the customer entered it. */
  recipientName: string | null;
  carrier: string | null;
  serviceLevel: string | null;
  /** Supplied by the carrier; null until a label exists. */
  trackingNumber: string | null;
  /** Carrier-quoted ETA, stamped when a rate is selected. Null before that. */
  estimatedDeliveryAt: string | null;
  rush: boolean;
  cost: number | null;
  currency: string | null;
  itemIds: string[];
  /** What is printed on each item's label, in `itemIds` order. */
  items: { id: string; serialNumber: string | null; barcode: string | null; description: string | null }[];
  /** For a direct-overnight shipment, the parcel it is. Null for everything else. */
  directParcel: { code: string; trackingNumber: string | null } | null;
  destinationAddress: string;
  /** ISO country and postal code: what a carrier quotes against. */
  destinationCountry: string;
  destinationPostalCode: string;
  /** The catalogue key of the chosen service, and who chose it. */
  serviceKey: string | null;
  serviceMode: string;
  /** `carrier`, `hand_delivery` or `show_pickup`: how the shipment ends. */
  fulfilmentMethod: string;
  /** A hand delivery's quote, once a person has priced the journey. Null until then. */
  quoteMinor: number | null;
  quoteNotes: string | null;
  /** Customs value the collector declared. Zero on a domestic parcel. */
  declaredValueMinor: number;
  insuredValueMinor: number;
  insurancePremiumMinor: number;
  signatureRequired: boolean;
  addOns: { key: string }[];
  /** The box it was priced in, or null when the warehouse picks. */
  boxSize: string | null;
  /** The customer's notes. The operator's fulfilment notes are elsewhere. */
  customerNotes: string | null;
  groupId: string | null;
  /** When an unpaid shipment's items go back on the shelf. */
  paymentDueAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  restockingFeeMinor: number;
  /** Set when this request was absorbed into another by a merge. */
  mergedIntoShipmentId: string | null;
  createdAt: string;
  updatedAt: string | null;
  fulfilledAt: string | null;
}

/** Status → badge tone. Unknown statuses fall back to neutral. */
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

/**
 * Free-text search across a shipment row.
 *
 * The fields searched are the ones the requirement names (permanent username,
 * customer name, carrier tracking number, status and creation date), plus the
 * recipient name, shipment code and carrier, because they are on screen too.
 *
 * The creation date is matched on its ISO prefix (`2026-08-05`), which is what a
 * user types when they mean a day, and it is locale-independent.
 */
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

/** Statuses that mean the parcel has not left yet. */
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
