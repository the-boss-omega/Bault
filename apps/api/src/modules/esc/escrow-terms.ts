import { formatMinor } from '../../shared/money';

export const ESCROW_FEE_BPS = 100;

export const ESCROW_MINIMUM_FEE_MINOR = 2_500;

export const ESCROW_MINIMUM_VALUE_MINOR = 50_000;

export const ESCROW_FEE_ACTION = 'escrow_fee';

export function escrowFeeMinor(valueMinor: number): number {
  if (valueMinor <= 0) return 0;
  return Math.max(Math.ceil((valueMinor * ESCROW_FEE_BPS) / 10_000), ESCROW_MINIMUM_FEE_MINOR);
}

export interface EscrowProblem {
  field: string;
  message: string;
}

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

export function feePayer(deal: { raisedBy: string }): string {
  return deal.raisedBy;
}
