import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { ID_PREFIX, prefixedId } from '../../shared/ids';
import { OutboxService } from '../not/outbox/outbox.service';
import { userAccount } from '../acc/acc.schema';
import { fullName } from '../../shared/names';
import { shipment } from './shp.schema';
import { shipmentGroup } from './shipment-group.schema';
import { ParcelProfileService } from './parcel-profile.service';
import { ShipmentService, type ShipmentActor } from './shipment.service';

/**
 * One parcel, several collectors, one payer.
 *
 * Three people at a convention with cards in the vault and one hotel address
 * between them. ShipMyCards handles it by having each collector raise a same-day
 * request to the identical address, tick the group option and name everybody in
 * the comments — which works because a human reads the comments.
 *
 * The tempting implementation is to let one shipment carry everybody's items.
 * That breaks Principle I outright: an item has exactly one owner, and a
 * shipment that moves somebody else's card is a custody event that person never
 * authorised.
 *
 * So each collector keeps their own shipment, with their own items, their own
 * custody events and their own history. The GROUP is what says they travel
 * together and who pays the carrier — the only two facts that actually needed
 * modelling, and the only two a warehouse operator needs at the packing bench.
 *
 * Joining is always the member's own act. A group you can be added to without
 * agreeing is a group that can send your property to an address you never saw.
 */
@Injectable()
export class GroupShipmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly shipments: ShipmentService,
    private readonly profiles: ParcelProfileService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Open a group around a shipment you already have.
   *
   * The opener nominates themselves as the payer, because somebody who is not
   * prepared to pay for the parcel has no business calling it together.
   */
  async open(
    userId: string,
    shipmentId: string,
    notes: string | undefined,
    actor: ShipmentActor,
  ) {
    const s = await this.shipments.loadFor(shipmentId, actor);
    if (s.userId !== userId) throw AppError.forbidden('That is not your shipment');
    if (s.status !== 'requested') {
      throw new AppError(ErrorCode.CONFLICT, 'A group can only be opened around a request that has not been rated', 409);
    }
    if (s.groupId) throw new AppError(ErrorCode.CONFLICT, 'That request is already in a group', 409);

    return this.db.transaction(async (tx) => {
      const [group] = await tx
        .insert(shipmentGroup)
        .values({
          code: prefixedId(ID_PREFIX.shipmentGroup),
          payerUserId: userId,
          destinationAddress: s.destinationAddress,
          recipientName: s.recipientName ?? '',
          destinationCountry: s.destinationCountry,
          destinationPostalCode: s.destinationPostalCode,
          notes: notes?.trim() || null,
          status: 'forming',
        })
        .returning();
      if (!group) throw AppError.validation('Failed to open the group');

      await tx
        .update(shipment)
        .set({ groupId: group.id, updatedAt: new Date() })
        .where(eq(shipment.id, shipmentId));

      return group;
    });
  }

  /**
   * Join with a request of your own.
   *
   * The destination must match exactly. "Everybody typed the same thing" is not
   * the same claim as "there is one destination", and only the second one gets a
   * parcel to the right door.
   */
  async join(userId: string, groupCode: string, shipmentId: string, actor: ShipmentActor) {
    const [group] = await this.db
      .select()
      .from(shipmentGroup)
      .where(eq(shipmentGroup.code, groupCode.trim().toUpperCase()))
      .limit(1);
    if (!group) throw AppError.notFound('No group with that code');
    if (group.status !== 'forming') {
      throw new AppError(ErrorCode.CONFLICT, 'That group has already been closed to new members', 409);
    }

    const s = await this.shipments.loadFor(shipmentId, actor);
    if (s.userId !== userId) throw AppError.forbidden('That is not your shipment');
    if (s.groupId) throw new AppError(ErrorCode.CONFLICT, 'That request is already in a group', 409);
    if (s.status !== 'requested') {
      throw new AppError(ErrorCode.CONFLICT, 'Only a request that has not been rated can join a group', 409);
    }
    if (
      s.destinationAddress !== group.destinationAddress ||
      s.destinationCountry !== group.destinationCountry ||
      s.destinationPostalCode !== group.destinationPostalCode
    ) {
      throw AppError.validation('Your request is going somewhere else. A shared parcel has one destination.');
    }

    await this.db
      .update(shipment)
      .set({ groupId: group.id, updatedAt: new Date() })
      .where(eq(shipment.id, shipmentId));

    return this.describe(group.id);
  }

  /** Step back out, while the group is still forming. */
  async leave(userId: string, shipmentId: string, actor: ShipmentActor) {
    const s = await this.shipments.loadFor(shipmentId, actor);
    if (s.userId !== userId) throw AppError.forbidden('That is not your shipment');
    if (!s.groupId) throw AppError.validation('That request is not in a group');

    const [group] = await this.db.select().from(shipmentGroup).where(eq(shipmentGroup.id, s.groupId)).limit(1);
    if (group?.status !== 'forming') {
      throw new AppError(ErrorCode.CONFLICT, 'That group has been locked — ask support to unpick it', 409);
    }
    if (group.payerUserId === userId) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'You are the payer. Cancel the group instead, or the others lose the parcel out from under them.',
        409,
      );
    }

    await this.db
      .update(shipment)
      .set({ groupId: null, updatedAt: new Date() })
      .where(eq(shipment.id, shipmentId));
    return { status: 'left' as const };
  }

  /** Who is in it, what they are sending, and what it weighs together. */
  async describe(groupId: string) {
    const [group] = await this.db.select().from(shipmentGroup).where(eq(shipmentGroup.id, groupId)).limit(1);
    if (!group) throw AppError.notFound('Group not found');

    const members = await this.db
      .select({
        shipment,
        username: userAccount.username,
        firstName: userAccount.firstName,
        lastName: userAccount.lastName,
      })
      .from(shipment)
      .leftJoin(userAccount, eq(userAccount.id, shipment.userId))
      .where(eq(shipment.groupId, groupId));

    let totalWeightGrams = 0;
    let totalItems = 0;
    const rows = [];
    for (const m of members) {
      const ids = (m.shipment.itemIds as string[]) ?? [];
      const items = ids.length > 0 ? await this.profiles.loadShippableItems(m.shipment.userId, ids) : [];
      const measured = this.profiles.measure(items);
      totalWeightGrams += measured.totalWeightGrams;
      totalItems += items.length;
      rows.push({
        shipmentId: m.shipment.id,
        shipmentCode: m.shipment.code,
        username: m.username,
        name: fullName(m.firstName, m.lastName) || null,
        itemCount: items.length,
        weightGrams: measured.totalWeightGrams,
        isPayer: m.shipment.userId === group.payerUserId,
        insuredValueMinor: m.shipment.insuredValueMinor,
        status: m.shipment.status,
      });
    }

    return {
      id: group.id,
      code: group.code,
      status: group.status,
      destinationAddress: group.destinationAddress,
      recipientName: group.recipientName,
      notes: group.notes,
      memberCount: rows.length,
      totalItems,
      totalWeightGrams,
      members: rows,
    };
  }

  /** The groups this collector is part of. */
  async mine(userId: string) {
    const rows = await this.db
      .select({ groupId: shipment.groupId })
      .from(shipment)
      .where(and(eq(shipment.userId, userId)));
    const ids = [...new Set(rows.map((r) => r.groupId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return [];
    const groups = await this.db.select().from(shipmentGroup).where(inArray(shipmentGroup.id, ids));
    return Promise.all(groups.map((g) => this.describe(g.id)));
  }

  /**
   * Close the group and hand it to the warehouse.
   *
   * Only the payer may lock it, and only they may cancel it — they are the one
   * on the hook for the carrier, and a member locking the group would be
   * committing somebody else's wallet.
   *
   * Each member still selects and pays for their own service. What the group
   * changes is that the warehouse packs them into one box; it does not merge
   * anybody's money, because merging money across accounts is exactly the thing
   * a custody platform must never do quietly.
   */
  async lock(userId: string, groupId: string) {
    const [group] = await this.db.select().from(shipmentGroup).where(eq(shipmentGroup.id, groupId)).limit(1);
    if (!group) throw AppError.notFound('Group not found');
    if (group.payerUserId !== userId) throw AppError.forbidden('Only the payer can lock the group');
    if (group.status !== 'forming') throw new AppError(ErrorCode.CONFLICT, 'Already locked', 409);

    const members = await this.db.select().from(shipment).where(eq(shipment.groupId, groupId));
    if (members.length < 2) {
      throw AppError.validation('A shared parcel needs at least two people in it.');
    }

    const now = new Date();
    return this.db.transaction(async (tx) => {
      await tx
        .update(shipmentGroup)
        .set({ status: 'locked', lockedAt: now, updatedAt: now })
        .where(eq(shipmentGroup.id, groupId));

      for (const m of members) {
        await this.outbox.emit(tx, {
          aggregateType: 'shipment',
          aggregateId: m.id,
          eventType: 'group_shipment_locked',
          payload: {
            userId: m.userId,
            groupCode: group.code,
            memberCount: members.length,
            destination: group.destinationAddress,
          },
        });
      }
      return { status: 'locked' as const, memberCount: members.length };
    });
  }

  /** Call the whole thing off. Members keep their own requests. */
  async cancel(userId: string, groupId: string, reason: string) {
    if (!reason?.trim()) throw AppError.validation('Say why');
    const [group] = await this.db.select().from(shipmentGroup).where(eq(shipmentGroup.id, groupId)).limit(1);
    if (!group) throw AppError.notFound('Group not found');
    if (group.payerUserId !== userId) throw AppError.forbidden('Only the payer can cancel the group');
    if (group.status === 'dispatched') {
      throw new AppError(ErrorCode.CONFLICT, 'That parcel has already gone', 409);
    }

    const now = new Date();
    return this.db.transaction(async (tx) => {
      await tx
        .update(shipmentGroup)
        .set({ status: 'cancelled', cancelledAt: now, notes: reason.trim(), updatedAt: now })
        .where(eq(shipmentGroup.id, groupId));
      // Each member's own request survives untouched — cancelling the shared
      // parcel is not cancelling everybody's shipment.
      await tx.update(shipment).set({ groupId: null, updatedAt: now }).where(eq(shipment.groupId, groupId));
      return { status: 'cancelled' as const };
    });
  }
}
