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

export interface TransferExpectation {
  ownerId: string;
  fromStates?: readonly LifecycleState[];
  allowHold?: boolean;
}

@Injectable()
export class CustodyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

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

  async lockItems(tx: Tx, itemIds: readonly string[]) {
    const rows = [];
    for (const id of [...new Set(itemIds)].sort()) rows.push(await this.lockItem(tx, id));
    return rows;
  }

  async lockExpecting(tx: Tx, itemId: string, expect: TransferExpectation) {
    const current = await this.lockItem(tx, itemId);
    CustodyService.assertExpected(current, expect);
    return current;
  }

  private static assertExpected(
    current: { id: string; ownerId: string; holdFlag: boolean; lifecycleState: string; isLot: boolean; lotBroken: boolean },
    expect: TransferExpectation,
  ) {
    const itemId = current.id;
    if (current.ownerId !== expect.ownerId) {
      throw new AppError(
        ErrorCode.ITEM_NO_LONGER_AVAILABLE,
        'This card has changed hands since this was arranged.',
        409,
        { itemId },
      );
    }
    if (current.holdFlag && !expect.allowHold) {
      throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Item is on hold', 409, { itemId });
    }
    const fromStates = expect.fromStates ?? ['stored'];
    if (!fromStates.includes(current.lifecycleState as LifecycleState)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `This card is ${current.lifecycleState}, so this cannot go ahead now.`,
        409,
        { itemId, state: current.lifecycleState },
      );
    }
    CustodyService.assertNotSplitLot(current);
  }

  private static assertNotSplitLot(current: { id: string; isLot: boolean; lotBroken: boolean }) {
    if (current.isLot && current.lotBroken) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'This lot has been split, and its cards are separate items now.',
        409,
        { itemId: current.id },
      );
    }
  }

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
      sourceParcelId?: string;
      oversized?: boolean;
      weightGrams?: number;
      isLot?: boolean;
      lotSize?: number;
      actorId: string;
      eventType?: 'intake' | 'batch_split';
      lifecycleState?: 'stored' | 'received';
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
        weightGrams: input.weightGrams && input.weightGrams > 0 ? input.weightGrams : null,
        isLot: input.isLot ?? false,
        lotSize: input.lotSize ?? 1,
        lifecycleState: input.lifecycleState ?? 'stored',
        receivedAt: new Date(),
      })
      .returning();
    if (!created) throw AppError.validation('Failed to create item');

    await tx.insert(custodyEvent).values({
      itemId: created.id,
      eventType: input.eventType ?? 'intake',
      newOwnerId: input.ownerId,
      newBinId: input.binId,
      newState: input.lifecycleState ?? 'stored',
      actorId: input.actorId,
      reason: input.eventType ?? 'intake',
    });
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
    await tx.insert(binTransfer).values({
      itemId,
      fromBinId: current.binId,
      toBinId: newBinId,
      actorId,
      reason: 'scan relocate',
    });
  }

  async transferOwnership(
    tx: Tx,
    itemId: string,
    newOwnerId: string,
    actorId: string,
    reason: string,
    expect: TransferExpectation,
  ) {
    const current = await this.lockExpecting(tx, itemId, expect);
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

  async changeState(tx: Tx, itemId: string, newState: LifecycleState, actorId: string, reason: string) {
    const current = await this.lockItem(tx, itemId);
    if (newState !== 'stored' && current.lifecycleState !== newState) CustodyService.assertNotSplitLot(current);
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

  run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}
