import { formatMinor } from '../../shared/money';

export interface ConsignmentChannel {
  key: string;
  label: string;
  gradedOnly: boolean;
  minAskingMinor: number;
  requiresEvent: boolean;
  payoutDaysMin: number;
  payoutDaysMax: number;
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
    minAskingMinor: 5_000,
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

export function channelFeeAction(key: string): string {
  return `consignment_fee:${key}`;
}

export interface EligibilityProblem {
  field: string;
  message: string;
}

export function checkEligibility(
  channel: ConsignmentChannel,
  input: { conditionGrade: string | null; askingMinor: number; eventId?: string | null },
): EligibilityProblem[] {
  const problems: EligibilityProblem[] = [];

  if (channel.gradedOnly) {
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
