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
      // Never a truncated id: "listing 6876eae6" names nothing a person can find.
      const code = str(p, 'listingCode') ?? str(p, 'barcode');
      const what = str(p, 'itemDescription') ?? (code ? `listing ${code}` : 'a listing');
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
    case 'support_ticket_replied':
      return `Support replied to ${ref(p, 'ticketCode')} — ${str(p, 'subject') ?? 'your ticket'}.`;
    case 'support_ticket_resolved':
      return `Ticket ${ref(p, 'ticketCode')} was marked resolved. Reply to it if the question is still open.`;
    case 'parcel_received': {
      const where = str(p, 'facility');
      return where
        ? `Parcel ${ref(p, 'parcelCode')} has arrived at ${where} and is waiting to be opened.`
        : `Parcel ${ref(p, 'parcelCode')} has arrived and is waiting to be opened.`;
    }
    case 'parcel_forwarded': {
      const days = num(p, 'transitDays');
      const legs = `${str(p, 'fromFacility') ?? 'the receiving site'} to ${str(p, 'toFacility') ?? 'the vault'}`;
      return days != null
        ? `Parcel ${ref(p, 'parcelCode')} is on its way from ${legs} — usually about ${days} days.`
        : `Parcel ${ref(p, 'parcelCode')} is on its way from ${legs}.`;
    }
    case 'parcel_damaged': {
      // Said plainly and early: a claim against the seller or the carrier has a
      // deadline, and the collector cannot start one they were never told about.
      const what =
        str(p, 'condition') === 'contents_damaged'
          ? 'the contents were damaged'
          : 'the packaging arrived damaged';
      return `Parcel ${ref(p, 'parcelCode')} was opened and ${what}. ${str(p, 'conditionNotes') ?? ''}`.trim();
    }
    case 'parcel_processed': {
      const count = num(p, 'itemCount');
      return count === 1
        ? `Parcel ${ref(p, 'parcelCode')} has been unpacked — 1 item is now in your vault.`
        : `Parcel ${ref(p, 'parcelCode')} has been unpacked — ${count ?? 0} items are now in your vault.`;
    }
    case 'parcel_disposed':
      return `Parcel ${ref(p, 'parcelCode')} was disposed of — ${str(p, 'reason') ?? 'see the parcel record for details'}.`;
    case 'arrival_not_accepted': {
      const what = str(p, 'itemDescription') ?? 'An item';
      const outcome = str(p, 'outcome');
      // Named plainly. Somebody's property did not survive contact with the
      // warehouse, and a euphemism here would leave them waiting for it.
      const fate =
        outcome === 'destroyed'
          ? 'it was disposed of and cannot be returned'
          : outcome === 'given_away'
            ? 'it was given away rather than stored'
            : outcome === 'recycled'
              ? 'it was recycled rather than stored'
              : outcome === 'returned'
                ? 'it was returned to the sender'
                : 'it was not stored';
      return `${what} arrived for you but could not be accepted into your vault — ${fate}. See ${ref(p, 'disposalCode')} for the details.`;
    }
    case 'item_donated':
      return `Item ${ref(p, 'barcode', 'itemId')} was donated and has left your vault.`;
    case 'grading_shipped': {
      // The sentence has to carry the CONSEQUENCE, not just the fact. A card at
      // a grader cannot be sold, swapped or shipped, and somebody who lists it
      // the next morning and finds it refused deserved to be told here.
      const grader = str(p, 'gradingBody') ?? 'the grader';
      const tracking = str(p, 'trackingNumber');
      const tail = tracking ? ` Tracking number ${tracking}.` : '';
      return `Your card on ${ref(p, 'requestCode')} is on its way to ${grader}. While it is away it cannot be sold, swapped or shipped.${tail}`;
    }
    case 'commons_removed': {
      const count = num(p, 'count') ?? 0;
      const outcome = str(p, 'outcome') === 'donate' ? 'donated' : 'disposed of';
      return count === 1
        ? `1 card was removed from your vault and ${outcome}. It will accrue no further storage.`
        : `${count} cards were removed from your vault and ${outcome}. They will accrue no further storage.`;
    }
    case 'shipment_expired': {
      const count = num(p, 'itemCount') ?? 0;
      const what = count === 1 ? 'The item is' : `All ${count} items are`;
      return `Shipment ${ref(p, 'shipmentCode')} was not paid for within the holding period, so it has been cancelled. ${what} back in your vault and can be sent again whenever you are ready.`;
    }
    case 'shipment_cancelled': {
      const fee = num(p, 'restockingFeeMinor') ?? 0;
      const tail =
        fee > 0
          ? ` A restocking fee of ${usd(fee)} was charged for the picking and verification already done.`
          : ' Nothing was charged — it had not been picked yet.';
      return `Shipment ${ref(p, 'shipmentCode')} was cancelled and its items are back in your vault.${tail}`;
    }
    case 'group_shipment_locked': {
      const members = num(p, 'memberCount');
      const where = str(p, 'destination');
      return members != null
        ? `The shared parcel ${ref(p, 'groupCode')} is closed to new members — ${members} collectors are shipping together to ${where ?? 'one address'}.`
        : `The shared parcel ${ref(p, 'groupCode')} is closed to new members.`;
    }
    case 'direct_ship_booked': {
      const cost = num(p, 'costMinor');
      const from = str(p, 'facility') ?? 'the forwarding site';
      return cost != null
        ? `Shipment ${ref(p, 'shipmentCode')} is going out overnight direct from ${from} for ${usd(cost)}. It never enters the vault, so no intake or storage is charged on it.`
        : `Shipment ${ref(p, 'shipmentCode')} is going out overnight direct from ${from}.`;
    }
    case 'topup_settled': {
      const via = str(p, 'route');
      const amt = num(p, 'amountMinor');
      return amt != null
        ? `${usd(amt)} has been added to your wallet${via ? ` by ${via}` : ''}. It is available now.`
        : 'Your top-up has settled and is available now.';
    }
    case 'payment_reversed': {
      // Said plainly and early. The first a collector usually hears of a
      // reversal is a balance that went negative, and a euphemism here leaves
      // them working out why on their own.
      const amt = num(p, 'amountMinor');
      const fee = num(p, 'feeMinor') ?? 0;
      const tail = fee > 0 ? ` A ${usd(fee)} handling fee was also charged.` : '';
      return amt != null
        ? `A card payment of ${usd(amt)} into your wallet was reversed by the cardholder's bank, so it has been taken back off your balance.${tail} If you think this is wrong, open a support ticket.`
        : `A payment into your wallet was reversed.${tail}`;
    }
    case 'escrow_proposed': {
      const amount = num(p, 'valueMinor');
      return amount != null
        ? `Somebody has proposed a private deal with you through Bault, ${ref(p, 'dealCode')}, for ${usd(amount)}. Nothing moves until you agree the terms.`
        : `Somebody has proposed a private deal with you through Bault, ${ref(p, 'dealCode')}.`;
    }
    case 'escrow_agreed':
      return `Both sides have agreed the terms on ${ref(p, 'dealCode')}. The next step is the money being held.`;
    case 'escrow_funded': {
      const amount = num(p, 'amountMinor');
      // The seller is the one who needs this sentence: it is the moment it
      // becomes safe to put the card in a box.
      return amount != null
        ? `The full ${usd(amount)} on ${ref(p, 'dealCode')} is now held by Bault. It is safe to send the card.`
        : `The funds on ${ref(p, 'dealCode')} are now held by Bault. It is safe to send the card.`;
    }
    case 'escrow_inspected': {
      const matches = p.matches === true;
      return matches
        ? `We have looked at the card on ${ref(p, 'dealCode')} and it matches how it was described. Both sides now need to confirm they are satisfied.`
        : `We have looked at the card on ${ref(p, 'dealCode')} and it does NOT match how it was described. Read the finding before you confirm anything — you can have the deal returned instead.`;
    }
    case 'escrow_settled': {
      const amount = num(p, 'amountMinor');
      return amount != null
        ? `${ref(p, 'dealCode')} has settled. ${usd(amount)} has been released and the card has changed hands.`
        : `${ref(p, 'dealCode')} has settled.`;
    }
    case 'escrow_returned':
      return `${ref(p, 'dealCode')} was returned — ${str(p, 'reason') ?? 'see the deal for the reason'}. Any held funds have gone back to the buyer.`;
    case 'white_glove_requested': {
      const hours = num(p, 'quoteWithinHours');
      return hours != null
        ? `We have your hand-delivery request ${ref(p, 'shipmentCode')}. Somebody will work out the journey and come back with a price within ${hours} hours.`
        : `We have your hand-delivery request ${ref(p, 'shipmentCode')}.`;
    }
    case 'white_glove_quoted': {
      const amount = num(p, 'quoteMinor');
      return amount != null
        ? `Your hand delivery ${ref(p, 'shipmentCode')} is quoted at ${usd(amount)}. Nothing is charged until you accept it.`
        : `Your hand delivery ${ref(p, 'shipmentCode')} has been quoted.`;
    }
    case 'show_pickup_booked': {
      const show = str(p, 'showName');
      return show
        ? `Your cards will travel to ${show} for you to collect. Bring ID and ask for the Bault table — shipment ${ref(p, 'shipmentCode')}.`
        : `Your show pickup ${ref(p, 'shipmentCode')} is booked.`;
    }
    case 'handed_over': {
      const who = str(p, 'handedToName');
      const how = str(p, 'method') === 'show_pickup' ? 'collected at the show' : 'hand-delivered';
      return who
        ? `Shipment ${ref(p, 'shipmentCode')} was ${how} and signed for by ${who}.`
        : `Shipment ${ref(p, 'shipmentCode')} was ${how}.`;
    }
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
