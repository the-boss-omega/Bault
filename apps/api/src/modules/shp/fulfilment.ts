/**
 * How a shipment actually ends.
 *
 * Every route out of a Bault vault was a parcel. A shipment had to resolve to a
 * carrier rate, dispatch bought a label and stamped a tracking number, and there
 * was no fulfilment method that was not a carrier — so two of the reference
 * service's outbound routes, both of which are a human being rather than a
 * package, had nowhere to exist.
 *
 * This is that dimension. The three methods differ in what they SKIP, and each
 * skip is the whole reason the method exists:
 *
 *   `carrier`       Unchanged. Rate selection, a label, a tracking number.
 *   `hand_delivery` No carrier at all. A person collects the card and hands it
 *                   over. There is no rate to select because there is no rate
 *                   card — the price is travel plus a base, quoted per journey.
 *   `show_pickup`   No delivery at all. The cards travel to a show Bault is
 *                   already attending, and the collector walks up and takes them.
 *                   Priced per show, capped per show, and gated on that show's
 *                   deadline.
 *
 * The last one is worth stating plainly because it is easy to miss: show pickup
 * costs a fraction of postage precisely because Bault's van was going to that
 * show anyway. It is not a discount, it is the absence of a journey.
 */

export const FULFILMENT_METHODS = ['carrier', 'hand_delivery', 'show_pickup'] as const;
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number];

export function isKnownFulfilmentMethod(value: string): value is FulfilmentMethod {
  return (FULFILMENT_METHODS as readonly string[]).includes(value);
}

/** Whether this method goes through carrier rates and a purchased label. */
export function usesCarrier(method: string): boolean {
  return method === 'carrier';
}

/* ============================================================
   White glove
   ============================================================ */

/**
 * The base price of putting a person on the road, before travel.
 *
 * Mirrors the reference service's published figures. Travel is quoted on top,
 * per journey, by whoever works out the logistics — which is why this cannot be
 * a rate table: the cost of driving a card from New Jersey to a hotel in Boston
 * on a Tuesday is not something a lookup knows.
 */
export const WHITE_GLOVE_BASE_DOMESTIC_MINOR = 100_000; // $1,000
export const WHITE_GLOVE_BASE_INTERNATIONAL_MINOR = 150_000; // $1,500

/** How long Bault has to come back with a real figure. */
export const WHITE_GLOVE_QUOTE_HOURS = 48;

/** The pricing-rule action carrying a white-glove base fee. */
export function whiteGloveFeeAction(scope: 'domestic' | 'international'): string {
  return `white_glove:${scope}`;
}

export interface HandDeliveryProblem {
  field: string;
  message: string;
}

/**
 * Check a hand-delivery request before anybody is asked to price it.
 *
 * The windows are the part that gets people. A pickup window that has already
 * closed, or a delivery window that ends before the pickup window opens, is not
 * a journey anybody can make — and finding that out from an operator two days
 * later wastes both sides' time.
 */
export function checkHandDelivery(input: {
  pickupFrom: Date;
  pickupTo: Date;
  deliverFrom: Date;
  deliverTo: Date;
  pickupAddress: string;
  deliveryAddress: string;
  now?: Date;
}): HandDeliveryProblem[] {
  const problems: HandDeliveryProblem[] = [];
  const now = input.now ?? new Date();

  if (!input.pickupAddress.trim()) {
    problems.push({ field: 'pickupAddress', message: 'Say where the card is being collected from.' });
  }
  if (!input.deliveryAddress.trim()) {
    problems.push({ field: 'deliveryAddress', message: 'Say where it is being taken.' });
  }
  if (input.pickupTo.getTime() <= input.pickupFrom.getTime()) {
    problems.push({ field: 'pickupTo', message: 'The pickup window has to be a window.' });
  }
  if (input.deliverTo.getTime() <= input.deliverFrom.getTime()) {
    problems.push({ field: 'deliverTo', message: 'The delivery window has to be a window.' });
  }
  if (input.deliverFrom.getTime() < input.pickupFrom.getTime()) {
    problems.push({
      field: 'deliverFrom',
      message: 'It cannot be delivered before it is collected.',
    });
  }
  // Somebody has to plan a journey and be told the price first.
  const leadMs = WHITE_GLOVE_QUOTE_HOURS * 3_600_000;
  if (input.pickupFrom.getTime() - now.getTime() < leadMs) {
    problems.push({
      field: 'pickupFrom',
      message: `We need ${WHITE_GLOVE_QUOTE_HOURS} hours to confirm the logistics and quote you. Choose a later pickup window.`,
    });
  }
  return problems;
}

/* ============================================================
   Show pickup
   ============================================================ */

/**
 * How long before a show the pickup list closes.
 *
 * The cards have to be pulled, packed and loaded into the van, and the van
 * leaves whether or not somebody remembered to ask on the morning. The show's
 * own `requestDeadline` already encodes this for consignments; pickup uses the
 * same deadline, because it is the same van.
 */
export const PICKUP_USES_SHOW_DEADLINE = true;

/** The pricing-rule action carrying a show's pickup fee, when it has no own. */
export const PICKUP_FEE_ACTION = 'show_pickup';
