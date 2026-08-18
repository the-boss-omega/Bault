import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { OutboxService } from '../not/outbox/outbox.service';
import { userAccount } from '../acc/acc.schema';
import { normalizeUsername } from '../../shared/names';
import { arrivalDisposal } from './disposal.schema';
import {
  isKnownDisposalCategory,
  isKnownDisposalOutcome,
  type DisposalOutcome,
} from './item-classes';

export interface RecordDisposalInput {
  ownerUsername: string;
  category: string;
  outcome: string;
  description: string;
  notes: string;
}

/**
 * Recording an arrival that was not accepted.
 *
 * The physical act — pulling a battery out of an AirTag, binning a bottle of
 * perfume, handing a box of commons to a youth club — happens in a warehouse and
 * is not something software can do or check. What software owes is the other
 * three quarters of the job: PUBLISH the rule in advance (the Account Use &
 * Balance Policy), RECORD which of the permitted decisions was actually taken,
 * and TELL the collector, who is otherwise left waiting for something that is
 * never going to appear in their vault.
 *
 * Nothing here is billable. Nothing entered storage, so there is nothing to
 * charge for storing, and charging an intake fee for an item that was destroyed
 * on arrival would be indefensible.
 */
@Injectable()
export class DisposalService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Record one disposal.
   *
   * Every field is validated rather than trusted. `notes` in particular is
   * REQUIRED and cannot be blank: this row is the only account that will ever
   * exist of why somebody's property was destroyed, and a record that says
   * "prohibited item, destroyed" and nothing else is not an account of anything.
   * The same rule the warehouse fulfillment forms use (Requirement 5.4).
   */
  async record(actorId: string, input: RecordDisposalInput) {
    const username = normalizeUsername(input.ownerUsername ?? '');
    if (!username) throw AppError.validation('An owner username is required');

    if (!isKnownDisposalCategory(input.category)) {
      throw AppError.validation(`Unknown disposal category "${input.category}"`);
    }
    if (!isKnownDisposalOutcome(input.outcome)) {
      throw AppError.validation(`Unknown disposal outcome "${input.outcome}"`);
    }
    const description = input.description?.trim() ?? '';
    const notes = input.notes?.trim() ?? '';
    if (!description) throw AppError.validation('Describe what the item was');
    if (!notes) throw AppError.validation('Notes are required — record why this decision was taken');

    const [owner] = await this.db
      .select({ id: userAccount.id })
      .from(userAccount)
      .where(eq(userAccount.username, username))
      .limit(1);
    if (!owner) throw AppError.notFound(`No account with username ${username}`);

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(arrivalDisposal)
        .values({
          code: prefixedId(ID_PREFIX.disposal),
          ownerId: owner.id,
          category: input.category,
          outcome: input.outcome as DisposalOutcome,
          description,
          notes,
          actorId,
        })
        .returning();
      if (!row) throw AppError.validation('Failed to record the disposal');

      // The collector is told in the same transaction that writes the record, so
      // a disposal can never exist silently.
      await this.outbox.emit(tx, {
        aggregateType: 'arrival_disposal',
        aggregateId: row.id,
        eventType: 'arrival_not_accepted',
        payload: {
          ownerId: owner.id,
          disposalCode: row.code,
          category: row.category,
          outcome: row.outcome,
          itemDescription: row.description,
        },
      });

      return row;
    });
  }

  /** One collector's own disposals, newest first. */
  listMine(userId: string) {
    return this.db
      .select({
        id: arrivalDisposal.id,
        code: arrivalDisposal.code,
        category: arrivalDisposal.category,
        outcome: arrivalDisposal.outcome,
        description: arrivalDisposal.description,
        notes: arrivalDisposal.notes,
        occurredAt: arrivalDisposal.occurredAt,
      })
      .from(arrivalDisposal)
      .where(eq(arrivalDisposal.ownerId, userId))
      .orderBy(desc(arrivalDisposal.occurredAt));
  }

  /** Every disposal, with the collector named — the warehouse/admin view. */
  listAll() {
    return this.db
      .select({
        id: arrivalDisposal.id,
        code: arrivalDisposal.code,
        category: arrivalDisposal.category,
        outcome: arrivalDisposal.outcome,
        description: arrivalDisposal.description,
        notes: arrivalDisposal.notes,
        occurredAt: arrivalDisposal.occurredAt,
        ownerUsername: userAccount.username,
      })
      .from(arrivalDisposal)
      .leftJoin(userAccount, eq(userAccount.id, arrivalDisposal.ownerId))
      .orderBy(desc(arrivalDisposal.occurredAt));
  }
}
