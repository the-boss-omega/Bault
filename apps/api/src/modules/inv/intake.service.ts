import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { BILLING_PORT, type BillingPort } from '../../shared/billing/billing.port';
import { CustodyService } from '../cst/custody.service';
import { bin, item } from '../cst/cst.schema';
import { OutboxService } from '../not/outbox/outbox.service';
import { userAccount } from '../acc/acc.schema';
import { makeItemBarcode, makeItemSerial, makeLotSerial } from './labels';

export interface IntakeItemInput {
  ownerIntakeId: string;
  typeClass: string;
  description?: string;
  conditionGrade?: string;
  binId: string; // mandatory — every item must have a bin (Requirement 10.3)
  serialNumber?: string;
  barcode?: string;
  /** Bulk intake: create N identical item records in one action (Requirement 10.1). */
  quantity?: number;
  /** Lot support (Requirement 10.5): store the whole lot as a single item. */
  isLot?: boolean;
  lotSize?: number;
}

/**
 * Intake service (T045, Principles I/III/VI).
 *
 * Receives a package routed by the owner's intake ID and, in ONE transaction per
 * item: creates the item (assigned to the single owner + a MANDATORY bin) with its
 * first custody event + transfer-ledger row, auto-creates the intake Charge, and
 * emits an `item_received` outbox event. Bulk intake performs all N in one action.
 */
@Injectable()
export class IntakeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly outbox: OutboxService,
    @Inject(BILLING_PORT) private readonly billing: BillingPort,
  ) {}

  private async resolveOwner(intakeId: string): Promise<string> {
    const [owner] = await this.db
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(eq(userAccount.intakeId, intakeId))
      .limit(1);
    if (!owner) throw AppError.notFound(`No account for intake ID ${intakeId}`);
    return owner.id;
  }

  private async assertBinExists(binId: string): Promise<void> {
    const [row] = await this.db.select({ id: bin.id }).from(bin).where(eq(bin.id, binId)).limit(1);
    if (!row) throw AppError.validation(`Bin ${binId} does not exist`);
  }

  /**
   * Intake one item (or a lot treated as one item). When `quantity` > 1 this is
   * called N times so a single submit yields N full item records.
   */
  async intakeItem(actorId: string, input: IntakeItemInput) {
    if (!input.binId) throw AppError.validation('A bin is required for every item');
    await this.assertBinExists(input.binId);
    const ownerId = await this.resolveOwner(input.ownerIntakeId);

    const quantity = Math.max(1, Math.min(100, Math.trunc(input.quantity ?? 1)));
    const created = [];
    for (let i = 0; i < quantity; i += 1) {
      created.push(await this.createOne(actorId, ownerId, input));
    }
    // A bulk submit returns the whole batch; a single intake returns the one item.
    return quantity === 1 ? created[0] : created;
  }

  private createOne(actorId: string, ownerId: string, input: IntakeItemInput) {
    // Serial/barcode are always freshly generated per copy so each of N items is
    // individually tracked and uniquely scannable. A lot gets the LOT- prefix.
    const mint = input.isLot ? makeLotSerial : makeItemSerial;
    const serialNumber = input.serialNumber && input.quantity === undefined
      ? input.serialNumber
      : mint();
    const barcode = input.barcode && input.quantity === undefined
      ? input.barcode
      : makeItemBarcode(serialNumber);

    return this.custody.run(async (tx) => {
      const createdItem = await this.custody.createWithIntake(tx, {
        ownerId,
        serialNumber,
        barcode,
        typeClass: input.typeClass,
        description: input.description,
        conditionGrade: input.conditionGrade,
        binId: input.binId,
        isLot: input.isLot,
        lotSize: input.isLot ? Math.max(1, Math.trunc(input.lotSize ?? 1)) : 1,
        actorId,
      });

      await this.billing.charge(tx, { userId: ownerId, actionType: 'intake', itemId: createdItem.id });
      await this.outbox.emit(tx, {
        aggregateType: 'item',
        aggregateId: createdItem.id,
        eventType: 'item_received',
        payload: { itemId: createdItem.id, ownerId, barcode: createdItem.barcode },
      });
      return createdItem;
    });
  }

  /** Lots still stored as a single item, i.e. the ones "Break Lot" can act on. */
  listOpenLots() {
    return this.db
      .select({
        id: item.id,
        serialNumber: item.serialNumber,
        barcode: item.barcode,
        typeClass: item.typeClass,
        description: item.description,
        lotSize: item.lotSize,
        binId: item.binId,
      })
      .from(item)
      .where(and(eq(item.isLot, true), eq(item.lotBroken, false)))
      .orderBy(sql`${item.createdAt} desc`);
  }

  /**
   * Break Lot (Requirement 10.5): intake each contained item of a lot individually.
   * Every contained item becomes a standalone item; the lot is marked broken so it
   * is never double-counted.
   */
  async breakLot(actorId: string, lotItemId: string) {
    const [lot] = await this.db.select().from(item).where(eq(item.id, lotItemId)).limit(1);
    if (!lot) throw AppError.notFound('Lot item not found');
    if (!lot.isLot) throw AppError.validation('Item is not a lot');
    if (lot.lotBroken) throw AppError.validation('Lot has already been broken');
    // Every item must have a bin (Requirement 10.3), so the children inherit the
    // lot's shelf. A lot with no bin cannot be broken until it is shelved.
    // Bound to a local so the narrowing survives into the per-child closure below.
    const lotBinId = lot.binId;
    if (!lotBinId) throw AppError.validation('Shelve the lot before breaking it — every item needs a bin');

    const count = Math.max(1, lot.lotSize ?? 1);
    const produced = [];
    for (let i = 0; i < count; i += 1) {
      const serialNumber = makeItemSerial();
      produced.push(
        await this.custody.run(async (tx) => {
          const child = await this.custody.createWithIntake(tx, {
            ownerId: lot.ownerId,
            serialNumber,
            barcode: makeItemBarcode(serialNumber),
            typeClass: lot.typeClass,
            description: lot.description,
            conditionGrade: lot.conditionGrade ?? undefined,
            binId: lotBinId,
            isLot: false,
            lotSize: 1,
            actorId,
          });
          await this.billing.charge(tx, { userId: lot.ownerId, actionType: 'intake', itemId: child.id });
          return child;
        }),
      );
    }
    // Mark the lot broken (it stays in the ledger as the origin of the children).
    await this.db.update(item).set({ lotBroken: true, updatedAt: new Date() }).where(eq(item.id, lotItemId));
    return { lotItemId, producedCount: produced.length, items: produced };
  }
}
