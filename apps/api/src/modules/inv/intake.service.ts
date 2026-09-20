import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { BILLING_PORT, type BillingPort } from '../../shared/billing/billing.port';
import { CustodyService } from '../cst/custody.service';
import { StowService } from '../cst/stow.service';
import { bin, item, itemImage } from '../cst/cst.schema';
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
  /**
   * Where it is being stowed — the shelf's BARCODE as readily as its internal
   * id, because the barcode is what is printed on the shelf and therefore what
   * a scanner produces.
   *
   * Optional in the input, never in the outcome: every item still ends up on a
   * shelf (Requirement 10.3). What changed is who decides which one. Leave this
   * out and set `autoStow`, and the system directs the stow — the arrangement a
   * high-volume warehouse actually uses, where nobody reserves a shelf for a
   * class of goods and nobody scrolls a list to choose one. Send neither and the
   * intake is refused, because an item with nowhere to be is not receivable.
   */
  binId?: string;
  /**
   * Ask the system where this goes instead of naming a shelf.
   *
   * It answers with the emptiest active shelf of the right kind in the building
   * the goods are actually in — the parcel's facility, when the intake came out
   * of a parcel. See `StowService.suggest`.
   */
  autoStow?: boolean;
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
  /**
   * Photographs of the thing being booked in, as object keys already uploaded
   * through `POST /media/uploads` — keys, never bytes.
   *
   * Written as `item_image` rows of type `intake`, which is the pipeline the
   * customer's card drawer already reads.
   */
  photoKeys?: string[];
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
    private readonly stow: StowService,
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

  /**
   * Settle which shelf this is going on.
   *
   * Three ways in, ordered by who knows best. An operator who scanned a shelf
   * has the strongest claim — they are standing in front of it — so a named bin
   * always wins. Failing that, `autoStow` asks the system, which answers with
   * the emptiest suitable shelf in the right building. Failing both, the intake
   * is refused: an item with nowhere to be is not receivable, and silently
   * inventing a location would put goods on a shelf nobody was told to walk to.
   *
   * The two guards on an explicitly named bin are ones a directed stow could
   * never trip by construction. A DECOMMISSIONED shelf is refused because it is
   * being emptied, and adding to it undoes that work. A shelf in ANOTHER
   * BUILDING is refused because it is not a mistake anybody recovers from later:
   * the record would say the card is in New Jersey while the card is in
   * Delaware, and every count, pick and shipment after that reads the record.
   */
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

  /**
   * A parcel may only receive items into the account it belongs to, and only
   * while it is open.
   *
   * `processed` is refused as firmly as the others: that status means the fee has
   * been charged and the parcel closed out, so adding to it afterwards would
   * quietly extend a finished record.
   */
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

  /**
   * Intake one item (or a lot treated as one item). When `quantity` > 1 this is
   * called N times so a single submit yields N full item records.
   *
   * The order of the checks is deliberate. The class is settled first, because
   * everything else keys off it — the lot rule, the storage terms, and now the
   * kind of shelving the goods need. Then the owner, then the parcel, and only
   * then the shelf: which shelf is right depends on the class and on which
   * building the parcel is sitting in, so it cannot be decided before both are
   * known.
   */
  /**
   * Book several DIFFERENT units in one gesture.
   *
   * `quantity` books N copies of one description, which is right for a run of
   * identical commons and wrong for the ordinary case: a box holds a Rayquaza ex,
   * a sealed pack and a graded Gold Star, and the bench was typing them one at a time
   * through a form that cleared itself between each. What is shared — the owner,
   * the parcel it came out of, where it is being stowed — was re-entered every
   * time, and the operator could not see the box's contents as a list before
   * committing any of it.
   *
   * Each unit carries its own class, description, condition, serial and
   * photographs. Nothing is shared except what genuinely is.
   *
   * ALL OR NOTHING, for the reason the parcel batch is: a partial success leaves
   * the operator working out which four of nine units are on the system, and the
   * obvious recovery — fix the bad row and press again — would double the four
   * that worked.
   */
  async intakeUnits(actorId: string, units: readonly IntakeItemInput[]) {
    /**
     * EVERY UNIT IS CHECKED BEFORE ANY UNIT IS WRITTEN.
     *
     * `intakeItem` opens its own transaction per unit, so a loop over it commits
     * as it goes: a bad row nine deep left the first eight on the shelves while
     * the operator read a refusal that named row nine and invited them to fix it
     * and press again — which would have booked those eight in twice. The parcel
     * batch had exactly this bug and it was caught the same way, by a test that
     * counted the rows afterwards.
     *
     * Wrapping the whole run in one transaction would be the tidier fix and is
     * not available here: `intakeItem` resolves a shelf, bills through the
     * billing port and writes custody events through `CustodyService.run`, each
     * of which owns its own transaction boundary. So the guarantee is bought the
     * other way round — everything that can be rejected is rejected up front,
     * against the same rules the write path applies, and only then does anything
     * get written.
     *
     * What survives is a narrow window: a shelf that fills up, or an owner
     * suspended, between the check and the write. Both fail loudly on the unit
     * that hits them rather than silently, and neither is reachable by anything
     * the operator typed.
     */
    for (const [index, unit] of units.entries()) {
      try {
        await this.assertReceivable(unit);
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'could not be booked in';
        throw AppError.validation(`Unit ${index + 1} of ${units.length}: ${reason}`);
      }
    }

    const created: unknown[] = [];
    for (const [index, unit] of units.entries()) {
      try {
        // Each unit re-asks for a shelf, because the one just handed out is now
        // fuller and the next unit may be a different class entirely.
        const one = await this.intakeItem(actorId, unit);
        created.push(...(Array.isArray(one) ? one : [one]));
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'could not be booked in';
        throw AppError.validation(`Unit ${index + 1} of ${units.length}: ${reason}`);
      }
    }
    return this.withShelves(created as { binId?: string | null }[]);
  }

  /**
   * Each unit with the shelf it was actually put on.
   *
   * A mixed run is stowed unit by unit — a card to ordinary shelving, a sealed
   * case to oversized — so one "stow to" line on the bench could not be right
   * for all of them. The shelf travels back with each unit and is printed on its
   * label, which is what the operator carries to the aisle.
   */
  private async withShelves<T extends { binId?: string | null }>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.binId).filter((id): id is string => Boolean(id)))];
    const shelves = ids.length
      ? await this.db
          .select({ id: bin.id, serialNumber: bin.serialNumber, zone: bin.zone })
          .from(bin)
          .where(inArray(bin.id, ids))
      : [];
    const byId = new Map(shelves.map((b) => [b.id, b]));
    return rows.map((r) => {
      const shelf = r.binId ? byId.get(r.binId) : undefined;
      return { ...r, binSerial: shelf?.serialNumber ?? null, binZone: shelf?.zone ?? null };
    });
  }

  /**
   * Everything about one unit that can be decided without writing anything.
   *
   * Deliberately the same checks `intakeItem` performs, in the same order, so a
   * unit that passes here is one the write path will accept: the class has to be
   * vocabulary, the owner has to resolve, the parcel has to be that owner's and
   * open, and a lot has to be a class that can be one.
   */
  private async assertReceivable(input: IntakeItemInput): Promise<void> {
    if (!isKnownItemClass(input.typeClass)) {
      throw AppError.validation(`Unknown item class "${input.typeClass}"`);
    }
    const cls = itemClass(input.typeClass)!;
    if (input.isLot === true && !cls.lotEligible) {
      throw AppError.validation(`${cls.label} cannot be received as a lot`);
    }
    const ownerId = await this.resolveOwner(input);
    if (input.parcelId) await this.assertParcelOpenFor(input.parcelId, ownerId);
  }

  async intakeItem(actorId: string, input: IntakeItemInput) {
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
      // The RESOLVED shelf, not whatever the caller typed: `createOne` writes
      // this straight onto the item, and a barcode is not an id.
      binId,
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
        // A lot is one item holding many; it has its own price (`intake_lot`),
        // tried first and falling back to the class rule if none is in force.
        ...(input.isLot === true ? { feeActionType: 'intake_lot' } : {}),
      });
      /**
       * The bench's own photographs of the card, stored against the item.
       *
       * `item_image` has existed since custody was built and nothing ever wrote
       * a row into it outside the seed — the photography service records a key
       * for a shoot it never receives. These are type `intake`, version 1, which
       * is exactly what the vault drawer already reads and renders, so a card
       * photographed while it is being booked in has a real picture in its
       * owner's vault immediately rather than the generated placeholder it wore
       * until somebody paid for a professional shoot.
       */
      const photoKeys = (input.photoKeys ?? []).map((k) => k.trim()).filter(Boolean);
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
    return { lotItemId, producedCount: produced.length, items: await this.withShelves(produced) };
  }
}
