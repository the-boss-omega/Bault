import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { offer } from './mkt.schema';

/**
 * Close every offer still open on a listing that is no longer for sale.
 *
 * Called inside the transaction that ends the listing (a purchase, an accepted
 * offer, a removal), after any offer that is being accepted has been marked
 * so. An offer left `pending` on a sold card can never be accepted, yet it
 * tells the bidder their money is still promised and shows the seller
 * something to answer. `rejected` is the state a declined offer already has.
 *
 * No notification goes with it: the catalogue has no event that tells a bidder
 * their offer lapsed, and `offer_countered`/`item_sold` say something else.
 */
export async function closeOpenOffers(tx: Database, listingId: string): Promise<number> {
  const closed = await tx
    .update(offer)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(and(eq(offer.listingId, listingId), eq(offer.status, 'pending')))
    .returning({ id: offer.id });
  return closed.length;
}
