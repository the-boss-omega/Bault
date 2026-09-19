import type { MessageKey, TranslateFn } from './i18n';
import type { StatusTone } from './ui/primitives';

/**
 * The SPA's vocabulary for the helpdesk.
 *
 * Ticket status answers one question — whose turn is it — so the labels are
 * phrased from the reader's side rather than as internal states. A customer
 * seeing "awaiting_customer" learns nothing; "Waiting for you" is the same fact
 * expressed as the thing they need to do.
 */
export type TicketStatus = 'open' | 'awaiting_customer' | 'resolved';

/**
 * The tone follows "whose turn is it", which is the only question the status
 * answers — and under the previous palette it read backwards. `info` was a teal
 * a shade off the success green, so an OPEN ticket (nobody has looked at this
 * yet) wore what a reader takes for the "done" colour.
 *
 *   open               frost  — somebody else holds it; there is nothing to do
 *   awaiting_customer  amber  — it is waiting on YOU
 *   resolved           custody green — closed
 *
 * Frost is the same tone a frozen item takes, and for the same reason: a state
 * where the next move belongs to somebody else.
 */
export const TICKET_TONE: Record<string, StatusTone> = {
  open: 'info',
  awaiting_customer: 'warning',
  resolved: 'success',
};

/** Customer-facing labels. */
const STATUS_KEY: Record<string, MessageKey> = {
  open: 'support.status.open',
  awaiting_customer: 'support.status.awaitingCustomer',
  resolved: 'support.status.resolved',
};

/**
 * Staff-facing labels for the same statuses.
 *
 * Kept separate because "whose turn is it" reverses depending on who is reading:
 * a ticket that is "waiting for you" to a customer is "waiting for them" to the
 * person working the queue, and one shared string would be wrong for one of them.
 */
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
  /** So staff can see at a glance who is locked out and asking about it. */
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
