import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { BILLING_PORT, type BillingPort } from '../../shared/billing/billing.port';
import { CustodyService } from '../cst/custody.service';
import { StowService } from '../cst/stow.service';
import { batch } from '../cst/cst.schema';
import { userAccount } from '../acc/acc.schema';
import { normalizeUsername } from '../../shared/names';
import { makeItemBarcode, makeItemSerial } from './labels';
import { isKnownItemClass, itemClass } from './item-classes';

export interface SplitItemInput {
  typeClass: string;
  description?: string;
  conditionGrade?: string;
  /** A shelf by id or barcode. Omitted, the stow is directed — see `split`. */
  binId?: string;
}

/**
 * Batch open + split (T048, Principle III).
 *
 * A batch-type arrival opens a batch linked to an owner. Splitting produces one
 * INDIVIDUALLY TRACKED item per entry, each with its own `batch_split` custody
 * event — all in one transaction. Each resulting item is a billable intake.
 */
@Injectable()
export class BatchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly custody: CustodyService,
    private readonly stow: StowService,
    @Inject(BILLING_PORT) private readonly billing: BillingPort,
  ) {}

  /**
   * Open a batch for an owner named by their permanent USERNAME.
   *
   * A legacy OW- intake ID is still accepted as a fallback for pre-printed
   * arrivals, exactly as in `IntakeService.resolveOwner` — same rule, so the two
   * intake paths never disagree about who an arrival belongs to.
   */
  async open(owner: { ownerUsername?: string; ownerIntakeId?: string }) {
    const username = normalizeUsername(owner.ownerUsername ?? '');
    if (username) {
      const [found] = await this.db
        .select({ id: userAccount.id })
        .from(userAccount)
        .where(eq(userAccount.username, username))
        .limit(1);
      if (!found) throw AppError.notFound(`No account with username ${username}`);
      const [created] = await this.db.insert(batch).values({ ownerId: found.id }).returning();
      return created;
    }

    const legacyIntakeId = owner.ownerIntakeId?.trim();
    if (!legacyIntakeId) throw AppError.validation('An owner username is required to open a batch.');
    const [found] = await this.db
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(eq(userAccount.intakeId, legacyIntakeId))
      .limit(1);
    if (!found) throw AppError.notFound(`No account for legacy intake ID ${legacyIntakeId}`);
    const [created] = await this.db.insert(batch).values({ ownerId: found.id }).returning();
    return created;
  }

  /**
   * Split a batch into individually tracked items.
   *
   * This is the same act as an intake — a container becomes units, each unit
   * gets an identity, a shelf and a charge — so it now obeys the same three
   * rules, which it previously did not.
   *
   * THE CLASS IS VOCABULARY. A split entry could name any class it liked,
   * including one that does not exist, while `/intake/items` had rejected
   * unknown classes since Part 14. Two doors into the same table cannot disagree
   * about what may come through them.
   *
   * THE STORAGE TERMS ARE SET AT RECEIPT. `oversized` is copied from the class
   * here exactly as intake does it, so a sealed case decanted out of a batch is
   * billed as the bulky thing it is rather than as a card.
   *
   * EVERY UNIT IS STOWED. A split entry with no bin used to produce an item
   * shelved nowhere — a record saying the platform has custody of something it
   * cannot say the location of, which is the one thing the custody trail exists
   * to prevent. An entry that names a shelf still uses it; one that does not is
   * directed to a shelf with room, the same way intake's `autoStow` is.
   *
   * The stow is resolved BEFORE the transaction opens, because it reads the
   * whole item table to count shelves and there is no reason to hold a batch row
   * locked while it does.
   */
  async split(actorId: string, batchId: string, items: SplitItemInput[]) {
    if (items.length === 0) throw AppError.validation('A split needs at least one item');

    const prepared: { spec: SplitItemInput; binId: string; oversized: boolean }[] = [];
    for (const spec of items) {
      if (!isKnownItemClass(spec.typeClass)) {
        throw AppError.validation(`Unknown item class "${spec.typeClass}"`);
      }
      const cls = itemClass(spec.typeClass)!;
      const named = spec.binId?.trim();
      const target = named
        ? await this.stow.resolveBin(named)
        : await this.stow.suggest({ oversized: cls.oversized });
      if (!target.active) {
        throw AppError.validation(`Bin ${target.barcode} is out of service — stow this somewhere else`);
      }
      prepared.push({ spec, binId: target.id, oversized: cls.oversized });
    }

    return this.db.transaction(async (tx) => {
      const [b] = await tx.select().from(batch).where(eq(batch.id, batchId)).for('update').limit(1);
      if (!b) throw AppError.notFound('Batch not found');
      if (b.status === 'split') throw AppError.validation('Batch already split');

      const created = [];
      for (const { spec, binId, oversized } of prepared) {
        const serial = makeItemSerial();
        const item = await this.custody.createWithIntake(tx, {
          ownerId: b.ownerId,
          serialNumber: serial,
          barcode: makeItemBarcode(serial),
          typeClass: spec.typeClass,
          description: spec.description,
          conditionGrade: spec.conditionGrade,
          binId,
          oversized,
          sourceBatchId: batchId,
          actorId,
          eventType: 'batch_split',
        });
        await this.billing.charge(tx, {
          userId: b.ownerId,
          actionType: 'intake',
          itemId: item.id,
          // The class travels with the charge so a class-specific intake rule can
          // resolve, exactly as it does on the `/intake/items` path.
          itemClass: spec.typeClass,
        });
        created.push(item);
      }

      await tx.update(batch).set({ status: 'split', updatedAt: new Date() }).where(eq(batch.id, batchId));
      return created;
    });
  }
}
