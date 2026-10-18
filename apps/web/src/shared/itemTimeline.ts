import { hasMessage, type MessageKey, type TranslateFn } from './i18n';
import { itemClassLabel } from './itemClasses';
import { offerStatusLabel } from './market';
import { formatUsd } from './money';
import { shipmentStatusLabel } from './shipments';
import type { StatusTone } from './ui/primitives';

export interface BinLabel {
  barcode: string;
  zone: string;
}

export interface TimelineParams {
  fromBin?: BinLabel | null;
  toBin?: BinLabel | null;
  fromState?: string | null;
  toState?: string | null;
  field?: string;
  from?: string | null;
  to?: string | null;
  amountMinor?: number | null;
  code?: string | null;
  status?: string;
  ruling?: string | null;
}

export interface TimelineEvent {
  at: string;
  kind: string;
  params: TimelineParams;
}

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

const CORRECTABLE_FIELD: Record<string, MessageKey> = {
  description: 'timeline.field.description',
  conditionGrade: 'timeline.field.conditionGrade',
  typeClass: 'timeline.field.typeClass',
};

const DISPUTE_STATUS: Record<string, MessageKey> = {
  open: 'admin.disputes.status.open',
  investigating: 'admin.disputes.status.investigating',
  ruled: 'admin.disputes.status.ruled',
  closed: 'admin.disputes.status.closed',
};

function isolate(value: string): string {
  return `⁨${value}⁩`;
}

function binText(t: TranslateFn, label: BinLabel | null | undefined, missing: MessageKey): string {
  return label ? isolate(`${label.barcode} · ${label.zone}`) : t(missing);
}

function fieldValue(t: TranslateFn, field: string, value: string | null | undefined): string {
  if (!value) return '—';
  return isolate(field === 'typeClass' ? itemClassLabel(t, value) : value);
}

export function timelineDetail(t: TranslateFn, event: TimelineEvent): string {
  const p = event.params ?? {};
  const change = (from: string, to: string) => t('timeline.detail.change', { from, to });

  if ('toState' in p && !p.fromState && !p.fromBin) {
    return p.toBin ? t('timeline.detail.shelvedIn', { bin: binText(t, p.toBin, 'vault.noBin') }) : '';
  }
  if ('fromBin' in p || 'toBin' in p) {
    return change(binText(t, p.fromBin, 'timeline.detail.intake'), binText(t, p.toBin, 'vault.noBin'));
  }
  if (p.fromState && p.toState) {
    return change(stateLabel(t, p.fromState), stateLabel(t, p.toState));
  }
  if (event.kind === 'correction' && p.field) {
    const key = CORRECTABLE_FIELD[p.field] ?? 'timeline.field.other';
    return t('timeline.detail.field', {
      field: t(key),
      change: change(fieldValue(t, p.field, p.from), fieldValue(t, p.field, p.to)),
    });
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
    const status = key ? t(key) : '';
    return p.ruling ? [status, isolate(p.ruling)].filter(Boolean).join(' · ') : status;
  }
  return '';
}
