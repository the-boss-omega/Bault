import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { BILLING_PORT, type BillingPort } from '../../shared/billing/billing.port';
import { CustodyService } from '../cst/custody.service';
import { bin, item } from '../cst/cst.schema';
import { parcel } from './parcel.schema';
import { OutboxService } from '../not/outbox/outbox.service';
import { userAccount } from '../acc/acc.schema';
import { normalizeUsername } from '../../shared/names';
import { makeItemBarcode, makeItemSerial, makeLotSerial } from './labels';
import { isKnownItemClass, itemClass, qualifiesAsLot } from './item-classes';

export interface IntakeItemInput {
  /**
   * The owner's PERMANENT USERNAME — the customer-facing identifier a package,
   * a label and an operator all name an account by.
   */
  ownerUsername?: string;
  /**
   * LEGACY. Packages and labels printed before the identity pass carry an OW-
   * intake ID instead. Still accepted so those arrivals can be received, never
   * offered as a choice in any UI. See `resolveOwner`.
   */
  ownerIntakeId?: string;
  typeClass: string;
  description?: string;
  conditionGrade?: string;
  binId: string; // mandatory — every item must have a bin (Requirement 10.3)
  /**
   * What it weighs, in grams, if the operator put it on the scale.
   *
   * Optional and left null when it is absent. It is what makes a shipping quote
   * depend on the parcel rather than on a hard-coded 500 g per item, and a
   * guessed figure here would be worse than none — the class's typical weight is
   * at least honestly labelled as an estimate.
   */
  weightGrams?: number;
  serialNumber?: string;
  barcode?: string;
  /** Bulk intake: create N identical item records in one action (Requirement 10.1). */
  quantity?: number;
  /** Lot support (Requirement 10.5): store the whole lot as a single item. */
  isLot?: boolean;
  lotSize?: number;
  /**
   * The inbound parcel this came out of, when it came out of one.
   *
   * Optional: an operator can still receive something by hand with no parcel
   * behind it, and every item booked in before parcels existed has none. Where
   * it is set, it is what links a collector's purchase to the cards it produced.
   */
  parcelId?: string;
}

/**
 * Intake service (T045, Principles I/III/VI).
 *
 * Receives a package routed by the owner's USERNAME and, in ONE transaction per
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

  /**
   * Resolve the owner an arrival belongs to.
   *
   * The username is the identifier the workflow uses: it is permanent, unique,
   * normalized, and the only one a customer is ever asked to quote. It is
   * normalized before lookup so an operator typing "Red" finds `red`.
   *
   * The OW- intake ID remains accepted as a FALLBACK because packages and shelf
   * labels printed before the identity pass still carry one and those parcels
   * must still be receivable. It is never presented as an option, never
   * allocated to a new account, and is tried only when no username was given.
   */
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

  private async assertBinExists(binId: string): Promise<void> {
    const [row] = await this.db.select({ id: bin.id }).from(bin).where(eq(bin.id, binId)).limit(1);
    if (!row) throw AppError.validation(`Bin ${binId} does not exist`);
  }

  /**
   * A parcel may only receive items into the account it belongs to, and only
   * while it is open.
   *
   * `processed` is refused as firmly as the others: that status means the fee has
   * been charged and the parcel closed out, so adding to it afterwards would
   * quietly extend a finished record.
   */
  private async assertParcelOpenFor(parcelId: string, ownerId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: parcel.id, ownerId: parcel.ownerId, status: parcel.status })
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
  }

  /**
   * Intake one item (or a lot treated as one item). When `quantity` > 1 this is
   * called N times so a single submit yields N full item records.
   */
  async intakeItem(actorId: string, input: IntakeItemInput) {
    if (!input.binId) throw AppError.validation('A bin is required for every item');
    await this.assertBinExists(input.binId);

    // The class is vocabulary now, not free text: per-class pricing, the lot rule
    // and the oversized flag all key off it, and none of them can act on a value
    // nobody defined.
    if (!isKnownItemClass(input.typeClass)) {
      throw AppError.validation(`Unknown item class "${input.typeClass}"`);
    }
    const cls = itemClass(input.typeClass)!;

    const ownerId = await this.resolveOwner(input);

    // A parcel, when given, has to be this owner's and has to be open. Booking
    // items out of somebody else's box, or out of one nobody has opened yet,
    // would make the parcel's contents record a fiction.
    if (input.parcelId) await this.assertParcelOpenFor(input.parcelId, ownerId);

    let quantity = Math.max(1, Math.min(100, Math.trunc(input.quantity ?? 1)));
    let lot = input.isLot === true;
    const lotSize = Math.max(1, Math.trunc(input.lotSize ?? 1));

    if (lot) {
      if (!cls.lotEligible) {
        throw AppError.validation(`${cls.label} cannot be received as a lot`);
      }
      /**
       * The five-or-fewer rule, which applies only to classes that carry a
       * threshold — cards. A "lot" below it is not refused and the operator is
       * not sent back to change a checkbox; it is simply received as what it
       * actually is: that many individual items, each with its own serial,
       * barcode and intake charge.
       *
       * Converting rather than rejecting is the honest reading of the policy.
       * "Five or fewer are ALWAYS processed as individuals" is a statement about
       * what happens, not an option the operator gets to weigh, and the
       * collector is the one who benefits: they cannot sell, grade or ship a
       * single card out of a lot that was never broken.
       */
      if (!qualifiesAsLot(cls, lotSize)) {
        lot = false;
        quantity = lotSize;
      }
    }

    const effective: IntakeItemInput = {
      ...input,
      isLot: lot,
      lotSize: lot ? lotSize : undefined,
      // A converted lot mints one serial per piece, so an explicitly-supplied
      // serial cannot apply to all of them.
      quantity: quantity === 1 ? input.quantity : quantity,
    };

    const created = [];
    for (let i = 0; i < quantity; i += 1) {
      created.push(await this.createOne(actorId, ownerId, effective, cls.oversized));
    }
    // A bulk submit returns the whole batch; a single intake returns the one item.
    return quantity === 1 ? created[0] : created;
  }

  private createOne(actorId: string, ownerId: string, input: IntakeItemInput, oversized = false) {
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
        sourceParcelId: input.parcelId,
        // The storage terms are settled here, at receipt, from the class the
        // operator booked it under — never re-derived afterwards.
        oversized,
        weightGrams: input.weightGrams,
        isLot: input.isLot,
        lotSize: input.isLot ? Math.max(1, Math.trunc(input.lotSize ?? 1)) : 1,
        actorId,
      });

      // The class travels with the charge so a class-specific intake rule can
      // resolve. Without it every intake billed at the catch-all rate no matter
      // what arrived, which made per-class pricing unreachable in practice.
      await this.billing.charge(tx, {
        userId: ownerId,
        actionType: 'intake',
        itemId: createdItem.id,
        itemClass: input.typeClass,
      });
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
            sourceParcelId: lot.sourceParcelId ?? undefined,
            // Children inherit the lot's storage terms: they are the same
            // physical goods, on the same shelf, received on the same day.
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
          return child;
        }),
      );
    }
    // Mark the lot broken (it stays in the ledger as the origin of the children).
    await this.db.update(item).set({ lotBroken: true, updatedAt: new Date() }).where(eq(item.id, lotItemId));
    return { lotItemId, producedCount: produced.length, items: produced };
  }
}
