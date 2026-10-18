import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { offer } from './mkt.schema';

export async function closeOpenOffers(tx: Database, listingId: string): Promise<number> {
  const closed = await tx
    .update(offer)
    .set({ status: 'rejected', updatedAt: new Date() })
    .where(and(eq(offer.listingId, listingId), eq(offer.status, 'pending')))
    .returning({ id: offer.id });
  return closed.length;
}
