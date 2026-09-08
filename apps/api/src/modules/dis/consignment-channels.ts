/**
 * Where a consigned card can actually be sold.
 *
 * Consignment used to be one generic request with the channel hard-coded to
 * "eBay" in the vault drawer. The accounting was exact and the product was
 * empty: a collector could not choose where their card was sold, could not see
 * what each route cost or how long it took, and could not set an asking price.
 *
 * Each channel below differs in the three things a seller actually decides on —
 * what it costs, what it accepts, and how long the money takes. A channel that
 * differed in none of those would not be a channel, it would be a label.
 *
 * The FEE recorded here is Bault's own cut, expressed as the `actionType` of a
 * pricing rule (`consignment_fee:<key>`) so the number itself stays in the
 * pricing table where every other price lives (Principle VI) and stays
 * admin-editable. A partner's own commission is deducted by the partner before
 * they remit, so it never passes through Bault's ledger and is quoted here as
 * guidance only.
 */
import { formatMinor } from '../../shared/money';

export interface ConsignmentChannel {
  key: string;
  label: string;
  /** Only graded/slabbed items are accepted. */
  gradedOnly: boolean;
  /** Minimum asking price, in minor units. Zero means no minimum. */
  minAskingMinor: number;
  /** The seller must pick a specific card show. */
  requiresEvent: boolean;
  /** Typical time from sale to the money landing, for setting expectations. */
  payoutDaysMin: number;
  payoutDaysMax: number;
  /** Human note about the partner's own commission, which Bault never sees. */
  partnerFeeNote: string;
}

export const CONSIGNMENT_CHANNELS: readonly ConsignmentChannel[] = [
  {
    key: 'card_show',
    label: 'Card show',
    gradedOnly: false,
    minAskingMinor: 0,
    requiresEvent: true,
    payoutDaysMin: 3,
    payoutDaysMax: 10,
    partnerFeeNote: 'No partner commission — Bault sells it at the table.',
  },
  {
    key: 'auction_house',
    label: 'Auction house',
    gradedOnly: true,
    minAskingMinor: 5_000, // $50
    requiresEvent: false,
    payoutDaysMin: 42,
    payoutDaysMax: 70,
    partnerFeeNote: "The auction house deducts its own rate before remitting.",
  },
  {
    key: 'ebay_partner',
    label: 'eBay, through a partner seller',
    gradedOnly: false,
    minAskingMinor: 0,
    requiresEvent: false,
    payoutDaysMin: 14,
    payoutDaysMax: 35,
    partnerFeeNote: "The partner seller deducts its own rate before remitting.",
  },
];

const BY_KEY = new Map(CONSIGNMENT_CHANNELS.map((c) => [c.key, c]));

export function consignmentChannel(key: string): ConsignmentChannel | undefined {
  return BY_KEY.get(key);
}

export function isKnownChannel(key: string): boolean {
  return BY_KEY.has(key);
}

/** The pricing-rule action type carrying Bault's cut for this channel. */
export function channelFeeAction(key: string): string {
  return `consignment_fee:${key}`;
}

/** One rejected eligibility rule, named by the field that failed. */
export interface EligibilityProblem {
  field: string;
  message: string;
}

/**
 * Whether this item, at this price, may go down this channel.
 *
 * Checked before the request is created rather than discovered when an operator
 * tries to fulfil it — a seller who is going to be told "graded cards only"
 * should be told before they are charged a service fee, not after.
 */
export function checkEligibility(
  channel: ConsignmentChannel,
  input: { conditionGrade: string | null; askingMinor: number; eventId?: string | null },
): EligibilityProblem[] {
  const problems: EligibilityProblem[] = [];

  if (channel.gradedOnly) {
    // "Graded" means a grade was recorded by the third-party grading flow. A
    // blank condition, or the literal "Raw", is not one.
    const grade = (input.conditionGrade ?? '').trim();
    if (!grade || /^raw$/i.test(grade)) {
      problems.push({
        field: 'conditionGrade',
        message: `${channel.label} accepts graded items only — this one has no grade recorded.`,
      });
    }
  }

  if (channel.minAskingMinor > 0 && input.askingMinor < channel.minAskingMinor) {
    problems.push({
      field: 'askingPrice',
      message: `${channel.label} has a minimum of ${formatMinor(channel.minAskingMinor)}.`,
    });
  }

  if (channel.requiresEvent && !input.eventId) {
    problems.push({
      field: 'eventId',
      message: `${channel.label} needs a specific show to be chosen.`,
    });
  }

  return problems;
}
