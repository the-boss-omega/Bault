import type { MessageKey, TranslateFn } from './i18n';

/**
 * What a priced action IS, by the family before the colon.
 *
 * The platform's action types are a family and a variant — `grading_fee:psa_regular`,
 * `membership:trust`, `shipping_addon:gps_tracker`. The family is the part a
 * reader needs ("a grading fee"); the variant is named by the rule's own
 * description, or by the record the charge points at.
 *
 * Shared because three screens need the same words: the admin price rules, the
 * customer price list, and the wallet, where every service charge used to read
 * "Platform charge" whatever it was for.
 */
export const ACTION_FAMILY_LABEL: Record<string, MessageKey> = {
  intake: 'admin.pricing.action.intake',
  intake_lot: 'admin.pricing.action.intakeLot',
  storage: 'admin.pricing.action.storage',
  storage_oversized: 'admin.pricing.action.storageOversized',
  service: 'admin.pricing.action.service',
  service_fee: 'admin.pricing.action.serviceFee',
  shipping: 'admin.pricing.action.shipping',
  shipping_rush: 'admin.pricing.action.shippingRush',
  shipping_addon: 'admin.pricing.action.shippingAddon',
  marketplace_fee: 'admin.pricing.action.marketplaceFee',
  cash_out_fee: 'admin.pricing.action.cashOutFee',
  chargeback_fee: 'admin.pricing.action.chargebackFee',
  consignment_fee: 'admin.pricing.action.consignmentFee',
  escrow_fee: 'admin.pricing.action.escrowFee',
  grading_fee: 'admin.pricing.action.gradingFee',
  membership: 'admin.pricing.action.membership',
  parcel_forwarding: 'admin.pricing.action.parcelForwarding',
  parcel_processing: 'admin.pricing.action.parcelProcessing',
  show_pickup: 'admin.pricing.action.showPickup',
  white_glove: 'admin.pricing.action.whiteGlove',
};

export function actionLabel(t: TranslateFn, actionType: string): string {
  const key = ACTION_FAMILY_LABEL[actionType.split(':')[0] ?? actionType];
  return key ? t(key) : actionType;
}
