import { hasMessage, type MessageKey, type TranslateFn } from './i18n';
import { formatUsd } from './money';
import { offerStatusLabel } from './market';
import { shipmentStatusLabel } from './shipments';

/**
 * One entry of an item's history, as `GET /vault/items/:id/timeline` (and the
 * staff `/custody/items/:id/timeline`) return it.
 *
 * `summary` is the API's English sentence and is only a fallback. The line on
 * screen is built here from `kind` + `data`, in the reader's language: the
 * server's sentence came out as "Moved intake → 3f9c…" and "Offer 275000 cents —
 * pending" for everyone, Hebrew readers included.
 */
export interface TimelineEvent {
  at: string;
  kind: string;
  summary: string;
  data?: Record<string, unknown>;
}

/** Lifecycle state → label key, the vault's own vocabulary. */
const STATE_KEY: Record<string, MessageKey> = {
  received: 'vault.state.received',
  stored: 'vault.state.stored',
  listed: 'vault.state.listed',
  'on-hold': 'vault.state.onHold',
  sold: 'vault.state.sold',
  shipped: 'vault.state.shipped',
  donated: 'vault.state.donated',
  consigned: 'vault.state.consigned',
  at_grader: 'vault.state.atGrader',
  discarded: 'vault.state.discarded',
};

const FIELD_KEY: Record<string, MessageKey> = {
  conditionGrade: 'timeline.field.condition',
  description: 'timeline.field.description',
  typeClass: 'timeline.field.class',
};

function state(t: TranslateFn, value: unknown): string {
  const key = typeof value === 'string' ? STATE_KEY[value] : undefined;
  return key ? t(key) : String(value ?? '—');
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A timeline entry's kind, in words. Falls back to the raw kind, underscores removed. */
export function timelineKindLabel(t: TranslateFn, kind: string): string {
  const key = `timeline.${kind}` as MessageKey;
  return hasMessage(key) ? t(key) : kind.replace(/_/g, ' ');
}

/**
 * The entry's sentence, in the reader's language.
 *
 * Operator reasons (a hold's "dispute opened on the sale", an intake note) are a
 * person's own words and are shown as written.
 */
export function timelineLine(t: TranslateFn, e: TimelineEvent): string {
  const d = e.data ?? {};
  const reason = str(d.reason);
  switch (e.kind) {
    case 'intake':
      return str(d.newBin) ? t('timeline.line.shelved', { bin: str(d.newBin)! }) : (reason ?? '');
    case 'relocate':
    case 'bin_transfer': {
      const from = str(d.prevBin) ?? str(d.fromBin);
      const to = str(d.newBin) ?? str(d.toBin);
      if (!to) return reason ?? '';
      return from ? t('timeline.line.moved', { from, to }) : t('timeline.line.shelved', { bin: to });
    }
    case 'state_change':
    case 'dispatch':
      return d.newState
        ? t('timeline.line.state', { from: state(t, d.prevState), to: state(t, d.newState) })
        : (reason ?? '');
    case 'hold_placed':
    case 'hold_released':
    case 'ownership_transfer':
    case 'batch_split':
      return reason ?? '';
    case 'correction': {
      const field = typeof d.field === 'string' ? FIELD_KEY[d.field] : undefined;
      const value = (v: unknown) =>
        d.field === 'typeClass' ? String(v ?? '—') : str(v) ?? '—';
      return t('timeline.line.corrected', {
        field: field ? t(field) : String(d.field ?? ''),
        from: value(d.from),
        to: value(d.to),
      });
    }
    case 'sale':
    case 'swap':
    case 'transfer':
    case 'consignment':
      return [str(d.code), typeof d.amountMinor === 'number' ? formatUsd(d.amountMinor) : null]
        .filter(Boolean)
        .join(' · ');
    case 'shipment':
      return [str(d.code), typeof d.status === 'string' ? shipmentStatusLabel(t, d.status) : null]
        .filter(Boolean)
        .join(' · ');
    case 'offer':
      return [
        typeof d.amountMinor === 'number' ? formatUsd(d.amountMinor) : null,
        typeof d.status === 'string' ? offerStatusLabel(t, d.status) : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'dispute':
      return [str(d.code), str(d.status) && t(`timeline.dispute.${String(d.status)}` as MessageKey), str(d.ruling)]
        .filter(Boolean)
        .join(' · ');
    default:
      return e.summary;
  }
}

/**
 * A catalogue description without its trailing set code.
 *
 * Seeded descriptions end "… · art by Ryo Ueda · ex15-97" — the TCG database's
 * own id for the card, useful to a person looking it up and noise on a register
 * row. The code is kept by `setCode` for the one place that shows it.
 */
const SET_CODE = /\s*·\s*([a-z]+\d*[a-z]*\d*-[A-Za-z]*\d+[A-Za-z]*)\s*$/;

export function displayName(description: string): string {
  return description.replace(SET_CODE, '');
}

export function setCode(description: string): string | null {
  return SET_CODE.exec(description)?.[1] ?? null;
}
