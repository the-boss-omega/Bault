import { loadEnv } from '@bault/config';
import { CURRENT_TERMS_VERSION } from '../acc/terms';
import {
  CASHOUT_BAND_MINOR,
  CASHOUT_LARGE_BPS,
  CASHOUT_LARGE_FIXED_MINOR,
  CASHOUT_SMALL_BPS,
  CASHOUT_SMALL_MINIMUM_MINOR,
  CHARGEBACK_FEE_MINOR,
} from '../pay/money-terms';
import { ESCROW_FEE_BPS, ESCROW_MINIMUM_FEE_MINOR, ESCROW_MINIMUM_VALUE_MINOR } from '../esc/escrow-terms';
import {
  INSURANCE_MINIMUM_PREMIUM_MINOR,
  INSURANCE_PREMIUM_BPS,
  MAX_INSURED_VALUE_MINOR,
  PAYMENT_WINDOW_DAYS,
  RESTOCKING_FEE_MINOR,
  SIGNATURE_REQUIRED_ABOVE_MINOR,
} from '../shp/shipping-options';
import { CULL_WINDOW_DAYS } from '../dis/disposal-services.service';

export function accountTerms() {
  const env = loadEnv();
  return {
    termsVersion: CURRENT_TERMS_VERSION,
    debt: {
      graceDays: env.WALLET_DEBT_GRACE_DAYS,
      interestBpsPerDay: env.WALLET_DEBT_INTEREST_BPS,
      suspendBelowMinor: env.WALLET_SUSPEND_BELOW_MINOR,
    },
    cashOut: {
      bandMinor: CASHOUT_BAND_MINOR,
      smallBps: CASHOUT_SMALL_BPS,
      smallMinimumMinor: CASHOUT_SMALL_MINIMUM_MINOR,
      largeFixedMinor: CASHOUT_LARGE_FIXED_MINOR,
      largeBps: CASHOUT_LARGE_BPS,
    },
    chargebackFeeMinor: CHARGEBACK_FEE_MINOR,
    escrow: {
      feeBps: ESCROW_FEE_BPS,
      minimumFeeMinor: ESCROW_MINIMUM_FEE_MINOR,
      minimumValueMinor: ESCROW_MINIMUM_VALUE_MINOR,
    },
    shipping: {
      restockingFeeMinor: RESTOCKING_FEE_MINOR,
      paymentWindowDays: PAYMENT_WINDOW_DAYS,
      insurancePremiumBps: INSURANCE_PREMIUM_BPS,
      insuranceMinimumPremiumMinor: INSURANCE_MINIMUM_PREMIUM_MINOR,
      maxInsuredValueMinor: MAX_INSURED_VALUE_MINOR,
      signatureRequiredAboveMinor: SIGNATURE_REQUIRED_ABOVE_MINOR,
    },
    removeCommonsWindowDays: CULL_WINDOW_DAYS,
  };
}
