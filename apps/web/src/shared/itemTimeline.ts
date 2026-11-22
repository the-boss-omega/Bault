import { hasMessage, type MessageKey, type TranslateFn } from './i18n';
import { offerStatusLabel } from './market';
import { formatUsd } from './money';
import { shipmentStatusLabel } from './shipments';
import type { StatusTone } from './ui/primitives';

export interface TimelineParams {
  fromState?: string | null;
  toState?: string | null;
  amountMinor?: number | null;
  code?: string | null;
  status?: string;
}

export interface TimelineEvent {
  at: string;
  kind: string;
  params: TimelineParams;
}

export interface Departure {
  kind:
    | 'shipped'
    | 'donated'
    | 'discarded'
    | 'consigned'
    | 'buyout'
    | 'sold'
    | 'gift'
    | 'swap'
    | 'escrow'
    | 'left';
  code: string | null;
}

const DEPARTURE_LABEL: Record<Departure['kind'], MessageKey> = {
  shipped: 'vault.departure.shipped',
  donated: 'vault.departure.donated',
  discarded: 'vault.departure.discarded',
  consigned: 'vault.departure.consigned',
  buyout: 'vault.departure.buyout',
  sold: 'vault.departure.sold',
  gift: 'vault.departure.gift',
  swap: 'vault.departure.swap',
  escrow: 'vault.departure.escrow',
  left: 'vault.departure.left',
};

export const STATE_META: Record<string, { tone: StatusTone; label: MessageKey }> = {
  stored: { tone: 'success', label: 'vault.state.stored' },
  listed: { tone: 'info', label: 'vault.state.listed' },
  sold: { tone: 'gold', label: 'vault.state.sold' },
  'on-hold': { tone: 'error', label: 'vault.state.onHold' },
  received: { tone: 'info', label: 'vault.state.received' },
  shipped: { tone: 'violet', label: 'vault.state.shipped' },
  donated: { tone: 'success', label: 'vault.state.donated' },
  consigned: { tone: 'info', label: 'vault.state.consigned' },
  at_grader: { tone: 'violet', label: 'vault.state.atGrader' },
  discarded: { tone: 'neutral', label: 'vault.state.discarded' },
};

export function stateLabel(t: TranslateFn, state: string): string {
  const meta = STATE_META[state];
  return meta ? t(meta.label) : state;
}

export function timelineKindLabel(t: TranslateFn, kind: string): string {
  const key = `timeline.${kind}` as MessageKey;
  return hasMessage(key) ? t(key) : kind.replace(/_/g, ' ');
}

const SALE_KINDS = new Set(['sale', 'swap', 'transfer', 'consignment']);

const WAREHOUSE_KINDS = new Set(['correction', 'bin_transfer', 'relocate']);

export function collectorTimeline(events: readonly TimelineEvent[]): TimelineEvent[] {
  return events.filter((e) => !WAREHOUSE_KINDS.has(e.kind));
}

const DISPUTE_STATUS: Record<string, MessageKey> = {
  open: 'timeline.dispute.open',
  investigating: 'timeline.dispute.investigating',
  ruled: 'timeline.dispute.ruled',
  closed: 'timeline.dispute.closed',
};

function isolate(value: string): string {
  return `⁨${value}⁩`;
}

export function timelineDetail(t: TranslateFn, event: TimelineEvent): string {
  const p = event.params ?? {};
  const change = (from: string, to: string) => t('timeline.detail.change', { from, to });

  if (p.fromState && p.toState) {
    return change(stateLabel(t, p.fromState), stateLabel(t, p.toState));
  }
  if (SALE_KINDS.has(event.kind)) {
    return p.amountMinor != null ? isolate(formatUsd(p.amountMinor)) : '';
  }
  if (event.kind === 'shipment' && p.status) {
    const status = shipmentStatusLabel(t, p.status);
    return p.code ? `${isolate(p.code)} · ${status}` : status;
  }
  if (event.kind === 'offer' && p.status) {
    const status = offerStatusLabel(t, p.status);
    return p.amountMinor != null ? `${isolate(formatUsd(p.amountMinor))} · ${status}` : status;
  }
  if (event.kind === 'dispute' && p.status) {
    const key = DISPUTE_STATUS[p.status];
    return key ? t(key) : '';
  }
  return '';
}

export function departureLabel(t: TranslateFn, departure: Departure): string {
  if (departure.kind === 'escrow') {
    return departure.code ? t('vault.departure.escrow', { code: isolate(departure.code) }) : t('vault.departure.left');
  }
  return t(DEPARTURE_LABEL[departure.kind] ?? 'vault.departure.left');
}
