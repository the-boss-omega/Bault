/**
 * Human-readable notification text (Requirement 6.1).
 *
 * Notifications used to be stored as the raw domain-event payload, which the UI
 * could only render as a tuple of opaque strings. Every event type now maps to a
 * proper sentence built from its payload, written here — at dispatch time — into
 * `content.message` alongside the original fields (which stay available for
 * deep-links). Unknown event types degrade to a readable title-cased sentence
 * rather than a JSON dump.
 */

type Payload = Record<string, unknown>;

function str(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function num(payload: Payload, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Integer minor units → `$1,234.56`. Every amount on the platform is USD (Req 7.1). */
function usd(minorUnits: number): string {
  return `$${(minorUnits / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** A short, readable reference for an entity: prefer the human code, else a stub. */
function ref(payload: Payload, ...keys: string[]): string {
  for (const key of keys) {
    const value = str(payload, key);
    if (value) return value.length > 12 ? value.slice(0, 8) : value;
  }
  return 'unknown';
}

function titleCase(eventType: string): string {
  const words = eventType.replace(/[_.]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function notificationMessage(eventType: string, payload: Payload | null): string {
  const p = payload ?? {};
  const amount = num(p, 'amount');
  const price = num(p, 'price');

  switch (eventType) {
    case 'item_received':
      return `Item ${ref(p, 'barcode', 'itemId')} was received into your vault and shelved.`;
    case 'item_sold':
      return price != null
        ? `Your item ${ref(p, 'barcode', 'itemId')} sold for ${usd(price)}.`
        : `Your item ${ref(p, 'barcode', 'itemId')} was sold.`;
    case 'offer_received': {
      const what = str(p, 'itemDescription') ?? `item ${ref(p, 'barcode', 'itemId')}`;
      return amount != null
        ? `You received an offer of ${usd(amount)} on your listing for ${what}.`
        : `You received a new offer on your listing for ${what}.`;
    }
    case 'offer_countered': {
      const what = str(p, 'itemDescription') ?? `listing ${ref(p, 'listingCode', 'listingId')}`;
      return amount != null
        ? `Your offer on ${what} was countered at ${usd(amount)}.`
        : `Your offer on ${what} was countered.`;
    }
    case 'shipment_out': {
      const tracking = str(p, 'trackingNumber');
      const shipment = ref(p, 'shipmentCode', 'shipmentId');
      return tracking
        ? `Shipment ${shipment} has been dispatched — tracking number ${tracking}.`
        : `Shipment ${shipment} has been dispatched.`;
    }
    case 'hold_placed':
      return `A hold was placed on item ${ref(p, 'barcode', 'itemId')}; it cannot be moved, sold or shipped until the hold is released.`;
    case 'item_donated':
      return `Item ${ref(p, 'barcode', 'itemId')} was donated and has left your vault.`;
    case 'swap_proposed':
      return `Another collector proposed a swap with you — review it in the marketplace.`;
    case 'swap_completed':
      return `Your swap was completed and ownership of the items has transferred.`;
    case 'transfer_completed':
      return `Your item transfer was completed and ownership has changed.`;
    default: {
      // Unknown event: still a sentence, never a raw payload dump.
      return `${titleCase(eventType)}.`;
    }
  }
}
