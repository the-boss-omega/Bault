import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { AppError } from './errors/app-error';
import { ErrorCode } from './errors/error-codes';
import { escrowDeal } from '../modules/esc/escrow.schema';
import { shipment } from '../modules/shp/shp.schema';
import { ShipmentService } from '../modules/shp/shipment.service';
import { serviceRequest } from '../modules/dis/dis.schema';

const OPEN_ESCROW_STATUSES = ['proposed', 'agreed', 'funded', 'inspecting', 'awaiting_release'] as const;

const OWNERSHIP_CHANGING_SERVICES = ['buyout', 'consignment', 'donation'] as const;

export async function assertItemUncommitted(tx: Database, itemId: string, refusal = 'so it cannot be listed'): Promise<void> {
  const committed = (to: string) =>
    new AppError(ErrorCode.ITEM_COMMITTED, `This card is already committed to ${to}, ${refusal}.`, 409, { itemId });

  const [deal] = await tx
    .select({ code: escrowDeal.code })
    .from(escrowDeal)
    .where(and(eq(escrowDeal.itemId, itemId), inArray(escrowDeal.status, [...OPEN_ESCROW_STATUSES])))
    .limit(1);
  if (deal) throw committed(`escrow deal ${deal.code}`);

  const [parcel] = await tx
    .select({ code: shipment.code })
    .from(shipment)
    .where(
      and(
        sql`${shipment.itemIds} @> ${JSON.stringify([itemId])}::jsonb`,
        inArray(shipment.status, [...ShipmentService.OPEN_STATUSES]),
      ),
    )
    .limit(1);
  if (parcel) throw committed(`shipment ${parcel.code ?? ''}`.trim());

  const [request] = await tx
    .select({ code: serviceRequest.code, type: serviceRequest.type })
    .from(serviceRequest)
    .where(
      and(
        eq(serviceRequest.itemId, itemId),
        inArray(serviceRequest.type, [...OWNERSHIP_CHANGING_SERVICES]),
        inArray(serviceRequest.status, ['requested', 'in_progress']),
      ),
    )
    .limit(1);
  if (request) throw committed(`a ${request.type} (${request.code})`);
}
