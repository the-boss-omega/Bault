import type { MessageKey, TranslateFn } from './i18n';
import { SERVICE_TYPE_KEY } from './serviceLabels';

const ACTION_KEY: Record<string, MessageKey> = {
  intake: 'admin.pricing.action.intake',
  intake_lot: 'admin.pricing.action.intakeLot',
  parcel_processing: 'admin.pricing.action.parcelProcessing',
  parcel_forwarding: 'admin.pricing.action.parcelForwarding',
  storage: 'admin.pricing.action.storage',
  storage_oversized: 'admin.pricing.action.storageOversized',
  service: 'admin.pricing.action.service',
  marketplace_fee: 'admin.pricing.action.marketplaceFee',
  escrow_fee: 'admin.pricing.action.escrowFee',
  custom: 'admin.pricing.action.custom',
  shipping: 'admin.pricing.action.shipping',
  shipping_rush: 'admin.pricing.action.shippingRush',
  show_pickup: 'admin.pricing.action.showPickup',
  'white_glove:domestic': 'admin.pricing.action.whiteGloveDomestic',
  'white_glove:international': 'admin.pricing.action.whiteGloveInternational',
  shipping_restocking_fee: 'admin.pricing.action.restockingFee',
  shipping_insurance_premium: 'admin.pricing.action.insurancePremium',
  direct_ship_flat: 'admin.pricing.action.directShip',
  cash_out_fee: 'admin.pricing.action.cashOutFee',
  chargeback_fee: 'admin.pricing.action.chargebackFee',
  interest: 'admin.pricing.action.interest',
};

const GRADING_TIER_KEY: Record<string, MessageKey> = {
  psa_value: 'grade.tier.psa_value',
  psa_regular: 'grade.tier.psa_regular',
  psa_express: 'grade.tier.psa_express',
  psa_walkthrough: 'grade.tier.psa_walkthrough',
  bgs_standard: 'grade.tier.bgs_standard',
};

const CHANNEL_KEY: Record<string, MessageKey> = {
  card_show: 'admin.pricing.channel.cardShow',
  auction_house: 'admin.pricing.channel.auctionHouse',
  ebay_partner: 'admin.pricing.channel.ebayPartner',
  alt: 'admin.pricing.channel.alt',
  fanatics_collect: 'admin.pricing.channel.fanaticsCollect',
};

const ADD_ON_KEY: Record<string, MessageKey> = {
  gps_tracker: 'ship.addon.gps_tracker',
};

const PREFIXED: { prefix: string; names: Record<string, MessageKey>; template: MessageKey }[] = [
  { prefix: 'service_fee:', names: SERVICE_TYPE_KEY, template: 'admin.pricing.action.serviceFee' },
  { prefix: 'grading_fee:', names: GRADING_TIER_KEY, template: 'admin.pricing.action.gradingFee' },
  { prefix: 'consignment_fee:', names: CHANNEL_KEY, template: 'admin.pricing.action.consignmentFee' },
  { prefix: 'shipping_addon:', names: ADD_ON_KEY, template: 'admin.pricing.action.addOn' },
];

export function pricingActionName(t: TranslateFn, actionType: string): string | null {
  const key = ACTION_KEY[actionType];
  if (key) return t(key);
  for (const { prefix, names, template } of PREFIXED) {
    if (!actionType.startsWith(prefix)) continue;
    const name = names[actionType.slice(prefix.length)];
    return name ? t(template, { name: t(name) }) : null;
  }
  return null;
}
