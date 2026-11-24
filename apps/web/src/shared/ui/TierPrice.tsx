import { useI18n, type MessageKey } from '../i18n';
import { formatUsd } from '../money';
import { discountedMinor, useViewerTier, type TierKey } from '../tiers';
import { formatEntryValue, type PriceEntry } from '../servicePrices';

export function TierPrice({
  listMinor,
  chargedMinor,
  tier,
  format = formatUsd,
}: {
  listMinor: number;
  chargedMinor?: number;
  tier?: TierKey;
  format?: (minor: number) => string;
}) {
  const { t } = useI18n();
  const viewer = useViewerTier();
  const shownTier = tier ?? viewer.tier;
  const charged = chargedMinor ?? discountedMinor(listMinor, viewer.discountBps);

  if (shownTier === 'bronze' || charged >= listMinor) {
    return (
      <span className="tier-price">
        <span className="amount" dir="ltr">
          {format(charged)}
        </span>
      </span>
    );
  }

  const tierName = t(`tier.name.${shownTier}` as MessageKey);
  return (
    <span className="tier-price tier-price--discounted" data-tier={shownTier}>
      <span className="tier-price-label">{t('tier.priceLabel', { tier: tierName })}</span>{' '}
      <span className="amount" dir="ltr">
        {format(charged)}
      </span>{' '}
      <s className="tier-price-list" dir="ltr" aria-label={`${t('tier.bronzePrice')} ${format(listMinor)}`}>
        {format(listMinor)}
      </s>
    </span>
  );
}

export function EntryPrice({ entry }: { entry: PriceEntry }) {
  return <TierPrice listMinor={entry.value} format={(value) => formatEntryValue(entry, value)} />;
}
