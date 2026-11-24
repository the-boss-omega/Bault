import type { MessageKey, TranslateFn } from './i18n';

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

const IN_PROGRESS_KEY: Record<string, MessageKey> = {
  professional_photography: 'service.status.in_progress.professional_photography',
  third_party_grading: 'service.status.in_progress.third_party_grading',
  consignment: 'service.status.in_progress.consignment',
  donation: 'service.status.in_progress.donation',
  batch_split: 'service.status.in_progress.batch_split',
  warehouse_transfer: 'service.status.in_progress.warehouse_transfer',
  buyout: 'service.status.in_progress.buyout',
  video_review: 'service.status.in_progress.video_review',
  condition_inspection: 'service.status.in_progress.condition_inspection',
  deslab: 'service.status.in_progress.deslab',
  remove_commons: 'service.status.in_progress.remove_commons',
  custom: 'service.status.in_progress.custom',
};

export function serviceStatusLabel(t: TranslateFn, status: string, type?: string): string {
  const key = (status === 'in_progress' && type ? IN_PROGRESS_KEY[type] : undefined) ?? SERVICE_STATUS_KEY[status];
  return key ? t(key) : status;
}
