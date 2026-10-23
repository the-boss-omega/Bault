import type { MessageKey, TranslateFn } from './i18n';
import type { StatusTone } from './ui/primitives';

export type TicketStatus = 'open' | 'awaiting_customer' | 'resolved';

export const TICKET_TONE: Record<string, StatusTone> = {
  open: 'info',
  awaiting_customer: 'warning',
  resolved: 'success',
};

const STATUS_KEY: Record<string, MessageKey> = {
  open: 'support.status.open',
  awaiting_customer: 'support.status.awaitingCustomer',
  resolved: 'support.status.resolved',
};

const STAFF_STATUS_KEY: Record<string, MessageKey> = {
  open: 'support.staffStatus.open',
  awaiting_customer: 'support.staffStatus.awaitingCustomer',
  resolved: 'support.staffStatus.resolved',
};

export function ticketStatusLabel(t: TranslateFn, status: string, staff = false): string {
  const key = (staff ? STAFF_STATUS_KEY : STATUS_KEY)[status];
  return key ? t(key) : status.replace(/_/g, ' ');
}

export const TICKET_CATEGORIES: readonly { key: string; labelKey: MessageKey }[] = [
  { key: 'parcel', labelKey: 'support.category.parcel' },
  { key: 'shipment', labelKey: 'support.category.shipment' },
  { key: 'item', labelKey: 'support.category.item' },
  { key: 'billing', labelKey: 'support.category.billing' },
  { key: 'account', labelKey: 'support.category.account' },
  { key: 'private_sale', labelKey: 'support.category.private_sale' },
  { key: 'other', labelKey: 'support.category.other' },
];

const CATEGORY_BY_KEY = new Map(TICKET_CATEGORIES.map((c) => [c.key, c]));

export function ticketCategoryLabel(t: TranslateFn, key: string): string {
  const option = CATEGORY_BY_KEY.get(key);
  return option ? t(option.labelKey) : key;
}

export interface SupportTicket {
  id: string;
  code: string;
  category: string;
  subject: string;
  status: string;
  relatedType: string | null;
  relatedId: string | null;
  lastMessageAt: string;
  createdAt: string;
}

export interface SupportQueueRow extends SupportTicket {
  assignedTo: string | null;
  customerUsername: string | null;
  customerStatus: string | null;
}

export interface SupportMessage {
  id: string;
  authorRole: string;
  body: string;
  createdAt: string;
  authorUsername: string | null;
}

export interface SupportThread {
  ticket: SupportTicket & { assignedTo?: string | null; userId?: string };
  messages: SupportMessage[];
}
