import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
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

@Injectable()
export class GroupShipmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly shipments: ShipmentService,
    private readonly profiles: ParcelProfileService,
    private readonly outbox: OutboxService,
  ) {}

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
          destinationDetail: s.destinationDetail,
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

    await this.db.transaction(async (tx) => {
      await this.assertForming(tx, group.id, 'That group has already been closed to new members');
      const [joined] = await tx
        .update(shipment)
        .set({ groupId: group.id, updatedAt: new Date() })
        .where(and(eq(shipment.id, shipmentId), eq(shipment.status, 'requested'), isNull(shipment.groupId)))
        .returning({ id: shipment.id });
      if (!joined) throw new AppError(ErrorCode.CONFLICT, 'That request has moved on and cannot join a group', 409);
    });

    return this.describe(group.id);
  }

  private async assertForming(tx: Database, groupId: string, message: string) {
    const [row] = await tx
      .select({ status: shipmentGroup.status })
      .from(shipmentGroup)
      .where(eq(shipmentGroup.id, groupId))
      .for('share')
      .limit(1);
    if (row?.status !== 'forming') throw new AppError(ErrorCode.CONFLICT, message, 409);
  }

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

    const groupId = s.groupId;
    await this.db.transaction(async (tx) => {
      await this.assertForming(tx, groupId, 'That group has been locked — ask support to unpick it');
      await tx
        .update(shipment)
        .set({ groupId: null, updatedAt: new Date() })
        .where(and(eq(shipment.id, shipmentId), eq(shipment.groupId, groupId)));
    });
    return { status: 'left' as const };
  }

  async describe(groupId: string, viewer?: ShipmentActor) {
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

    const staff = viewer?.role === 'warehouse_operator' || viewer?.role === 'admin';
    if (viewer && !staff && group.payerUserId !== viewer.id && !members.some((m) => m.shipment.userId === viewer.id)) {
      throw AppError.notFound('Group not found');
    }

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
      const [locked] = await tx
        .update(shipmentGroup)
        .set({ status: 'locked', lockedAt: now, updatedAt: now })
        .where(and(eq(shipmentGroup.id, groupId), eq(shipmentGroup.status, 'forming')))
        .returning({ id: shipmentGroup.id });
      if (!locked) throw new AppError(ErrorCode.CONFLICT, 'That group is no longer open to locking', 409);

      const current = await tx.select().from(shipment).where(eq(shipment.groupId, groupId));
      if (current.length < 2) {
        throw AppError.validation('A shared parcel needs at least two people in it.');
      }

      for (const m of current) {
        await this.outbox.emit(tx, {
          aggregateType: 'shipment',
          aggregateId: m.id,
          eventType: 'group_shipment_locked',
          payload: {
            userId: m.userId,
            groupCode: group.code,
            memberCount: current.length,
            destination: group.destinationAddress,
          },
        });
      }
      return { status: 'locked' as const, memberCount: current.length };
    });
  }

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
      await tx.update(shipment).set({ groupId: null, updatedAt: now }).where(eq(shipment.groupId, groupId));
      return { status: 'cancelled' as const };
    });
  }
}
