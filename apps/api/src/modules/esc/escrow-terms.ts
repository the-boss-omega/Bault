/**
 * What escrow costs, and the rules that decide whether a deal can be raised.
 *
 * Pure data and predicates, like every other vocabulary module here — it talks
 * to nothing, so all of it is directly testable, and the SPA mirrors the shape
 * while fetching the actual figures from `GET /escrow/terms`.
 */
import { formatMinor } from '../../shared/money';

/** Bault's cut, in basis points of the agreed value. */
export const ESCROW_FEE_BPS = 100; // 1.00%

/** The smallest fee worth doing the work for. */
export const ESCROW_MINIMUM_FEE_MINOR = 2_500; // $25

/**
 * The floor under a deal.
 *
 * Escrow is a person receiving a card, examining it against a description,
 * holding it while two strangers make up their minds, and then either vaulting
 * or shipping it. Below this the fee cannot cover that work, and pretending
 * otherwise would mean either doing it badly or losing money on every deal.
 */
export const ESCROW_MINIMUM_VALUE_MINOR = 50_000; // $500

/** The pricing-rule action carrying the escrow fee, when one is configured. */
export const ESCROW_FEE_ACTION = 'escrow_fee';

export function escrowFeeMinor(valueMinor: number): number {
  if (valueMinor <= 0) return 0;
  return Math.max(Math.ceil((valueMinor * ESCROW_FEE_BPS) / 10_000), ESCROW_MINIMUM_FEE_MINOR);
}

export interface EscrowProblem {
  field: string;
  message: string;
}

/**
 * Whether this deal can be raised at all.
 *
 * Checked before anything is created, because every one of these is something
 * the raiser can still fix — and a deal that gets as far as somebody posting a
 * card before being refused has cost them a postage label.
 */
export function checkDeal(input: {
  valueMinor: number;
  description: string;
  raiserRole: 'buyer' | 'seller';
  counterpartyUserId?: string | null;
  counterpartyName?: string | null;
  counterpartyEmail?: string | null;
  settlement: 'buyer_vault' | 'ship_to_buyer';
}): EscrowProblem[] {
  const problems: EscrowProblem[] = [];

  if (!Number.isInteger(input.valueMinor) || input.valueMinor <= 0) {
    problems.push({ field: 'valueMinor', message: 'State what the deal is worth.' });
  } else if (input.valueMinor < ESCROW_MINIMUM_VALUE_MINOR) {
    problems.push({
      field: 'valueMinor',
      message: `Escrow starts at ${formatMinor(ESCROW_MINIMUM_VALUE_MINOR)}. Below that the fee costs more than the protection is worth to you.`,
    });
  }

  if (!input.description?.trim()) {
    problems.push({ field: 'description', message: 'Describe what is being sold, in your own words.' });
  }

  const hasAccount = Boolean(input.counterpartyUserId);
  const hasExternal = Boolean(input.counterpartyName?.trim() && input.counterpartyEmail?.trim());
  if (!hasAccount && !hasExternal) {
    problems.push({
      field: 'counterparty',
      message: 'Name the other side — either their Bault username, or a name and an email.',
    });
  }
  if (hasAccount && hasExternal) {
    problems.push({
      field: 'counterparty',
      message: 'Name the other side once: a Bault account or an outside contact, not both.',
    });
  }

  /**
   * A card cannot be placed into a vault that does not exist.
   *
   * This is the one rule that surprises people, so it is refused at submission
   * with the reason rather than discovered at settlement — an external buyer's
   * card has to be shipped to them, because there is nowhere else for it to go.
   */
  if (input.settlement === 'buyer_vault') {
    const buyerIsExternal = input.raiserRole === 'seller' && !hasAccount;
    if (buyerIsExternal) {
      problems.push({
        field: 'settlement',
        message: 'The buyer has no Bault vault to put it in. Choose "ship to the buyer" instead.',
      });
    }
  }

  return problems;
}

/**
 * Who pays the fee.
 *
 * The party who RAISED the deal, because they chose the service — and because
 * they are the one who is certainly a Bault account, which the other side may
 * not be. Stated as a function rather than left implicit so the answer is in
 * one place and can be quoted in the UI before anybody commits.
 */
export function feePayer(deal: { raisedBy: string }): string {
  return deal.raisedBy;
}
