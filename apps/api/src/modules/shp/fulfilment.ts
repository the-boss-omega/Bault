export const FULFILMENT_METHODS = ['carrier', 'hand_delivery', 'show_pickup'] as const;
export type FulfilmentMethod = (typeof FULFILMENT_METHODS)[number];

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

const CONTACT_PHONE = /^(?=(?:.*\d){6})[0-9+\- ]{6,20}$/;

export function contactPhoneOf(value: string | null | undefined): string | null {
  const phone = (value ?? '').trim();
  return phone ? phone : null;
}

export function shipmentContactPhone(s: { fulfilmentMethod: string; destinationDetail: unknown }): string | null {
  if (s.fulfilmentMethod !== 'hand_delivery') return null;
  const detail = s.destinationDetail as { phone?: unknown } | null;
  return typeof detail?.phone === 'string' ? detail.phone : null;
}

export function checkHandDelivery(input: {
  pickupFrom: Date;
  pickupTo: Date;
  deliverFrom: Date;
  deliverTo: Date;
  pickupAddress: string;
  deliveryAddress: string;
  contactPhone?: string | null;
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
  const phone = contactPhoneOf(input.contactPhone);
  if (phone !== null && !CONTACT_PHONE.test(phone)) {
    problems.push({
      field: 'contactPhone',
      message: 'A phone for the courier is 6 to 20 characters of digits, spaces, plus and dashes, with at least six digits.',
    });
  }
  const unreadable = (
    [
      ['pickupFrom', input.pickupFrom, 'the start of the pickup window'],
      ['pickupTo', input.pickupTo, 'the end of the pickup window'],
      ['deliverFrom', input.deliverFrom, 'the start of the delivery window'],
      ['deliverTo', input.deliverTo, 'the end of the delivery window'],
    ] as const
  ).filter(([, at]) => Number.isNaN(at.getTime()));
  for (const [field, , words] of unreadable) {
    problems.push({ field, message: `We could not read ${words}. Give it as a date and time.` });
  }
  if (unreadable.length > 0) return problems;
  if (input.pickupTo.getTime() <= input.pickupFrom.getTime()) {
    problems.push({ field: 'pickupTo', message: 'The pickup window has to end after it starts.' });
  }
  if (input.deliverTo.getTime() <= input.deliverFrom.getTime()) {
    problems.push({ field: 'deliverTo', message: 'The delivery window has to end after it starts.' });
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

export const PICKUP_FEE_ACTION = 'show_pickup';
