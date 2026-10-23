import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { normalizeUsername } from '../../shared/names';
import { userAccount } from '../acc/acc.schema';
import { item } from '../cst/cst.schema';
import { listing, offer, swapProposal } from './mkt.schema';

@Injectable()
export class MarketReadService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async counterparty(rawUsername: string, callerId: string) {
    const username = normalizeUsername(rawUsername ?? '');
    if (!username) throw AppError.validation('A username is required');
    const [row] = await this.db
      .select({
        id: userAccount.id,
        username: userAccount.username,
        firstName: userAccount.firstName,
        lastName: userAccount.lastName,
        status: userAccount.status,
      })
      .from(userAccount)
      .where(eq(userAccount.username, username))
      .limit(1);
    if (!row) throw AppError.notFound(`No collector with username ${username}`);
    if (row.id === callerId) throw AppError.validation('That is your own account');
    if (row.status !== 'active') throw AppError.validation('That collector cannot trade right now');
    return { id: row.id, username: row.username, firstName: row.firstName, lastName: row.lastName };
  }

  async tradableItem(rawUsername: string, rawSerial: string, callerId: string) {
    const owner = await this.counterparty(rawUsername, callerId);
    const serial = (rawSerial ?? '').trim();
    if (!serial) throw AppError.validation('A serial number is required');

    const [row] = await this.db
      .select({
        id: item.id,
        serialNumber: item.serialNumber,
        typeClass: item.typeClass,
        description: item.description,
        conditionGrade: item.conditionGrade,
        lifecycleState: item.lifecycleState,
        holdFlag: item.holdFlag,
      })
      .from(item)
      .where(and(eq(item.ownerId, owner.id), eq(item.serialNumber, serial)))
      .limit(1);

    if (!row) throw AppError.notFound(`${owner.username} has no item with serial ${serial}`);
    if (row.lifecycleState !== 'stored' || row.holdFlag) {
      throw AppError.validation(`That item is not available to trade right now`);
    }

    return {
      id: row.id,
      serialNumber: row.serialNumber,
      typeClass: row.typeClass,
      description: row.description,
      conditionGrade: row.conditionGrade,
      ownerUsername: owner.username,
    };
  }

  async myListings(sellerId: string) {
    const rows = await this.db
      .select({
        id: listing.id,
        itemId: listing.itemId,
        askingPrice: listing.askingPrice,
        currency: listing.currency,
        status: listing.status,
        publishedAt: listing.publishedAt,
        serialNumber: item.serialNumber,
        typeClass: item.typeClass,
        description: item.description,
        conditionGrade: item.conditionGrade,
      })
      .from(listing)
      .innerJoin(item, sql`${item.id}::text = ${listing.itemId}`)
      .where(eq(listing.sellerId, sellerId))
      .orderBy(desc(listing.publishedAt));

    if (rows.length === 0) return [];

    const counts = await this.db
      .select({ listingId: offer.listingId, count: sql<number>`count(*)::int` })
      .from(offer)
      .where(
        and(
          inArray(
            offer.listingId,
            rows.map((r) => r.id),
          ),
          eq(offer.status, 'pending'),
        ),
      )
      .groupBy(offer.listingId);
    const byListing = new Map(counts.map((c) => [c.listingId, c.count]));

    return rows.map((r) => ({ ...r, pendingOffers: byListing.get(r.id) ?? 0 }));
  }

  async myOffers(userId: string) {
    const rows = await this.db
      .select({
        id: offer.id,
        listingId: offer.listingId,
        amount: offer.amount,
        currency: offer.currency,
        status: offer.status,
        parentOfferId: offer.parentOfferId,
        proposedBy: offer.proposedBy,
        createdAt: offer.createdAt,
        buyerId: offer.buyerId,
        sellerId: listing.sellerId,
        askingPrice: listing.askingPrice,
        listingStatus: listing.status,
        itemId: listing.itemId,
        serialNumber: item.serialNumber,
        typeClass: item.typeClass,
        description: item.description,
        buyerUsername: userAccount.username,
      })
      .from(offer)
      .innerJoin(listing, eq(listing.id, offer.listingId))
      .innerJoin(item, sql`${item.id}::text = ${listing.itemId}`)
      .leftJoin(userAccount, eq(userAccount.id, offer.buyerId))
      .where(or(eq(offer.buyerId, userId), eq(listing.sellerId, userId)))
      .orderBy(desc(offer.createdAt));

    return rows.map((r) => {
      const side = r.sellerId === userId ? ('seller' as const) : ('buyer' as const);
      return {
        ...r,
        direction: side === 'seller' ? ('incoming' as const) : ('outgoing' as const),
        side,
        yourTurn: r.proposedBy !== side,
      };
    });
  }

  async mySwaps(userId: string) {
    const rows = await this.db
      .select()
      .from(swapProposal)
      .where(or(eq(swapProposal.proposerId, userId), eq(swapProposal.responderId, userId)))
      .orderBy(desc(swapProposal.createdAt));

    const ids = [
      ...new Set(rows.flatMap((r) => [r.proposerId, r.responderId])),
    ];
    const people =
      ids.length > 0
        ? await this.db
            .select({ id: userAccount.id, username: userAccount.username })
            .from(userAccount)
            .where(inArray(userAccount.id, ids))
        : [];
    const byId = new Map(people.map((p) => [p.id, p.username]));

    const itemIds = [
      ...new Set(
        rows.flatMap((r) => [
          ...((r.offeredItemIds as string[]) ?? []),
          ...((r.requestedItemIds as string[]) ?? []),
        ]),
      ),
    ];
    const items =
      itemIds.length > 0
        ? await this.db
            .select({
              id: item.id,
              serialNumber: item.serialNumber,
              typeClass: item.typeClass,
              description: item.description,
            })
            .from(item)
            .where(inArray(item.id, itemIds))
        : [];
    const itemById = new Map(items.map((i) => [i.id, i]));
    const resolve = (list: unknown) =>
      ((list as string[]) ?? []).map((id) => itemById.get(id) ?? { id, description: id });

    return rows.map((r) => {
      const requested = (r.requestedItemIds as string[]) ?? [];
      const isTransfer = requested.length === 0;
      const incoming = r.responderId === userId;
      return {
        id: r.id,
        status: r.status,
        kind: isTransfer ? ('transfer' as const) : ('swap' as const),
        direction: incoming ? ('incoming' as const) : ('outgoing' as const),
        proposerUsername: byId.get(r.proposerId) ?? null,
        responderUsername: byId.get(r.responderId) ?? null,
        offeredItems: resolve(r.offeredItemIds),
        requestedItems: resolve(r.requestedItemIds),
        proposerApproved: r.proposerApproved,
        responderApproved: r.responderApproved,
        createdAt: r.createdAt,
        awaitingMe: r.status === 'pending' && incoming && !r.responderApproved,
      };
    });
  }

  async storefront(rawUsername: string) {
    const username = normalizeUsername(rawUsername ?? '');
    if (!username) throw AppError.validation('A username is required');
    const [seller] = await this.db
      .select({ id: userAccount.id, username: userAccount.username, status: userAccount.status })
      .from(userAccount)
      .where(eq(userAccount.username, username))
      .limit(1);
    if (!seller) throw AppError.notFound('Storefront not found');

    const listings = await this.db
      .select({
        id: listing.id,
        itemId: listing.itemId,
        askingPrice: listing.askingPrice,
        currency: listing.currency,
        publishedAt: listing.publishedAt,
        serialNumber: item.serialNumber,
        typeClass: item.typeClass,
        description: item.description,
        conditionGrade: item.conditionGrade,
      })
      .from(listing)
      .innerJoin(item, sql`${item.id}::text = ${listing.itemId}`)
      .where(and(eq(listing.sellerId, seller.id), eq(listing.status, 'active')))
      .orderBy(desc(listing.publishedAt));

    return { username: seller.username, listings };
  }
}
