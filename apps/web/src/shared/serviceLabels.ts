import type { MessageKey, TranslateFn } from './i18n';

/**
 * Service-request type/status labels, shared by the customer and operator views.
 * These map the API's wire values onto catalogue keys; use the helpers below so an
 * unrecognised value degrades to the raw string instead of a blank cell.
 */
export const SERVICE_TYPE_KEY: Record<string, MessageKey> = {
  professional_photography: 'service.type.professional_photography',
  third_party_grading: 'service.type.third_party_grading',
  consignment: 'service.type.consignment',
  donation: 'service.type.donation',
  batch_split: 'service.type.batch_split',
  warehouse_transfer: 'service.type.warehouse_transfer',
  buyout: 'service.type.buyout',
  video_review: 'service.type.video_review',
  condition_inspection: 'service.type.condition_inspection',
  deslab: 'service.type.deslab',
  remove_commons: 'service.type.remove_commons',
  custom: 'service.type.custom',
};

export const SERVICE_STATUS_KEY: Record<string, MessageKey> = {
  requested: 'service.status.requested',
  in_progress: 'service.status.in_progress',
  completed: 'service.status.completed',
  cancelled: 'service.status.cancelled',
};

export function serviceTypeLabel(t: TranslateFn, type: string): string {
  const key = SERVICE_TYPE_KEY[type];
  return key ? t(key) : type;
}

export function serviceStatusLabel(t: TranslateFn, status: string): string {
  const key = SERVICE_STATUS_KEY[status];
  return key ? t(key) : status;
}
