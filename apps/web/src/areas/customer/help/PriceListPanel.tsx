import { useEffect, useState } from 'react';
import { api } from '../../../shared/api';
import { useI18n, type MessageKey, type TranslateFn } from '../../../shared/i18n';
import { itemClassLabel } from '../../../shared/itemClasses';
import { formatUsd } from '../../../shared/money';
import { EmptyState, ErrorState, Panel, StatusBadge } from '../../../shared/ui/primitives';
import { IconReceipt } from '../../../shared/ui/icons';

interface PriceEntry {
  actionType: string;
  itemClass: string | null;
  description: string;
  model: 'fixed' | 'percentage';
  /** Cents for a fixed rule, basis points for a percentage one. */
  value: number;
  currency: string;
  billingTrigger: string;
  parameters: Record<string, unknown> | null;
}

interface PriceList {
  groups: { group: string; entries: PriceEntry[] }[];
  note: string;
}

/**
 * What each rule is FOR, in the reader's language.
 *
 * The rule's own `description` comes out of the database in English, so a Hebrew
 * reader met a table of English sentences — and the class-specific intake rules
 * read "for trading_card". Each action type has a label here; a rule whose
 * action nothing names falls back to its description, which is the only honest
 * fallback (an unlabelled price is worse than an English one).
 */
const WHAT: Record<string, MessageKey> = {
  intake: 'prices.what.intake',
  intake_lot: 'prices.what.intakeLot',
  parcel_processing: 'prices.what.parcelProcessing',
  parcel_forwarding: 'prices.what.parcelForwarding',
  storage: 'prices.what.storage',
  storage_oversized: 'prices.what.storageOversized',
  service: 'prices.what.service',
  'service_fee:deslab': 'prices.what.deslab',
  'service_fee:condition_inspection': 'prices.what.inspection',
  'service_fee:video_review': 'prices.what.videoReview',
  'grading_fee:psa_value': 'prices.what.gradingPsaValue',
  'grading_fee:psa_regular': 'prices.what.gradingPsaRegular',
  'grading_fee:psa_express': 'prices.what.gradingPsaExpress',
  'grading_fee:psa_walkthrough': 'prices.what.gradingPsaWalkthrough',
  'grading_fee:bgs_standard': 'prices.what.gradingBgsStandard',
  shipping: 'prices.what.shipping',
  shipping_rush: 'prices.what.shippingRush',
  'shipping_addon:gps_tracker': 'prices.what.gpsTracker',
  show_pickup: 'prices.what.showPickup',
  'white_glove:domestic': 'prices.what.whiteGloveDomestic',
  'white_glove:international': 'prices.what.whiteGloveInternational',
  marketplace_fee: 'prices.what.marketplaceFee',
  'consignment_fee:card_show': 'prices.what.consignmentShow',
  'consignment_fee:auction_house': 'prices.what.consignmentAuction',
  'consignment_fee:ebay_partner': 'prices.what.consignmentEbay',
  escrow_fee: 'prices.what.escrowFee',
  cash_out_fee: 'prices.what.cashOutFee',
  chargeback_fee: 'prices.what.chargebackFee',
  'membership:folio': 'prices.what.membershipFolio',
  'membership:registry': 'prices.what.membershipRegistry',
  'membership:trust': 'prices.what.membershipTrust',
};

/** A finite number out of a rule's `parameters`, or null when it is not one. */
function param(entry: PriceEntry, key: string): number | null {
  const raw = entry.parameters?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function PriceListPanel() {
  const { t } = useI18n();
  const [list, setList] = useState<PriceList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setList(await api.get<PriceList>('/pricing/list'));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  function whatOf(entry: PriceEntry): string {
    // Intake is priced per class, so the class IS the row's subject.
    if (entry.actionType === 'intake' && entry.itemClass) {
      return t('prices.what.intakeClass', { itemClass: itemClassLabel(t, entry.itemClass) });
    }
    const key = WHAT[entry.actionType];
    return key ? t(key) : entry.description;
  }

  /**
   * The price, in the units the rule is actually charged in.
   *
   * Three rules do not state their own figure, and printing `value` for them
   * quoted a number nobody is ever charged:
   *
   *   storage / storage_oversized  The real terms are in `parameters` — the
   *                                included window, the period and the
   *                                proportion of the item's own intake fee.
   *                                `value` is only a fallback base, and it was
   *                                being shown as "$1.00 daily".
   *   cash_out_fee                 Charged from the band schedule in
   *                                `money-terms.ts`, not from this rule.
   *   escrow_fee                   1% of the deal, with a floor the rule has no
   *                                field for.
   */
  function priceOf(entry: PriceEntry): string {
    if (entry.actionType === 'storage' || entry.actionType === 'storage_oversized') {
      const free = param(entry, 'freeDays');
      const period = param(entry, 'periodDays');
      const bps = param(entry, 'percentOfIntakeBps');
      if (free !== null && period !== null && bps !== null) {
        return t('prices.storageTerms', {
          days: free,
          percent: (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2),
          period,
        });
      }
    }
    if (entry.actionType === 'cash_out_fee') return t('prices.cashOutSchedule');
    if (entry.actionType === 'escrow_fee') return t('prices.escrowSchedule');
    if (entry.model === 'percentage') return `${(entry.value / 100).toFixed(2)}%`;
    // A zero rule is included in something else, and says so rather than
    // printing $0.00 next to the things that do cost money.
    return entry.value === 0 ? t('prices.included') : formatUsd(entry.value);
  }

  /** When it is charged. Storage bills per period, not on the sweep's schedule. */
  function whenOf(entry: PriceEntry, t: TranslateFn): string {
    if (entry.actionType === 'storage' || entry.actionType === 'storage_oversized') {
      return t('prices.trigger.perPeriod');
    }
    return t(`prices.trigger.${entry.billingTrigger}` as MessageKey);
  }

  return (
    <>
      {error && <ErrorState message={error} />}
      <Panel title={t('prices.title')} subtitle={t('prices.subtitle')}>
        {list === null ? (
          <p className="hint">{t('grp.loading')}</p>
        ) : list.groups.length === 0 ? (
          <EmptyState title={t('prices.none')} text={t('prices.noneText')} icon={<IconReceipt />} />
        ) : (
          <>
            <p className="field-hint">{t('prices.note')}</p>
            {list.groups.map((g) => (
              <div key={g.group} className="stack-top">
                <h3 className="drawer-heading">{t(`prices.group.${g.group}` as MessageKey)}</h3>
                <div className="dt-wrap dt-wrap--stack">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('prices.col.what')}</th>
                        <th scope="col">{t('prices.col.price')}</th>
                        <th scope="col">{t('prices.col.when')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.entries.map((e) => (
                        <tr key={`${e.actionType}:${e.itemClass ?? ''}`}>
                          <td data-label={t('prices.col.what')} className="dt-primary">
                            {whatOf(e)}
                          </td>
                          <td data-label={t('prices.col.price')}>
                            <strong>{priceOf(e)}</strong>
                          </td>
                          <td data-label={t('prices.col.when')}>
                            <StatusBadge tone="neutral" plain>
                              {whenOf(e, t)}
                            </StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        )}
      </Panel>
    </>
  );
}
