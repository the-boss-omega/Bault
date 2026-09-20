import type { TranslateFn } from '../../../shared/i18n';
import { Button, StatusBadge } from '../../../shared/ui/primitives';

/** A listing as the shelf, the storefront and the listing drawer render it. */
export interface Listing {
  id: string;
  askingPrice: number;
  currency?: string;
  itemId?: string;
  serialNumber: string;
  typeClass: string;
  conditionGrade: string | null;
  description: string;
  imageUrl?: string | null;
  /** Only on `GET /marketplace/listings/:id`. */
  status?: string;
}

/* ============================================================
   The controls on a listing, wherever it is shown
   ============================================================ */

/**
 * Buy and Make offer — or, on the reader's own listing, a way to manage it.
 *
 * Shared by the shelf, the storefront and the listing drawer, so a card is
 * never buyable in one of them and "yours" in another.
 */
export function ListingActions({
  listing,
  mine,
  t,
  onBuy,
  onOffer,
  onManage,
  onDetails,
}: {
  listing: Listing;
  mine: boolean;
  t: TranslateFn;
  onBuy: (l: Listing) => void;
  onOffer: (l: Listing) => void;
  onManage: () => void;
  onDetails?: () => void;
}) {
  return (
    <div className="actions">
      {mine ? (
        <>
          <StatusBadge tone="info">{t('market.yourListing')}</StatusBadge>
          <Button variant="secondary" size="sm" onClick={onManage}>
            {t('market.manageListing')}
          </Button>
        </>
      ) : (
        <>
          {/* Buying is irreversible and settles from the wallet; making an
              offer opens a negotiation. They were the same size and weight. */}
          <Button variant="gold" size="sm" onClick={() => onBuy(listing)}>
            {t('market.buy')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onOffer(listing)}>
            {t('market.makeOffer')}
          </Button>
        </>
      )}
      {onDetails && (
        <Button variant="ghost" size="sm" onClick={onDetails}>
          {t('market.details')}
        </Button>
      )}
    </div>
  );
}

