import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { item } from '../../modules/cst/cst.schema';
import { listing, swapProposal } from '../../modules/mkt/mkt.schema';
import { escrowDeal } from '../../modules/esc/escrow.schema';
import { OPEN_SHIPMENT_STATUSES, shipment } from '../../modules/shp/shp.schema';
import { serviceRequest } from '../../modules/dis/dis.schema';

export const OPEN_ESCROW_STATUSES = ['proposed', 'agreed', 'funded', 'inspecting', 'awaiting_release'] as const;

export const COMMITTING_SERVICES = [
  'buyout',
  'consignment',
  'donation',
  'third_party_grading',
  'deslab',
  'batch_split',
] as const;

type CommittingService = (typeof COMMITTING_SERVICES)[number];

const SERVICE_WORDS: Record<CommittingService, string> = {
  buyout: 'a buyout',
  consignment: 'a consignment',
  donation: 'a donation',
  third_party_grading: 'a grading request',
  deslab: 'a slab crack-out',
  batch_split: 'a lot split',
};

export interface CommitmentExceptions {
  shipmentId?: string;
  serviceRequestId?: string;
  swapId?: string;
  listingId?: string;
  escrowDealId?: string;
  shipToBuyer?: boolean;
}

const NONE = '00000000-0000-0000-0000-000000000000';

export async function commitmentOf(
  tx: Database,
  itemId: string,
  except: CommitmentExceptions = {},
): Promise<string | null> {
  const [deal] = await tx
    .select({ code: escrowDeal.code })
    .from(escrowDeal)
    .where(
      and(
        eq(escrowDeal.itemId, itemId),
        inArray(escrowDeal.status, [...OPEN_ESCROW_STATUSES]),
        ne(escrowDeal.id, except.escrowDealId ?? NONE),
        except.shipToBuyer ? ne(escrowDeal.settlement, 'ship_to_buyer') : undefined,
      ),
    )
    .limit(1);
  if (deal) return `escrow deal ${deal.code ?? ''}`.trim();

  const [parcel] = await tx
    .select({ code: shipment.code })
    .from(shipment)
    .where(
      and(
        sql`${shipment.itemIds} @> ${JSON.stringify([itemId])}::jsonb`,
        inArray(shipment.status, [...OPEN_SHIPMENT_STATUSES]),
        ne(shipment.id, except.shipmentId ?? NONE),
      ),
    )
    .limit(1);
  if (parcel) return `shipment ${parcel.code ?? ''}`.trim();

  const [request] = await tx
    .select({ code: serviceRequest.code, type: serviceRequest.type })
    .from(serviceRequest)
    .where(
      and(
        eq(serviceRequest.itemId, itemId),
        inArray(serviceRequest.type, [...COMMITTING_SERVICES]),
        inArray(serviceRequest.status, ['requested', 'in_progress']),
        ne(serviceRequest.id, except.serviceRequestId ?? NONE),
      ),
    )
    .limit(1);
  if (request) return `${SERVICE_WORDS[request.type as CommittingService]} (${request.code})`;

  const [listed] = await tx
    .select({ id: listing.id })
    .from(listing)
    .where(and(eq(listing.itemId, itemId), eq(listing.status, 'active'), ne(listing.id, except.listingId ?? NONE)))
    .limit(1);
  if (listed) return 'a marketplace listing';

  const wanted = JSON.stringify([itemId]);
  const [swap] = await tx
    .select({ requested: swapProposal.requestedItemIds })
    .from(swapProposal)
    .where(
      and(
        eq(swapProposal.status, 'pending'),
        or(
          sql`${swapProposal.offeredItemIds} @> ${wanted}::jsonb`,
          sql`${swapProposal.requestedItemIds} @> ${wanted}::jsonb`,
        ),
        ne(swapProposal.id, except.swapId ?? NONE),
      ),
    )
    .limit(1);
  if (swap) {
    return ((swap.requested as string[] | null) ?? []).length === 0 ? 'a gift waiting to be accepted' : 'a swap proposal';
  }

  return null;
}

export async function assertItemsUncommitted(
  tx: Database,
  itemIds: readonly string[],
  doing: string,
  except: CommitmentExceptions = {},
): Promise<void> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  for (const itemId of ids) {
    const where = await commitmentOf(tx, itemId, except);
    if (!where) continue;
    let subject = 'This card';
    if (ids.length > 1) {
      const [row] = await tx.select({ serialNumber: item.serialNumber }).from(item).where(eq(item.id, itemId)).limit(1);
      subject = `Card ${row?.serialNumber ?? itemId}`;
    }
    throw new AppError(
      ErrorCode.ITEM_COMMITTED,
      `${subject} is already committed to ${where}, so it cannot be ${doing}.`,
      409,
      { itemId },
    );
  }
}
