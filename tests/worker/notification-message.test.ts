import { describe, it, expect } from 'vitest';
import { notificationMessage } from '../../apps/worker/src/jobs/notification-message';

const ITEM = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const LISTING = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const PERSON = '9b2d1e4a-1111-4c2a-9a1b-2f3e4d5c6b7a';
const ID_PIECES = [ITEM, LISTING, PERSON].flatMap((id) => [id, id.slice(0, 8)]);

function noIds(message: string) {
  for (const piece of ID_PIECES) expect(message).not.toContain(piece);
  expect(message).not.toMatch(/unknown|undefined|null/);
}

describe('the sentence a collector reads for each event', () => {
  it('names a sold card by its description, not by a cut-off id', () => {
    const message = notificationMessage('item_sold', {
      itemId: ITEM,
      buyerId: PERSON,
      sellerId: PERSON,
      price: 26_000,
      itemDescription: 'Rayquaza ex #97/97',
    });
    expect(message).toBe('Your Rayquaza ex #97/97 sold for $260.00.');
    noIds(message);
    noIds(notificationMessage('item_sold', { itemId: ITEM, price: 26_000 }));
  });

  it('names a donated card by its description', () => {
    const message = notificationMessage('item_donated', {
      itemId: ITEM,
      donorId: PERSON,
      itemDescription: 'Rayquaza ex #97/97',
    });
    expect(message).toBe('Rayquaza ex #97/97 was donated and has left your vault.');
    noIds(notificationMessage('item_donated', { itemId: ITEM, donorId: PERSON }));
  });

  it('says whose counter it is, and on which card', () => {
    const toBuyer = notificationMessage('offer_countered', {
      listingId: LISTING,
      amount: 24_000,
      counteredBy: 'seller',
      itemDescription: 'Rayquaza ex #97/97',
    });
    expect(toBuyer).toBe('Your offer on Rayquaza ex #97/97 was countered at $240.00.');
    const toSeller = notificationMessage('offer_countered', {
      listingId: LISTING,
      amount: 25_000,
      counteredBy: 'buyer',
    });
    expect(toSeller).toBe('The buyer answered your counter-offer on the card with $250.00.');
    noIds(toSeller);
  });

  it('tells a buyer their offer was accepted, and either side that an offer is off the table', () => {
    const accepted = notificationMessage('offer_accepted', {
      listingId: LISTING,
      amount: 20_000,
      itemDescription: 'Rayquaza ex #97/97',
      recipientIds: [PERSON],
    });
    expect(accepted).toBe('The seller accepted your offer of $200.00 on Rayquaza ex #97/97. It is paid for and in your vault.');
    noIds(accepted);
    expect(notificationMessage('offer_rejected', { amount: 15_000, rejectedBy: 'seller', proposedBy: 'buyer' })).toBe(
      'The seller turned down your offer of $150.00 on the card. You can make a new offer.',
    );
    expect(notificationMessage('offer_rejected', { amount: 15_000, rejectedBy: 'buyer', proposedBy: 'buyer' })).toBe(
      'The buyer withdrew their offer of $150.00 on the card. Your listing stays up.',
    );
    expect(notificationMessage('offer_rejected', { rejectedBy: 'buyer', proposedBy: 'seller', itemDescription: 'A slab' })).toBe(
      'The buyer turned down your counter-offer on A slab. Your listing stays up.',
    );
  });

  it('tells the other side when a swap or a gift is called off', () => {
    expect(notificationMessage('swap_rejected', { kind: 'swap', rejectedBy: 'responder', recipientIds: [PERSON] })).toBe(
      'Your swap proposal was turned down. Your cards stay in your vault.',
    );
    expect(notificationMessage('swap_rejected', { kind: 'gift', rejectedBy: 'proposer' })).toBe(
      'A gift that was waiting for you was withdrawn by the collector who offered it.',
    );
  });

  it('tells the other side when a deal is called off before it is funded', () => {
    const cancelled = notificationMessage('escrow_cancelled', { dealCode: 'ESC-7K2M9QRS', reason: 'Changed my mind.' });
    expect(cancelled).toBe('Deal ESC-7K2M9QRS was called off before any money was held. The reason given: Changed my mind.');
    noIds(cancelled);
  });

  it('writes a buyout quote and each custom request step as a sentence', () => {
    expect(
      notificationMessage('buyout_quoted', { requestCode: 'SR-7K2M9QRS', amount: 12_000 }),
    ).toBe(
      'Card Embassy offers $120.00 to buy your card outright on request SR-7K2M9QRS. Nothing changes hands until you accept it.',
    );
    expect(
      notificationMessage('custom_request_raised', {
        requestCode: 'SR-AAAA1111',
        summary: 'Re-sleeve my binder',
      }),
    ).toBe(
      'We have your custom request SR-AAAA1111 — Re-sleeve my binder. Somebody will look at it and come back with a price or an answer.',
    );
    expect(
      notificationMessage('custom_request_quoted', { requestCode: 'SR-AAAA1111', amount: 4_500 }),
    ).toBe(
      'Your custom request SR-AAAA1111 is priced at $45.00. Nothing is charged until you accept the quote.',
    );
    expect(
      notificationMessage('custom_request_declined', {
        requestCode: 'SR-AAAA1111',
        reason: 'We do not open sealed product',
      }),
    ).toBe(
      'We cannot do your custom request SR-AAAA1111: We do not open sealed product. Anything you paid for it has been refunded.',
    );
  });

  it('writes each wallet request step as a sentence, and keeps staff notes out of it', () => {
    const base = { requestId: LISTING, code: 'WR-AAAA1111', userId: PERSON };
    expect(notificationMessage('wallet_request_submitted', { ...base, type: 'cash_out' })).toBe(
      'We have your cash-out request WR-AAAA1111. You can follow it under Wallet, Requests.',
    );
    expect(
      notificationMessage('wallet_request_approved', {
        ...base,
        type: 'cash_in',
        reason: 'checked against statement 41',
      }),
    ).toBe('Cash-in request WR-AAAA1111 was approved and will be carried out next.');
    expect(
      notificationMessage('wallet_request_rejected', {
        ...base,
        type: 'cash_in',
        reason: 'The transfer never arrived',
      }),
    ).toBe('Cash-in request WR-AAAA1111 was declined: The transfer never arrived.');
    expect(
      notificationMessage('wallet_request_completed', {
        ...base,
        type: 'cash_out',
        amountMinor: 5_000,
      }),
    ).toBe(
      'Cash-out request WR-AAAA1111 has been paid: $50.00 has left your wallet for your account.',
    );
    expect(
      notificationMessage('wallet_request_payout_failed', {
        ...base,
        type: 'cash_out',
        amountMinor: 5_000,
      }),
    ).toBe('Cash-out request WR-AAAA1111 could not be paid, so the $50.00 is back in your wallet.');
    for (const event of [
      'wallet_request_submitted',
      'wallet_request_cancelled',
      'wallet_request_processing',
    ]) {
      noIds(notificationMessage(event, { requestId: LISTING, userId: PERSON }));
    }
  });

  it('says a reversed payment by its kind', () => {
    expect(
      notificationMessage('payment_reversed', {
        amountMinor: 5_000,
        feeMinor: 0,
        kind: 'bank_transfer',
      }),
    ).toMatch(/^A bank transfer of \$50\.00 into your wallet was reversed/);
    const card = notificationMessage('payment_reversed', {
      amountMinor: 5_000,
      feeMinor: 0,
      kind: 'payment',
      reason: 'friendly fraud',
    });
    expect(card).toMatch(/^A payment of \$50\.00 into your wallet was reversed/);
    expect(card).not.toMatch(/friendly fraud|cardholder/);
  });

  it('names PayPal only when the collector paid with PayPal', () => {
    expect(
      notificationMessage('topup_settled', { amountMinor: 5_000, route: 'card through PayPal' }),
    ).toBe('$50.00 has been added to your wallet by card. It is available now.');
    expect(notificationMessage('topup_settled', { amountMinor: 5_000, route: 'PayPal' })).toBe(
      '$50.00 has been added to your wallet by PayPal. It is available now.',
    );
    expect(notificationMessage('topup_settled', { amountMinor: 5_000, route: 'Card' })).not.toMatch(
      /PayPal/,
    );
  });

  it('never prints an id prefix where a code is missing', () => {
    for (const event of [
      'item_received',
      'hold_placed',
      'shipment_out',
      'shipment_delivered',
      'escrow_agreed',
      'support_ticket_resolved',
    ]) {
      noIds(notificationMessage(event, { itemId: ITEM, shipmentId: LISTING, dealId: PERSON }));
    }
  });

  it('says something plain for an event it has no sentence for', () => {
    expect(notificationMessage('something_new', { userId: PERSON })).toBe(
      'There is an update on your Card Embassy account.',
    );
  });
});
