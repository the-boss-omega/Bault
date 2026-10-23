export const FULFILMENT_METHODS = ['carrier', 'hand_delivery', 'show_pickup'] as const;
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number];

export function isKnownFulfilmentMethod(value: string): value is FulfilmentMethod {
  return (FULFILMENT_METHODS as readonly string[]).includes(value);
}

export function usesCarrier(method: string): boolean {
  return method === 'carrier';
}

export const WHITE_GLOVE_BASE_DOMESTIC_MINOR = 100_000;
export const WHITE_GLOVE_BASE_INTERNATIONAL_MINOR = 150_000;

export const WHITE_GLOVE_QUOTE_HOURS = 48;

export function whiteGloveFeeAction(scope: 'domestic' | 'international'): string {
  return `white_glove:${scope}`;
}

export interface HandDeliveryProblem {
  field: string;
  message: string;
}

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
  const leadMs = WHITE_GLOVE_QUOTE_HOURS * 3_600_000;
  if (input.pickupFrom.getTime() - now.getTime() < leadMs) {
    problems.push({
      field: 'pickupFrom',
      message: `We need ${WHITE_GLOVE_QUOTE_HOURS} hours to confirm the logistics and quote you. Choose a later pickup window.`,
    });
  }
  return problems;
}

export const PICKUP_USES_SHOW_DEADLINE = true;

export const PICKUP_FEE_ACTION = 'show_pickup';
