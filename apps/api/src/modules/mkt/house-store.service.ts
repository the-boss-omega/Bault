import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { IdempotencyService } from '../../shared/idempotency/idempotency.service';
import { CustodyService } from '../cst/custody.service';
import { StowService } from '../cst/stow.service';
import { bin, item, itemImage } from '../cst/cst.schema';
import { userAccount } from '../acc/acc.schema';
import { LedgerService, DEFAULT_CURRENCY } from '../pay/ledger.service';
import { OutboxService } from '../not/outbox/outbox.service';
import { isKnownItemClass, itemClass } from '../inv/item-classes';
import { makeItemBarcode, makeItemSerial } from '../inv/labels';
import { transaction } from './mkt.schema';
import { houseListing, houseOrder } from './house.schema';

/** The account the store's takings are credited to — the same custodian that owns buyouts and donations. */
const PLATFORM_EMAIL = 'platform@bault.dev';

export interface HouseListingInput {
  typeClass: string;
  description: string;
  conditionGrade?: string;
  photoRef?: string;
  askingPrice: number;
  stock: number;
}

export interface HousePurchaseResult {
  orderCode: string;
  itemId: string;
  serialNumber: string;
  barcode: string;
  price: number;
  transactionId: string;
  replayed?: boolean;
}

/**
 * The Bault store: cards the business sells itself.
 *
 * The difference from an ordinary purchase is the whole design. A marketplace
 * sale moves an item that already exists from one owner to another. A store sale
 * CREATES the item — Bault's own stock was never booked in, so it has no serial,
 * no barcode and no record — and the question was when.
 *
 * Not when the warehouse gets round to it. Ownership is the thing this system is
 * the authority on, and a buyer who has paid and owns nothing on the record until
 * an operator walks to a box is a buyer whose card exists only in a queue. So the
 * item is minted in the purchase transaction, with the money: a serial, a barcode,
 * the buyer as sole owner, a custody event, lifecycle `received`, no bin. The
 * buyer sees it in their vault at once, and cannot list or ship it until it is on
 * a shelf, which is true.
 *
 * The part that cannot be transactional — finding the copy, sticking its label on
 * and shelving it — is an order in the warehouse queue, and `stow` finishes it.
 *
 * No intake fee is charged at either step. Intake is what Bault charges to take
 * custody of somebody else's card; this card was Bault's, and its price is the
 * whole of what the buyer pays for it arriving in their vault.
 */
@Injectable()
export class HouseStoreService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly stow: StowService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /* ------------------------------------------------------------------
     The shelf a collector sees
     ------------------------------------------------------------------ */

  /** What can be bought right now. A sold-out product is not a product on a shelf. */
  listForSale() {
    return this.db
      .select({
        id: houseListing.id,
        code: houseListing.code,
        typeClass: houseListing.typeClass,
        description: houseListing.description,
        conditionGrade: houseListing.conditionGrade,
        photoRef: houseListing.photoRef,
        askingPrice: houseListing.askingPrice,
        currency: houseListing.currency,
        stock: houseListing.stock,
      })
      .from(houseListing)
      .where(and(eq(houseListing.status, 'active'), gt(houseListing.stock, 0)))
      .orderBy(desc(houseListing.createdAt));
  }

  /* ------------------------------------------------------------------
     Managing the store (admin)
     ------------------------------------------------------------------ */

  /** Every product, sold out and removed included — the admin is the one who restocks. */
  listAll() {
    return this.db.select().from(houseListing).orderBy(desc(houseListing.createdAt));
  }

  async create(adminId: string, input: HouseListingInput) {
    if (!isKnownItemClass(input.typeClass)) {
      throw AppError.validation(`Unknown item class "${input.typeClass}"`);
    }
    const description = input.description.trim();
    if (!description) throw AppError.validation('Say what the card is — the description becomes the item record');

    const [created] = await this.db
      .insert(houseListing)
      .values({
        code: prefixedId(ID_PREFIX.houseListing),
        typeClass: input.typeClass,
        description,
        conditionGrade: input.conditionGrade?.trim() || null,
        photoRef: input.photoRef?.trim() || null,
        askingPrice: input.askingPrice,
        currency: DEFAULT_CURRENCY,
        stock: input.stock,
        createdBy: adminId,
      })
      .returning();
    return created!;
  }

  /** Reprice, restock, or take off sale. What was already sold is untouched either way. */
  async update(id: string, patch: { askingPrice?: number; stock?: number; status?: 'active' | 'removed' }) {
    const [updated] = await this.db
      .update(houseListing)
      .set({
        ...(patch.askingPrice !== undefined ? { askingPrice: patch.askingPrice } : {}),
        ...(patch.stock !== undefined ? { stock: patch.stock } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(houseListing.id, id))
      .returning();
    if (!updated) throw AppError.notFound('Store listing not found');
    return updated;
  }

  /* ------------------------------------------------------------------
     Buying one
     ------------------------------------------------------------------ */

  async purchase(buyerId: string, listingId: string, idempotencyKey?: string): Promise<HousePurchaseResult> {
    /**
     * A generated key when the client sent none, NOT one derived from the buyer
     * and the listing. The marketplace can derive one because a listing is a
     * single item and can only ever be bought once; a store product has copies,
     * and a key built from (buyer, product) would answer a collector's second
     * copy with the receipt for their first.
     */
    const key = idempotencyKey?.trim() || randomUUID();
    const endpoint = `house-purchase:${listingId}`;
    const replay = await this.idempotency.lookup(key, endpoint);
    if (replay) return { ...(replay.body as HousePurchaseResult), replayed: true };

    const result = await this.db.transaction(async (tx) => {
      // The lock is what makes the last copy sell once: a second buyer blocks
      // here, then reads a stock of zero.
      const [product] = await tx
        .select()
        .from(houseListing)
        .where(eq(houseListing.id, listingId))
        .for('update')
        .limit(1);
      if (!product) throw AppError.notFound('Store listing not found');
      if (product.status !== 'active' || product.stock <= 0) {
        throw new AppError(ErrorCode.ITEM_NO_LONGER_AVAILABLE, 'That card has sold out', 409);
      }

      const platformId = await this.platformAccountId(tx);
      if (platformId === buyerId) {
        throw new AppError(ErrorCode.SELF_DEALING_FORBIDDEN, 'The store cannot buy from itself', 403);
      }

      const price = product.askingPrice;
      const currency = product.currency;
      const balance = await this.ledger.balanceOf(buyerId, tx);
      if (balance.amount < price) {
        throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, 'Insufficient wallet balance', 409);
      }

      // The item first, so the ledger rows can name the transaction that made it.
      const serialNumber = makeItemSerial();
      const created = await this.custody.createWithIntake(tx, {
        ownerId: buyerId,
        serialNumber,
        barcode: makeItemBarcode(serialNumber),
        typeClass: product.typeClass,
        description: product.description,
        conditionGrade: product.conditionGrade ?? undefined,
        oversized: itemClass(product.typeClass)?.oversized ?? false,
        actorId: buyerId,
        // On the record, not on a shelf. `stow` moves it on.
        lifecycleState: 'received',
      });

      const [txn] = await tx
        .insert(transaction)
        .values({
          code: prefixedId(ID_PREFIX.transaction),
          type: 'sale',
          itemIds: [created.id],
          buyerId,
          sellerId: platformId,
          price,
          fee: 0,
          // What was on the shelf at the moment it was bought, so a later
          // reprice cannot rewrite what this buyer was charged for.
          frozenPricing: {
            source: 'house_store',
            houseListingId: product.id,
            houseListingCode: product.code,
            askingPrice: price,
          },
          currency,
        })
        .returning({ id: transaction.id });
      if (!txn) throw AppError.validation('Failed to record the sale');

      await this.ledger.record(
        { userId: buyerId, type: 'purchase', amount: price, direction: 'debit', currency, referenceType: 'transaction', referenceId: txn.id },
        tx,
      );
      await this.ledger.record(
        { userId: platformId, type: 'sale_credit', amount: price, direction: 'credit', currency, referenceType: 'transaction', referenceId: txn.id },
        tx,
      );

      await tx
        .update(houseListing)
        .set({ stock: product.stock - 1, updatedAt: new Date() })
        .where(eq(houseListing.id, product.id));

      const orderCode = prefixedId(ID_PREFIX.houseOrder);
      await tx.insert(houseOrder).values({
        code: orderCode,
        houseListingId: product.id,
        buyerId,
        itemId: created.id,
        transactionId: txn.id,
        price,
        currency,
      });

      return {
        orderCode,
        itemId: created.id,
        serialNumber: created.serialNumber,
        barcode: created.barcode,
        price,
        transactionId: txn.id,
      };
    });

    await this.idempotency.save(key, endpoint, buyerId, 201, result);
    return result;
  }

  /* ------------------------------------------------------------------
     The warehouse half
     ------------------------------------------------------------------ */

  /** Sold copies still in the store's box, oldest first — the order they were paid for. */
  queue() {
    return this.db
      .select({
        id: houseOrder.id,
        code: houseOrder.code,
        createdAt: houseOrder.createdAt,
        itemId: item.id,
        serialNumber: item.serialNumber,
        barcode: item.barcode,
        typeClass: item.typeClass,
        description: item.description,
        conditionGrade: item.conditionGrade,
        oversized: item.oversized,
        photoRef: houseListing.photoRef,
        listingCode: houseListing.code,
        buyerUsername: userAccount.username,
      })
      .from(houseOrder)
      .innerJoin(item, eq(item.id, houseOrder.itemId))
      .innerJoin(houseListing, eq(houseListing.id, houseOrder.houseListingId))
      .leftJoin(userAccount, eq(userAccount.id, houseOrder.buyerId))
      .where(eq(houseOrder.status, 'awaiting_stow'))
      .orderBy(asc(houseOrder.createdAt));
  }

  /**
   * The label is on the copy; put it on a shelf.
   *
   * The shelf rules are intake's: a named bin must be in service, and without one
   * the directed stow picks the emptiest shelf of the right kind. A photograph of
   * THIS copy may be attached here — the store listing only ever had a picture of
   * the print.
   */
  async stowOrder(
    operatorId: string,
    orderId: string,
    input: { binId?: string; autoStow?: boolean; photoKeys?: string[] },
  ) {
    return this.db.transaction(async (tx) => {
      const [order] = await tx.select().from(houseOrder).where(eq(houseOrder.id, orderId)).for('update').limit(1);
      if (!order) throw AppError.notFound('Store order not found');
      if (order.status !== 'awaiting_stow') {
        throw new AppError(ErrorCode.CONFLICT, 'That card is already on a shelf', 409);
      }

      const [it] = await tx.select().from(item).where(eq(item.id, order.itemId)).limit(1);
      if (!it) throw AppError.notFound('Item not found');

      const binId = await this.resolveShelf(input, it.oversized);
      await this.custody.relocate(tx, it.id, binId, operatorId);
      await this.custody.changeState(tx, it.id, 'stored', operatorId, 'store sale shelved');

      const photoKeys = (input.photoKeys ?? []).map((k) => k.trim()).filter(Boolean);
      if (photoKeys.length > 0) {
        await tx.insert(itemImage).values(
          photoKeys.map((objectKey, index) => ({ itemId: it.id, type: 'intake' as const, version: index + 1, objectKey })),
        );
      }

      await tx
        .update(houseOrder)
        .set({ status: 'stowed', stowedBy: operatorId, stowedAt: new Date() })
        .where(eq(houseOrder.id, order.id));

      // The same event intake emits, so the buyer hears "it is in your vault" in
      // the words every other arrival uses.
      await this.outbox.emit(tx, {
        aggregateType: 'item',
        aggregateId: it.id,
        eventType: 'item_received',
        payload: { itemId: it.id, ownerId: it.ownerId, barcode: it.barcode },
      });

      const [shelf] = await tx.select({ barcode: bin.barcode }).from(bin).where(eq(bin.id, binId)).limit(1);
      return {
        orderCode: order.code,
        itemId: it.id,
        serialNumber: it.serialNumber,
        barcode: it.barcode,
        description: it.description,
        binBarcode: shelf?.barcode ?? null,
      };
    });
  }

  private async resolveShelf(input: { binId?: string; autoStow?: boolean }, oversized: boolean): Promise<string> {
    const named = input.binId?.trim();
    if (named) {
      const target = await this.stow.resolveBin(named);
      if (!target.active) {
        throw AppError.validation(`Bin ${target.barcode} is out of service — stow this somewhere else`);
      }
      return target.id;
    }
    if (input.autoStow) return (await this.stow.suggest({ oversized })).id;
    throw AppError.validation('Scan a shelf, or ask for one');
  }

  private async platformAccountId(tx: Database): Promise<string> {
    const [p] = await tx
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(eq(userAccount.email, PLATFORM_EMAIL))
      .limit(1);
    if (!p) throw AppError.validation('Platform custodian account not seeded');
    return p.id;
  }
}
