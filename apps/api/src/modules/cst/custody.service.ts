import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { OutboxService } from '../not/outbox/outbox.service';
import { binTransfer, custodyEvent, item } from './cst.schema';
import { assertTransition, type LifecycleState } from './lifecycle';

type Tx = Database;

/**
 * CST custody service (T043, Principles I–III) — THE correctness kernel.
 *
 * Every mutation of an item's owner, bin, or lifecycle state goes through this
 * service, and each one writes a custody_event in the SAME transaction as the
 * change. No other code is allowed to UPDATE those item columns directly. Because
 * custody_event is append-only (DB triggers), the chain of custody can never be
 * forged or gapped.
 *
 * All methods take a transaction handle `tx` so the caller composes them with
 * other work (charge, outbox event, ...) into one atomic commit.
 */
@Injectable()
export class CustodyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  /** Load an item FOR UPDATE inside a transaction (serializes concurrent changes). */
  private async lockItem(tx: Tx, itemId: string) {
    const [row] = await tx
      .select()
      .from(item)
      .where(eq(item.id, itemId))
      .for('update')
      .limit(1);
    if (!row) throw AppError.notFound('Item not found');
    return row;
  }

  /** Create a brand-new item and its first custody event (intake). */
  async createWithIntake(
    tx: Tx,
    input: {
      ownerId: string;
      serialNumber: string;
      barcode: string;
      typeClass: string;
      description?: string;
      conditionGrade?: string;
      binId?: string;
      sourceBatchId?: string;
      /** The inbound parcel this item was unpacked from, when there was one. */
      sourceParcelId?: string;
      /** Fixes the storage terms at receipt — see `item.oversized`. */
      oversized?: boolean;
      /** What it weighed on the bench, if anybody put it on one. */
      weightGrams?: number;
      isLot?: boolean;
      lotSize?: number;
      actorId: string;
      /** 'intake' for a normal arrival, 'batch_split' when produced by splitting a batch. */
      eventType?: 'intake' | 'batch_split';
    },
  ) {
    const [created] = await tx
      .insert(item)
      .values({
        ownerId: input.ownerId,
        serialNumber: input.serialNumber,
        barcode: input.barcode,
        typeClass: input.typeClass,
        description: input.description ?? '',
        conditionGrade: input.conditionGrade,
        binId: input.binId,
        sourceBatchId: input.sourceBatchId,
        sourceParcelId: input.sourceParcelId,
        oversized: input.oversized ?? false,
        // Null rather than a guess: this column means "somebody measured it",
        // and the class's typical weight stands in everywhere it is absent.
        weightGrams: input.weightGrams && input.weightGrams > 0 ? input.weightGrams : null,
        isLot: input.isLot ?? false,
        lotSize: input.lotSize ?? 1,
        lifecycleState: 'stored', // received → stored on documentation
        receivedAt: new Date(),
      })
      .returning();
    if (!created) throw AppError.validation('Failed to create item');

    await tx.insert(custodyEvent).values({
      itemId: created.id,
      eventType: input.eventType ?? 'intake',
      newOwnerId: input.ownerId,
      newBinId: input.binId,
      newState: 'stored',
      actorId: input.actorId,
      reason: input.eventType ?? 'intake',
    });
    // Record the first shelving in the dedicated transfer ledger (Requirement 10.4).
    if (input.binId) {
      await tx.insert(binTransfer).values({
        itemId: created.id,
        fromBinId: null,
        toBinId: input.binId,
        actorId: input.actorId,
        reason: input.eventType ?? 'intake',
      });
    }
    return created;
  }

  /** Move an item to a new bin; logs a relocate custody event AND a transfer-ledger row. */
  async relocate(tx: Tx, itemId: string, newBinId: string, actorId: string) {
    const current = await this.lockItem(tx, itemId);
    if (current.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Item is on hold', 409);

    await tx.update(item).set({ binId: newBinId, updatedAt: new Date() }).where(eq(item.id, itemId));
    await tx.insert(custodyEvent).values({
      itemId,
      eventType: 'relocate',
      prevBinId: current.binId,
      newBinId,
      actorId,
      reason: 'scan relocate',
    });
    // Dedicated transfer ledger records BOTH source and destination bin (Req 10.4).
    await tx.insert(binTransfer).values({
      itemId,
      fromBinId: current.binId,
      toBinId: newBinId,
      actorId,
      reason: 'scan relocate',
    });
  }

  /** Transfer ownership (sale/swap/transfer/gift); logs an ownership_transfer event. */
  async transferOwnership(tx: Tx, itemId: string, newOwnerId: string, actorId: string, reason: string) {
    const current = await this.lockItem(tx, itemId);
    await tx.update(item).set({ ownerId: newOwnerId, updatedAt: new Date() }).where(eq(item.id, itemId));
    await tx.insert(custodyEvent).values({
      itemId,
      eventType: 'ownership_transfer',
      prevOwnerId: current.ownerId,
      newOwnerId,
      actorId,
      reason,
    });
  }

  /** Change lifecycle state through a validated transition; logs a state_change event. */
  async changeState(tx: Tx, itemId: string, newState: LifecycleState, actorId: string, reason: string) {
    const current = await this.lockItem(tx, itemId);
    assertTransition(current.lifecycleState as LifecycleState, newState);
    await tx.update(item).set({ lifecycleState: newState, updatedAt: new Date() }).where(eq(item.id, itemId));
    await tx.insert(custodyEvent).values({
      itemId,
      eventType: 'state_change',
      prevState: current.lifecycleState,
      newState,
      actorId,
      reason,
    });
  }

  /**
   * Returns whether anything actually changed.
   *
   * It used to return nothing, and the controller answered `hold_placed` either
   * way — so an operator who scanned a card that was already frozen was told the
   * hold had just been placed, and one who released a card that was never on
   * hold was told a hold had been lifted. The DATA was always right (the early
   * return means no second custody event is written), but the bench was told a
   * story about work it had not done, on the one screen whose whole job is
   * saying what happened to a card.
   */
  async setHold(tx: Tx, itemId: string, hold: boolean, actorId: string): Promise<boolean> {
    const current = await this.lockItem(tx, itemId);
    if (current.holdFlag === hold) return false;
    await tx.update(item).set({ holdFlag: hold, updatedAt: new Date() }).where(eq(item.id, itemId));
    await tx.insert(custodyEvent).values({
      itemId,
      eventType: hold ? 'hold_placed' : 'hold_released',
      actorId,
      reason: hold ? 'hold placed' : 'hold released',
    });
    // Placing a hold notifies the owner: emit the domain event in the SAME tx
    // (transactional outbox, Principle XI); the worker turns it into a notification.
    if (hold) {
      await this.outbox.emit(tx, {
        aggregateType: 'item',
        aggregateId: itemId,
        eventType: 'hold_placed',
        payload: { itemId, barcode: current.barcode, ownerId: current.ownerId },
      });
    }
    return true;
  }

  /** Convenience wrapper: run a unit of work in a transaction. */
  run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}
