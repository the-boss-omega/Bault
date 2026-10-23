import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { BILLING_PORT, type BillingPort } from '../../shared/billing/billing.port';
import { CustodyService } from '../cst/custody.service';
import { StowService } from '../cst/stow.service';
import { bin, item, itemImage } from '../cst/cst.schema';
import { parcel } from './parcel.schema';
import { OutboxService } from '../not/outbox/outbox.service';
import { MediaService } from '../med/media.service';
import { userAccount } from '../acc/acc.schema';
import { normalizeUsername } from '../../shared/names';
import { makeItemBarcode, makeItemSerial, makeLotSerial } from './labels';
import { isKnownItemClass, itemClass, qualifiesAsLot } from './item-classes';

export interface IntakeItemInput {
  ownerUsername?: string;
  ownerIntakeId?: string;
  typeClass: string;
  description?: string;
  conditionGrade?: string;
  binId?: string;
  autoStow?: boolean;
  weightGrams?: number;
  serialNumber?: string;
  barcode?: string;
  quantity?: number;
  isLot?: boolean;
  lotSize?: number;
  parcelId?: string;
  photoKeys?: string[];
}

@Injectable()
export class IntakeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly stow: StowService,
    private readonly outbox: OutboxService,
    @Inject(BILLING_PORT) private readonly billing: BillingPort,
    private readonly media: MediaService,
  ) {}

  private async resolveOwner(input: Pick<IntakeItemInput, 'ownerUsername' | 'ownerIntakeId'>): Promise<string> {
    const username = normalizeUsername(input.ownerUsername ?? '');
    if (username) {
      const [owner] = await this.db
        .select({ id: userAccount.id })
        .from(userAccount)
        .where(eq(userAccount.username, username))
        .limit(1);
      if (!owner) throw AppError.notFound(`No account with username ${username}`);
      return owner.id;
    }

    const legacyIntakeId = input.ownerIntakeId?.trim();
    if (legacyIntakeId) {
      const [owner] = await this.db
        .select({ id: userAccount.id })
        .from(userAccount)
        .where(eq(userAccount.intakeId, legacyIntakeId))
        .limit(1);
      if (!owner) throw AppError.notFound(`No account for legacy intake ID ${legacyIntakeId}`);
      return owner.id;
    }

    throw AppError.validation('An owner username is required to receive an item.');
  }

  private async resolveStowBin(
    input: IntakeItemInput,
    oversized: boolean,
    parcelFacilityId: string | null,
  ): Promise<string> {
    const named = input.binId?.trim();
    if (named) {
      const target = await this.stow.resolveBin(named);
      if (!target.active) {
        throw AppError.validation(`Bin ${target.barcode} is out of service — stow this somewhere else`);
      }
      if (parcelFacilityId) {
        const [row] = await this.db
          .select({ facilityId: bin.facilityId })
          .from(bin)
          .where(eq(bin.id, target.id))
          .limit(1);
        if (row?.facilityId && row.facilityId !== parcelFacilityId) {
          throw AppError.validation(
            `Bin ${target.barcode} is at a different facility from the parcel — the goods are not there`,
          );
        }
      }
      return target.id;
    }

    if (input.autoStow) {
      const chosen = await this.stow.suggest({ facilityId: parcelFacilityId, oversized });
      return chosen.id;
    }

    throw AppError.validation('A bin is required for every item — scan a shelf, or ask for one');
  }

  private async assertParcelOpenFor(parcelId: string, ownerId: string) {
    const [row] = await this.db
      .select({
        id: parcel.id,
        ownerId: parcel.ownerId,
        status: parcel.status,
        facilityId: parcel.facilityId,
      })
      .from(parcel)
      .where(eq(parcel.id, parcelId))
      .limit(1);
    if (!row) throw AppError.validation(`Parcel ${parcelId} does not exist`);
    if (row.ownerId !== ownerId) {
      throw AppError.validation('That parcel belongs to a different account');
    }
    if (row.status !== 'opened') {
      throw AppError.validation(`Parcel must be open to book items out of it (it is ${row.status})`);
    }
    return row;
  }

  async intakeUnits(actorId: string, units: readonly IntakeItemInput[]) {
    for (const [index, unit] of units.entries()) {
      try {
        await this.assertReceivable(actorId, unit);
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'could not be booked in';
        throw AppError.validation(`Unit ${index + 1} of ${units.length}: ${reason}`);
      }
    }

    return this.custody.run(async (tx) => {
      const created: unknown[] = [];
      for (const [index, unit] of units.entries()) {
        try {
          const one = await this.intakeItem(actorId, unit, tx);
          created.push(...(Array.isArray(one) ? one : [one]));
        } catch (e) {
          const reason = e instanceof Error ? e.message : 'could not be booked in';
          throw AppError.validation(`Unit ${index + 1} of ${units.length}: ${reason}`);
        }
      }
      return created;
    });
  }

  private async assertReceivable(actorId: string, input: IntakeItemInput): Promise<void> {
    if (!isKnownItemClass(input.typeClass)) {
      throw AppError.validation(`Unknown item class "${input.typeClass}"`);
    }
    const cls = itemClass(input.typeClass)!;
    if (input.isLot === true && !cls.lotEligible) {
      throw AppError.validation(`${cls.label} cannot be received as a lot`);
    }
    const ownerId = await this.resolveOwner(input);
    if (input.parcelId) await this.assertParcelOpenFor(input.parcelId, ownerId);
    await this.media.assertAttachable(this.db, cleanKeys(input.photoKeys), { purpose: 'item_intake', actorId });
  }

  async intakeItem(actorId: string, input: IntakeItemInput, tx?: Database) {
    if (!isKnownItemClass(input.typeClass)) {
      throw AppError.validation(`Unknown item class "${input.typeClass}"`);
    }
    const cls = itemClass(input.typeClass)!;

    const ownerId = await this.resolveOwner(input);

    const sourceParcel = input.parcelId
      ? await this.assertParcelOpenFor(input.parcelId, ownerId)
      : null;

    const binId = await this.resolveStowBin(input, cls.oversized, sourceParcel?.facilityId ?? null);

    let quantity = Math.max(1, Math.min(100, Math.trunc(input.quantity ?? 1)));
    let lot = input.isLot === true;
    const lotSize = Math.max(1, Math.trunc(input.lotSize ?? 1));

    if (lot) {
      if (!cls.lotEligible) {
        throw AppError.validation(`${cls.label} cannot be received as a lot`);
      }
      if (!qualifiesAsLot(cls, lotSize)) {
        lot = false;
        quantity = lotSize;
      }
    }

    const effective: IntakeItemInput = {
      ...input,
      binId,
      isLot: lot,
      lotSize: lot ? lotSize : undefined,
      quantity: quantity === 1 ? input.quantity : quantity,
    };

    const writeAll = async (t: Database) => {
      await this.media.assertAttachable(t, cleanKeys(input.photoKeys), { purpose: 'item_intake', actorId });
      const created = [];
      for (let i = 0; i < quantity; i += 1) {
        created.push(await this.createOne(t, actorId, ownerId, effective, cls.oversized));
      }
      return created;
    };
    const created = tx ? await writeAll(tx) : await this.custody.run(writeAll);
    return quantity === 1 ? created[0] : created;
  }

  private async createOne(tx: Database, actorId: string, ownerId: string, input: IntakeItemInput, oversized = false) {
    const mint = input.isLot ? makeLotSerial : makeItemSerial;
    const serialNumber = input.serialNumber && input.quantity === undefined
      ? input.serialNumber
      : mint();
    const barcode = input.barcode && input.quantity === undefined
      ? input.barcode
      : makeItemBarcode(serialNumber);

    const createdItem = await this.custody.createWithIntake(tx, {
      ownerId,
      serialNumber,
      barcode,
      typeClass: input.typeClass,
      description: input.description,
      conditionGrade: input.conditionGrade,
      binId: input.binId,
      sourceParcelId: input.parcelId,
      oversized,
      weightGrams: input.weightGrams,
      isLot: input.isLot,
      lotSize: input.isLot ? Math.max(1, Math.trunc(input.lotSize ?? 1)) : 1,
      actorId,
    });

    await this.billing.charge(tx, {
      userId: ownerId,
      actionType: 'intake',
      itemId: createdItem.id,
      itemClass: input.typeClass,
      ...(input.isLot === true ? { feeActionType: 'intake_lot' } : {}),
    });
    const photoKeys = cleanKeys(input.photoKeys);
    if (photoKeys.length > 0) {
      await tx.insert(itemImage).values(
        photoKeys.map((objectKey, index) => ({
          itemId: createdItem.id,
          type: 'intake' as const,
          version: index + 1,
          objectKey,
        })),
      );
    }

    await this.outbox.emit(tx, {
      aggregateType: 'item',
      aggregateId: createdItem.id,
      eventType: 'item_received',
      payload: { itemId: createdItem.id, ownerId, barcode: createdItem.barcode },
    });
    return createdItem;
  }

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

  async breakLot(
    actorId: string,
    lotItemId: string,
    opts: { tx?: Database; ownerId?: string } = {},
  ): Promise<{ lotItemId: string; producedCount: number; items: (typeof item.$inferSelect)[] }> {
    if (!opts.tx) return this.custody.run((tx) => this.breakLot(actorId, lotItemId, { ...opts, tx }));
    const tx = opts.tx;

    const [lot] = await tx.select().from(item).where(eq(item.id, lotItemId)).for('update').limit(1);
    if (!lot) throw AppError.notFound('Lot item not found');
    if (!lot.isLot) throw AppError.validation('Item is not a lot');
    if (lot.lotBroken) throw AppError.validation('Lot has already been broken');
    if (opts.ownerId && lot.ownerId !== opts.ownerId) {
      throw new AppError(ErrorCode.ITEM_NO_LONGER_AVAILABLE, 'This lot has changed hands since the split was asked for.', 409);
    }
    if (lot.holdFlag) throw new AppError(ErrorCode.ITEM_ON_HOLD, 'Lot is on hold', 409);
    if (lot.lifecycleState !== 'stored') {
      throw new AppError(ErrorCode.CONFLICT, `The lot is ${lot.lifecycleState}, not stored, so it cannot be split now.`, 409);
    }
    const lotBinId = lot.binId;
    if (!lotBinId) throw AppError.validation('Shelve the lot before breaking it — every item needs a bin');

    const count = Math.max(1, lot.lotSize ?? 1);
    const produced = [];
    for (let i = 0; i < count; i += 1) {
      const serialNumber = makeItemSerial();
      const child = await this.custody.createWithIntake(tx, {
        ownerId: lot.ownerId,
        serialNumber,
        barcode: makeItemBarcode(serialNumber),
        typeClass: lot.typeClass,
        description: lot.description,
        conditionGrade: lot.conditionGrade ?? undefined,
        binId: lotBinId,
        sourceParcelId: lot.sourceParcelId ?? undefined,
        oversized: lot.oversized,
        isLot: false,
        lotSize: 1,
        actorId,
      });
      await this.billing.charge(tx, {
        userId: lot.ownerId,
        actionType: 'intake',
        itemId: child.id,
        itemClass: lot.typeClass,
      });
      produced.push(child);
    }
    await tx.update(item).set({ lotBroken: true, updatedAt: new Date() }).where(eq(item.id, lotItemId));
    return { lotItemId, producedCount: produced.length, items: produced };
  }
}

function cleanKeys(keys: readonly string[] | undefined): string[] {
  return (keys ?? []).map((k) => k.trim()).filter(Boolean);
}
