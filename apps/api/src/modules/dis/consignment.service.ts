import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
import { serviceRequest } from './dis.schema';
import { consignmentEvent } from './consignment-event.schema';
import { channelFeeAction, checkEligibility, consignmentChannel } from './consignment-channels';

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

  /**
   * Consign an item down a chosen channel, at a price the owner sets.
   *
   * Everything that can be refused is refused HERE, before the billable service
   * request exists. A seller who is going to be told "graded cards only" or
   * "that show is full" should hear it before they are charged a service fee,
   * not after an operator picks the request up two days later.
   */
  async request(
    ownerId: string,
    itemId: string,
    channelKey: string,
    askingMinor: number,
    eventId?: string,
  ) {
    const channel = consignmentChannel(channelKey);
    if (!channel) throw AppError.validation(`Unknown consignment channel "${channelKey}"`);
    if (!Number.isInteger(askingMinor) || askingMinor <= 0) {
      throw AppError.validation('Set the price you want for it');
    }

    return this.custody.run(async (tx) => {
      const [it] = await tx.select().from(item).where(eq(item.id, itemId)).for('update').limit(1);
      if (!it || it.ownerId !== ownerId) throw AppError.forbidden('Not your item');
      if (it.lifecycleState !== 'stored') throw new AppError(ErrorCode.CONFLICT, 'Item must be stored', 409);
      if (it.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Item is on hold', 409);

      const problems = checkEligibility(channel, {
        conditionGrade: it.conditionGrade,
        askingMinor,
        eventId,
      });
      if (problems.length > 0) {
        throw AppError.validation(problems[0]!.message, { problems });
      }

      let event: typeof consignmentEvent.$inferSelect | undefined;
      if (channel.requiresEvent && eventId) {
        [event] = await tx
          .select()
          .from(consignmentEvent)
          .where(eq(consignmentEvent.id, eventId))
          .limit(1);
        if (!event || !event.active) throw AppError.validation('That show is not accepting consignments');
        if (event.requestDeadline.getTime() < Date.now()) {
          throw new AppError(ErrorCode.CONFLICT, `The deadline for ${event.name} has passed`, 409);
        }
        if (event.capacity > 0) {
          // Count what is already committed to this show. Cancelled requests do
          // not occupy a slot; completed ones did travel and still do.
          const [taken] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(serviceRequest)
            .where(
              and(
                eq(serviceRequest.type, 'consignment'),
                inArray(serviceRequest.status, ['requested', 'in_progress', 'completed']),
                sql`${serviceRequest.typeFields} ->> 'eventId' = ${eventId}`,
              ),
            );
          if ((taken?.count ?? 0) >= event.capacity) {
            throw new AppError(ErrorCode.CONFLICT, `${event.name} is full`, 409);
          }
        }
      }

      return this.requests.create(tx, {
        type: 'consignment',
        requesterId: ownerId,
        itemId,
        typeFields: {
          channel: channel.key,
          askingMinor,
          eventId: event?.id ?? null,
          eventName: event?.name ?? null,
          // Snapshotted so the expectation the seller was given survives a later
          // change to the channel catalogue.
          payoutDaysMin: channel.payoutDaysMin,
          payoutDaysMax: channel.payoutDaysMax,
        },
      });
    });
  }

  /** Shows still open for consignment, soonest deadline first. */
  listEvents() {
    return this.db
      .select()
      .from(consignmentEvent)
      .where(and(eq(consignmentEvent.active, true), sql`${consignmentEvent.requestDeadline} > now()`))
      .orderBy(sql`${consignmentEvent.requestDeadline} asc`);
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

      /**
       * Bault's cut depends on the channel — that is most of what choosing one
       * means. The rule is looked up by the channel's own action type and falls
       * back to the flat marketplace fee when no channel-specific rule has been
       * configured, so a new channel is never silently free.
       */
      const channelKey = String((req.typeFields as Record<string, unknown>)?.channel ?? '');
      const base = money(saleAmountMinor, currency);
      const priced =
        (channelKey ? await this.pricing.tryPrice(channelFeeAction(channelKey), { base }, tx) : null) ??
        (await this.pricing.price('marketplace_fee', { base }, tx));
      const { amount: fee, snapshot } = priced;

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
