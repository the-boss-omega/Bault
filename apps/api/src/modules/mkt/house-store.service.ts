import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
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
import { MediaService } from '../med/media.service';
import { isKnownItemClass, itemClass } from '../inv/item-classes';
import { makeItemBarcode, makeItemSerial } from '../inv/labels';
import { transaction } from './mkt.schema';
import { houseListing, houseOrder } from './house.schema';

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

@Injectable()
export class HouseStoreService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly stow: StowService,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly idempotency: IdempotencyService,
    private readonly media: MediaService,
  ) {}

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

  async update(
    id: string,
    patch: { askingPrice?: number; stock?: number; expectedStock?: number; status?: 'active' | 'removed' },
  ) {
    if (patch.stock !== undefined && patch.expectedStock === undefined) {
      throw AppError.validation('Say which stock figure this replaces (expectedStock), so a copy sold meanwhile is not put back on sale.');
    }
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(houseListing).where(eq(houseListing.id, id)).for('update').limit(1);
      if (!current) throw AppError.notFound('Store listing not found');
      if (patch.stock !== undefined && current.stock !== patch.expectedStock) {
        throw new AppError(
          ErrorCode.CONFLICT,
          `The stock has changed since you read it: ${current.stock} left now. Check the figure and save again.`,
          409,
          { stock: current.stock },
        );
      }
      const [updated] = await tx
        .update(houseListing)
        .set({
          ...(patch.askingPrice !== undefined ? { askingPrice: patch.askingPrice } : {}),
          ...(patch.stock !== undefined ? { stock: patch.stock } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(houseListing.id, id))
        .returning();
      return updated!;
    });
  }

  async purchase(buyerId: string, listingId: string, idempotencyKey?: string): Promise<HousePurchaseResult> {
    const key = idempotencyKey?.trim() || randomUUID();
    const endpoint = `house-purchase:${listingId}`;

    return this.db.transaction(async (tx): Promise<HousePurchaseResult> => {
      const { replay } = await this.idempotency.claim(tx as Database, key, endpoint, buyerId);
      if (replay) return { ...(replay.body as HousePurchaseResult), replayed: true };

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
        .set({ stock: sql`${houseListing.stock} - 1`, updatedAt: new Date() })
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

      const result: HousePurchaseResult = {
        orderCode,
        itemId: created.id,
        serialNumber: created.serialNumber,
        barcode: created.barcode,
        price,
        transactionId: txn.id,
      };
      await this.idempotency.complete(tx as Database, key, endpoint, 201, result);
      return result;
    });
  }

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
        await this.media.assertAttachable(tx, photoKeys, { purpose: 'item_intake', actorId: operatorId });
        await tx.insert(itemImage).values(
          photoKeys.map((objectKey, index) => ({ itemId: it.id, type: 'intake' as const, version: index + 1, objectKey })),
        );
      }

      await tx
        .update(houseOrder)
        .set({ status: 'stowed', stowedBy: operatorId, stowedAt: new Date() })
        .where(eq(houseOrder.id, order.id));

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
