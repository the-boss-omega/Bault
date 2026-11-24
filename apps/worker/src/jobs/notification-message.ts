type Payload = Record<string, unknown>;

function str(payload: Payload, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function num(payload: Payload, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function usd(minorUnits: number): string {
  return `$${(minorUnits / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function code(payload: Payload, key: string): string | null {
  const value = str(payload, key);
  return value && !UUID.test(value) ? value : null;
}

function named(payload: Payload, noun: string, key: string, otherwise: string): string {
  const value = code(payload, key);
  return value ? `${noun} ${value}` : otherwise;
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function itemNamed(payload: Payload, otherwise: string): string {
  const barcode = code(payload, 'barcode');
  if (barcode) return `item ${barcode}`;
  return str(payload, 'itemDescription') ?? otherwise;
}

function cardNamed(payload: Payload, otherwise: string): string {
  return str(payload, 'itemDescription') ?? itemNamed(payload, otherwise);
}

function fundedBy(route: string | null): string | null {
  if (!route) return null;
  const words = route.toLowerCase();
  if (words.includes('card')) return 'card';
  if (words.includes('paypal')) return 'PayPal';
  if (words.includes('bank')) return 'bank transfer';
  return null;
}

function walletRequestNamed(payload: Payload): string {
  const type = str(payload, 'type');
  const kind =
    type === 'cash_out'
      ? 'cash-out request'
      : type === 'cash_in'
        ? 'cash-in request'
        : 'wallet request';
  return named(payload, kind, 'code', `your ${kind}`);
}

export function notificationMessage(eventType: string, payload: Payload | null): string {
  const p = payload ?? {};
  const amount = num(p, 'amount');
  const price = num(p, 'price');

  switch (eventType) {
    case 'item_received':
      return `${cap(itemNamed(p, 'an item'))} was received into your vault.`;
    case 'item_sold':
      return price != null
        ? `Your ${cardNamed(p, 'card')} sold for ${usd(price)}.`
        : `Your ${cardNamed(p, 'card')} was sold.`;
    case 'offer_received': {
      const what = str(p, 'itemDescription') ?? itemNamed(p, 'your card');
      return amount != null
        ? `You received an offer of ${usd(amount)} on your listing for ${what}.`
        : `You received a new offer on your listing for ${what}.`;
    }
    case 'offer_countered': {
      const what = cardNamed(p, 'the card');
      if (str(p, 'counteredBy') === 'buyer') {
        return amount != null
          ? `The buyer answered your counter-offer on ${what} with ${usd(amount)}.`
          : `The buyer answered your counter-offer on ${what}.`;
      }
      return amount != null
        ? `Your offer on ${what} was countered at ${usd(amount)}.`
        : `Your offer on ${what} was countered.`;
    }
    case 'offer_accepted': {
      const what = cardNamed(p, 'the card');
      return amount != null
        ? `The seller accepted your offer of ${usd(amount)} on ${what}. It is paid for and in your vault.`
        : `The seller accepted your offer on ${what}. It is paid for and in your vault.`;
    }
    case 'offer_rejected': {
      const what = cardNamed(p, 'the card');
      const at = amount != null ? ` of ${usd(amount)}` : '';
      if (str(p, 'rejectedBy') === 'buyer') {
        return str(p, 'proposedBy') === 'seller'
          ? `The buyer turned down your counter-offer${at} on ${what}. Your listing stays up.`
          : `The buyer withdrew their offer${at} on ${what}. Your listing stays up.`;
      }
      return str(p, 'proposedBy') === 'seller'
        ? `The seller withdrew their counter-offer${at} on ${what}. You can make a new offer.`
        : `The seller turned down your offer${at} on ${what}. You can make a new offer.`;
    }
    case 'shipment_out': {
      const tracking = str(p, 'trackingNumber');
      const shipment = named(p, 'Shipment', 'shipmentCode', 'Your shipment');
      return tracking
        ? `${shipment} has been dispatched — tracking number ${tracking}.`
        : `${shipment} has been dispatched.`;
    }
    case 'shipment_delivered': {
      const tracking = str(p, 'trackingNumber');
      const shipment = named(p, 'Shipment', 'shipmentCode', 'Your shipment');
      return tracking
        ? `${shipment} was delivered, the carrier reports (tracking number ${tracking}).`
        : `${shipment} was delivered, the carrier reports.`;
    }
    case 'shipment_exception': {
      const tracking = str(p, 'trackingNumber');
      const shipment = named(p, 'shipment', 'shipmentCode', 'your shipment');
      return tracking
        ? `The carrier reports a problem with ${shipment} (tracking number ${tracking}): it may be returned, delayed or lost. Contact support if it does not move.`
        : `The carrier reports a problem with ${shipment}: it may be returned, delayed or lost. Contact support if it does not move.`;
    }
    case 'hold_placed':
      return `A hold was placed on ${itemNamed(p, 'one of your items')}; it cannot be moved, sold or shipped until the hold is released.`;
    case 'support_ticket_replied':
      return `Support replied to ${named(p, 'ticket', 'ticketCode', 'your ticket')}${str(p, 'subject') ? ` — ${str(p, 'subject')}` : ''}.`;
    case 'support_ticket_resolved':
      return `${named(p, 'Ticket', 'ticketCode', 'Your ticket')} was marked resolved. Reply to it if the question is still open.`;
    case 'parcel_received': {
      const where = str(p, 'facility');
      return where
        ? `${named(p, 'Parcel', 'parcelCode', 'Your parcel')} has arrived at ${where} and is waiting to be opened.`
        : `${named(p, 'Parcel', 'parcelCode', 'Your parcel')} has arrived and is waiting to be opened.`;
    }
    case 'parcel_forwarded': {
      const days = num(p, 'transitDays');
      const legs = `${str(p, 'fromFacility') ?? 'the receiving site'} to ${str(p, 'toFacility') ?? 'the vault'}`;
      return days != null
        ? `${named(p, 'Parcel', 'parcelCode', 'Your parcel')} is on its way from ${legs} — usually about ${days} days.`
        : `${named(p, 'Parcel', 'parcelCode', 'Your parcel')} is on its way from ${legs}.`;
    }
    case 'parcel_damaged': {
      const what =
        str(p, 'condition') === 'contents_damaged'
          ? 'the contents were damaged'
          : 'the packaging arrived damaged';
      return `${named(p, 'Parcel', 'parcelCode', 'Your parcel')} was opened and ${what}. ${str(p, 'conditionNotes') ?? ''}`.trim();
    }
    case 'parcel_processed': {
      const count = num(p, 'itemCount');
      return count === 1
        ? `${named(p, 'Parcel', 'parcelCode', 'Your parcel')} has been unpacked — 1 item is now in your vault.`
        : `${named(p, 'Parcel', 'parcelCode', 'Your parcel')} has been unpacked — ${count ?? 0} items are now in your vault.`;
    }
    case 'parcel_disposed':
      return `${named(p, 'Parcel', 'parcelCode', 'Your parcel')} was disposed of — ${str(p, 'reason') ?? 'see the parcel record for details'}.`;
    case 'arrival_not_accepted': {
      const what = str(p, 'itemDescription') ?? 'An item';
      const outcome = str(p, 'outcome');
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
      return `${what} arrived for you but could not be accepted into your vault — ${fate}. ${code(p, 'disposalCode') ? `See ${code(p, 'disposalCode')} for the details.` : 'See Not accepted under Shipping for the details.'}`;
    }
    case 'item_donated':
      return `${cap(itemNamed(p, 'your item'))} was donated and has left your vault.`;
    case 'grading_shipped': {
      const grader = str(p, 'gradingBody') ?? 'the grader';
      const tracking = str(p, 'trackingNumber');
      const tail = tracking ? ` Tracking number ${tracking}.` : '';
      return `Your card on ${named(p, 'request', 'requestCode', 'your grading request')} is on its way to ${grader}. While it is away it cannot be sold, swapped or shipped.${tail}`;
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
      return `${named(p, 'Shipment', 'shipmentCode', 'Your shipment')} was not paid for within the holding period, so it has been cancelled. ${what} back in your vault and can be sent again whenever you are ready.`;
    }
    case 'shipment_cancelled': {
      const fee = num(p, 'restockingFeeMinor') ?? 0;
      const tail =
        fee > 0
          ? ` A restocking fee of ${usd(fee)} was charged for the picking and verification already done.`
          : ' Nothing was charged — it had not been picked yet.';
      return `${named(p, 'Shipment', 'shipmentCode', 'Your shipment')} was cancelled and its items are back in your vault.${tail}`;
    }
    case 'group_shipment_locked': {
      const members = num(p, 'memberCount');
      const where = str(p, 'destination');
      return members != null
        ? `${named(p, 'The shared parcel', 'groupCode', 'Your shared parcel')} is closed to new members — ${members} collectors are shipping together to ${where ?? 'one address'}.`
        : `${named(p, 'The shared parcel', 'groupCode', 'Your shared parcel')} is closed to new members.`;
    }
    case 'direct_ship_booked': {
      const cost = num(p, 'costMinor');
      const from = str(p, 'facility') ?? 'the forwarding site';
      return cost != null
        ? `${named(p, 'Shipment', 'shipmentCode', 'Your shipment')} is going out overnight direct from ${from} for ${usd(cost)}. It never enters the vault, so no intake or storage is charged on it.`
        : `${named(p, 'Shipment', 'shipmentCode', 'Your shipment')} is going out overnight direct from ${from}.`;
    }
    case 'topup_settled': {
      const via = fundedBy(str(p, 'route'));
      const amt = num(p, 'amountMinor');
      return amt != null
        ? `${usd(amt)} has been added to your wallet${via ? ` by ${via}` : ''}. It is available now.`
        : 'Your top-up has settled and is available now.';
    }
    case 'payment_reversed': {
      const amt = num(p, 'amountMinor');
      const fee = num(p, 'feeMinor') ?? 0;
      const tail = fee > 0 ? ` A ${usd(fee)} handling fee was also charged.` : '';
      const kind = str(p, 'kind');
      const what = kind === 'bank_transfer' ? 'bank transfer' : kind === 'paypal' ? 'PayPal payment' : 'payment';
      const by = kind === 'bank_transfer' ? ' by the paying bank' : kind === 'paypal' ? ' through PayPal' : '';
      return amt != null
        ? `A ${what} of ${usd(amt)} into your wallet was reversed${by}, so it has been taken back off your balance.${tail} If you think this is wrong, open a support ticket.`
        : `A ${what} into your wallet was reversed.${tail}`;
    }
    case 'escrow_proposed': {
      const amount = num(p, 'valueMinor');
      return amount != null
        ? `Somebody has proposed a private deal with you through Card Embassy, ${named(p, 'deal', 'dealCode', 'your deal')}, for ${usd(amount)}. Nothing moves until you agree the terms.`
        : `Somebody has proposed a private deal with you through Card Embassy, ${named(p, 'deal', 'dealCode', 'your deal')}.`;
    }
    case 'escrow_agreed':
      return `Both sides have agreed the terms on ${named(p, 'deal', 'dealCode', 'your deal')}. The next step is the money being held.`;
    case 'escrow_funded': {
      const amount = num(p, 'amountMinor');
      return amount != null
        ? `The full ${usd(amount)} on ${named(p, 'deal', 'dealCode', 'your deal')} is now held by Card Embassy. It is safe to send the card.`
        : `The funds on ${named(p, 'deal', 'dealCode', 'your deal')} are now held by Card Embassy. It is safe to send the card.`;
    }
    case 'escrow_inspected': {
      const matches = p.matches === true;
      return matches
        ? `We have looked at the card on ${named(p, 'deal', 'dealCode', 'your deal')} and it matches how it was described. Both sides now need to confirm they are satisfied.`
        : `We have looked at the card on ${named(p, 'deal', 'dealCode', 'your deal')} and it does NOT match how it was described. Read the finding before you confirm anything — you can have the deal returned instead.`;
    }
    case 'escrow_settled': {
      const amount = num(p, 'amountMinor');
      return amount != null
        ? `${cap(named(p, 'deal', 'dealCode', 'your deal'))} has settled. ${usd(amount)} has been released and the card has changed hands.`
        : `${cap(named(p, 'deal', 'dealCode', 'your deal'))} has settled.`;
    }
    case 'escrow_returned':
      return `${cap(named(p, 'deal', 'dealCode', 'your deal'))} was returned — ${str(p, 'reason') ?? 'see the deal for the reason'}. Any held funds have gone back to the buyer.`;
    case 'escrow_cancelled':
      return `${cap(named(p, 'deal', 'dealCode', 'a deal'))} was called off before any money was held. ${str(p, 'reason') ? `The reason given: ${str(p, 'reason')}` : 'See the deal for the reason.'}`;
    case 'white_glove_requested': {
      const hours = num(p, 'quoteWithinHours');
      return hours != null
        ? `We have your hand-delivery request${code(p, 'shipmentCode') ? ` ${code(p, 'shipmentCode')}` : ''}. Somebody will work out the journey and come back with a price within ${hours} hours.`
        : `We have your hand-delivery request${code(p, 'shipmentCode') ? ` ${code(p, 'shipmentCode')}` : ''}.`;
    }
    case 'white_glove_quoted': {
      const amount = num(p, 'quoteMinor');
      return amount != null
        ? `Your hand delivery${code(p, 'shipmentCode') ? ` ${code(p, 'shipmentCode')}` : ''} is quoted at ${usd(amount)}. Nothing is charged until you accept it.`
        : `Your hand delivery${code(p, 'shipmentCode') ? ` ${code(p, 'shipmentCode')}` : ''} has been quoted.`;
    }
    case 'show_pickup_booked': {
      const show = str(p, 'showName');
      return show
        ? `Your cards will travel to ${show} for you to collect. Bring ID and ask for the Card Embassy table${code(p, 'shipmentCode') ? ` — shipment ${code(p, 'shipmentCode')}` : ''}.`
        : `Your show pickup${code(p, 'shipmentCode') ? ` ${code(p, 'shipmentCode')}` : ''} is booked.`;
    }
    case 'handed_over': {
      const who = str(p, 'handedToName');
      const how = str(p, 'method') === 'show_pickup' ? 'collected at the show' : 'hand-delivered';
      return who
        ? `${named(p, 'Shipment', 'shipmentCode', 'Your shipment')} was ${how} and signed for by ${who}.`
        : `${named(p, 'Shipment', 'shipmentCode', 'Your shipment')} was ${how}.`;
    }
    case 'swap_proposed':
      return `Another collector proposed a swap with you — review it in the marketplace.`;
    case 'swap_completed':
      return `Your swap was completed and ownership of the items has transferred.`;
    case 'swap_rejected': {
      const gift = str(p, 'kind') === 'gift';
      if (str(p, 'rejectedBy') === 'proposer') {
        return gift
          ? `A gift that was waiting for you was withdrawn by the collector who offered it.`
          : `A swap proposed to you was withdrawn by the collector who proposed it.`;
      }
      return gift
        ? `The collector you offered a gift to turned it down. The card stays in your vault.`
        : `Your swap proposal was turned down. Your cards stay in your vault.`;
    }
    case 'transfer_completed':
      return `Your item transfer was completed and ownership has changed.`;
    case 'buyout_quoted':
      return amount != null
        ? `Card Embassy offers ${usd(amount)} to buy your card outright on ${named(p, 'request', 'requestCode', 'your buyout request')}. Nothing changes hands until you accept it.`
        : `Card Embassy has made an offer on ${named(p, 'buyout request', 'requestCode', 'your buyout request')}. Nothing changes hands until you accept it.`;
    case 'custom_request_raised':
      return `We have your custom request${code(p, 'requestCode') ? ` ${code(p, 'requestCode')}` : ''}${str(p, 'summary') ? ` — ${str(p, 'summary')}` : ''}. Somebody will look at it and come back with a price or an answer.`;
    case 'custom_request_quoted':
      return amount != null
        ? `Your custom request${code(p, 'requestCode') ? ` ${code(p, 'requestCode')}` : ''} is priced at ${usd(amount)}. Nothing is charged until you accept the quote.`
        : `Your custom request${code(p, 'requestCode') ? ` ${code(p, 'requestCode')}` : ''} has been priced. Nothing is charged until you accept the quote.`;
    case 'custom_request_declined': {
      const reason = str(p, 'reason');
      return `We cannot do your custom request${code(p, 'requestCode') ? ` ${code(p, 'requestCode')}` : ''}${reason ? `: ${reason}` : '.'}${reason && !/[.!?]$/.test(reason) ? '.' : ''} Anything you paid for it has been refunded.`;
    }
    case 'wallet_request_submitted':
      return `We have your ${walletRequestNamed(p).replace(/^your /, '')}. You can follow it under Wallet, Requests.`;
    case 'wallet_request_pending_review':
      return `${cap(walletRequestNamed(p))} is with us for review.`;
    case 'wallet_request_approved':
      return `${cap(walletRequestNamed(p))} was approved and will be carried out next.`;
    case 'wallet_request_processing':
    case 'wallet_request_paying':
      return `${cap(walletRequestNamed(p))} is being carried out.`;
    case 'wallet_request_rejected': {
      const reason = str(p, 'reason');
      return `${cap(walletRequestNamed(p))} was declined${reason ? `: ${reason}` : '.'}${reason && !/[.!?]$/.test(reason) ? '.' : ''}`;
    }
    case 'wallet_request_cancelled':
      return `${cap(walletRequestNamed(p))} was cancelled.`;
    case 'wallet_request_completed': {
      const amt = num(p, 'amountMinor');
      const cashOut = str(p, 'type') === 'cash_out';
      if (amt == null) return `${cap(walletRequestNamed(p))} has been settled.`;
      if (!cashOut) return `${cap(walletRequestNamed(p))} has been settled: ${usd(amt)} is in your wallet.`;
      const fee = num(p, 'feeMinor') ?? 0;
      const net = num(p, 'netMinor');
      if (fee > 0 && net != null) {
        return `${cap(walletRequestNamed(p))} has been paid: ${usd(amt)} has left your wallet, and ${usd(net)} is on its way to your account after the ${usd(fee)} cash-out fee.`;
      }
      return `${cap(walletRequestNamed(p))} has been paid: ${usd(amt)} has left your wallet for your account.`;
    }
    case 'wallet_request_payout_failed': {
      const amt = num(p, 'amountMinor');
      const returned = p.afterPaid === true;
      if (returned) {
        return amt != null
          ? `${cap(walletRequestNamed(p))} was returned after it was sent, so the ${usd(amt)} is back in your wallet.`
          : `${cap(walletRequestNamed(p))} was returned after it was sent, and the money is back in your wallet.`;
      }
      return amt != null
        ? `${cap(walletRequestNamed(p))} could not be paid, so the ${usd(amt)} is back in your wallet.`
        : `${cap(walletRequestNamed(p))} could not be paid, and the money is back in your wallet.`;
    }
    default:
      return 'There is an update on your Card Embassy account.';
  }
}
