import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { money } from '../../shared/money';
import { CustodyService } from '../cst/custody.service';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { PricingService } from '../prc/pricing.service';
import { item } from '../cst/cst.schema';
import { transaction } from '../mkt/mkt.schema';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { ServiceRequestService } from './service.service';

/** Fields the operator MUST fill to close a consignment request (Requirement 5.4). */
export interface ConsignmentFulfillment {
  saleAmountMinor: number;
  channel: string;
  externalReference: string;
  itemVerified: boolean;
  notes: string;
}

const CONSIGNMENT_REQUIRED: readonly (keyof ConsignmentFulfillment)[] = [
  'saleAmountMinor',
  'channel',
  'externalReference',
  'itemVerified',
  'notes',
];

/** Fields the operator MUST fill to close a warehouse transfer (Requirement 5.4). */
export interface TransferFulfillment {
  destinationWarehouse: string;
  destinationBin: string;
  itemVerified: boolean;
  notes: string;
}

const TRANSFER_REQUIRED: readonly (keyof TransferFulfillment)[] = [
  'destinationWarehouse',
  'destinationBin',
  'itemVerified',
  'notes',
];

/**
 * Consignment sale + warehouse transfer (T099, Principles I/V/VI) — Opus-tier.
 *
 * Consignment: the owner requests an external-channel sale (eBay/event; billable).
 * An operator marks it complete with the achieved sale amount → in one
 * transaction the owner is credited NET of the marketplace fee (gross credit +
 * fee debit on the ledger), the item's ownership moves to the platform custodian,
 * and it enters the terminal `consigned` state. Warehouse transfer just relocates
 * an item to another warehouse via a billable request + custody event.
 */
@Injectable()
export class ConsignmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly requests: ServiceRequestService,
    private readonly ledger: LedgerService,
    private readonly pricing: PricingService,
  ) {}

  async request(ownerId: string, itemId: string, channel: string) {
    return this.custody.run(async (tx) => {
      const [it] = await tx.select().from(item).where(eq(item.id, itemId)).for('update').limit(1);
      if (!it || it.ownerId !== ownerId) throw AppError.forbidden('Not your item');
      if (it.lifecycleState !== 'stored') throw new AppError(ErrorCode.CONFLICT, 'Item must be stored', 409);
      return this.requests.create(tx, {
        type: 'consignment',
        requesterId: ownerId,
        itemId,
        typeFields: { channel },
      });
    });
  }

  async complete(operatorId: string, requestId: string, form: ConsignmentFulfillment) {
    const saleAmountMinor = form.saleAmountMinor;
    return this.custody.run(async (tx) => {
      const req = await this.requests.get(requestId);
      this.requests.assertAccepted(req); // operator must accept before completing
      if (req.type !== 'consignment') throw AppError.validation('Not a consignment request');
      if (!req.itemId) throw AppError.validation('Request has no item');
      const ownerId = req.requesterId;
      const currency = DEFAULT_CURRENCY;

      const { amount: fee, snapshot } = await this.pricing.price(
        'marketplace_fee',
        { base: money(saleAmountMinor, currency) },
        tx,
      );

      // Credit owner gross, debit the fee → net proceeds, all on the immutable ledger.
      await this.ledger.record(
        { userId: ownerId, type: 'sale_credit', amount: saleAmountMinor, direction: 'credit', currency, referenceType: 'service_request', referenceId: req.id },
        tx,
      );
      if (fee.amount > 0) {
        await this.ledger.record(
          { userId: ownerId, type: 'fee', amount: fee.amount, direction: 'debit', currency, referenceType: 'service_request', referenceId: req.id },
          tx,
        );
      }

      const platformId = await this.requests.platformAccountId(tx);
      await this.custody.transferOwnership(tx, req.itemId, platformId, operatorId, 'consignment sale');
      await this.custody.changeState(tx, req.itemId, 'consigned', operatorId, 'consigned');

      // Every transaction on the platform is recorded (Requirement 13.1) — this
      // row is what makes a consignment sale disputable (13.3) and visible on the
      // item's history timeline (13.2).
      const [txn] = await tx
        .insert(transaction)
        .values({
          code: prefixedId(ID_PREFIX.transaction),
          type: 'consignment',
          itemIds: [req.itemId],
          buyerId: null,
          sellerId: ownerId,
          price: saleAmountMinor,
          fee: fee.amount,
          frozenPricing: snapshot,
          currency,
        })
        .returning({ id: transaction.id, code: transaction.code });

      await this.requests.completeWithFulfillment(tx, req.id, operatorId, { ...form }, CONSIGNMENT_REQUIRED, {
        saleAmount: saleAmountMinor,
        fee: fee.amount,
        transactionId: txn?.id,
      });

      return { status: 'completed', net: saleAmountMinor - fee.amount, transactionId: txn?.id, transactionCode: txn?.code };
    });
  }

  /**
   * Transfer an item to another warehouse. The operator's structured fulfillment
   * form (destination, destination bin, verification, notes) is required to close
   * the request (Requirement 5.4), and the physical move is logged as a relocate.
   */
  async warehouseTransfer(actorId: string, itemId: string, form: TransferFulfillment) {
    return this.custody.run(async (tx) => {
      const req = await this.requests.create(tx, {
        type: 'warehouse_transfer',
        requesterId: actorId,
        itemId,
        typeFields: { destinationWarehouse: form.destinationWarehouse },
      });
      if (!req) throw AppError.validation('Failed to create warehouse-transfer request');
      // Record the physical move as a relocate custody event to an external bin
      // marker (item.bin_id is free text, not FK-constrained).
      await this.custody.relocate(tx, itemId, `EXT:${form.destinationWarehouse}/${form.destinationBin}`, actorId);
      await this.requests.completeWithFulfillment(tx, req.id, actorId, { ...form }, TRANSFER_REQUIRED, {
        destinationWarehouse: form.destinationWarehouse,
        destinationBin: form.destinationBin,
      });
      return req;
    });
  }
}
