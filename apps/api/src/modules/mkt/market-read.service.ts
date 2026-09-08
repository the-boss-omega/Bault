import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { normalizeUsername } from '../../shared/names';
import { userAccount } from '../acc/acc.schema';
import { item } from '../cst/cst.schema';
import { listing, offer, swapProposal } from './mkt.schema';

/**
 * The READ side of the marketplace — the half that was missing.
 *
 * Every write here already existed and was correct: `ListingService` can reprice
 * and remove, `OfferService` can accept, reject and counter, `TradeService` runs
 * a dual-approval swap. None of it was reachable, because there was no query
 * that answered the questions a seller actually has:
 *
 *   - which listings are mine?
 *   - has anybody offered on them?
 *   - what have I offered on, and did they reply?
 *   - is anybody proposing a trade with me?
 *   - who is this person I want to trade with?
 *
 * A seller was notified "you received an offer of $X" and had nowhere to go.
 * These queries are the somewhere.
 */
@Injectable()
export class MarketReadService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Resolve a username to the id the swap and transfer endpoints need.
   *
   * Deliberately narrow: it answers with an id and a display name and nothing
   * else. A lookup that returned a profile would be a directory anybody could
   * scrape; this returns exactly what is needed to address a trade to somebody
   * whose username you already know.
   */
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
    // A suspended or closed account cannot complete a trade, so offering it as a
    // counterparty would only produce a proposal that can never execute.
    if (row.status !== 'active') throw AppError.validation('That collector cannot trade right now');
    return { id: row.id, username: row.username, firstName: row.firstName, lastName: row.lastName };
  }

  /**
   * Look up one of another collector's items by SERIAL NUMBER, for a swap.
   *
   * A swap has to name what comes back, and the proposer cannot browse somebody
   * else's vault — publishing every collector's holdings to anybody who asks is
   * not a trade-off worth making for this. So the exchange works the way it does
   * between collectors anyway: you already know which card you want, and you
   * quote its serial.
   *
   * Requiring the serial is therefore the privacy control, not an inconvenience.
   * The answer is deliberately thin — the item's identity and nothing about its
   * value, cost or history — and it is refused unless the item is genuinely
   * swappable, so a proposal cannot be built against something that would be
   * rejected at execution.
   */
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

    // Same answer whether the serial does not exist or belongs to somebody else:
    // a lookup that distinguished the two would confirm what a given collector
    // owns, one guess at a time.
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

  /**
   * A seller's own listings, with the count of offers still awaiting them.
   *
   * `removed` listings are included: a seller who delisted something should be
   * able to see that they did, rather than watching it vanish.
   */
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

    // One grouped query rather than one per listing.
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

  /**
   * Every offer that concerns the caller, on both sides of the table.
   *
   * `direction` says which side of the LISTING they are on. `yourTurn` says
   * whether the ball is in their court, and those are not the same question —
   * which is the mistake the offers panel made.
   *
   * The panel keyed its actions off `direction` alone: a buyer was always shown
   * "awaiting seller" and given no controls, so a buyer who had been sent a
   * counter-offer could not accept it, counter it, or even withdraw. A
   * negotiation could be started but never finished from the side that was being
   * negotiated with. Whose move it is depends on who proposed the price on the
   * table, so that is what is computed and sent.
   */
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
        /** The caller's own side, so the UI never re-derives it from ids. */
        side,
        /**
         * True when the price on the table was named by the OTHER party, which
         * is exactly when accept / counter / reject are available. False means
         * the caller is waiting — and their one action is to withdraw.
         */
        yourTurn: r.proposedBy !== side,
      };
    });
  }

  /**
   * Swap proposals and gift transfers involving the caller, on either side.
   *
   * A gift is the degenerate swap with an empty requested set, and it is
   * labelled as one here rather than left for the UI to work out from an empty
   * array — the two read completely differently to a recipient.
   */
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

    // Every item named by any proposal, resolved once.
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
        /** Whether the caller still has to do something for this to execute. */
        awaitingMe: r.status === 'pending' && incoming && !r.responderApproved,
      };
    });
  }

  /**
   * A public storefront: one collector's active listings.
   *
   * Public on purpose — it is the shareable page a seller points people at, and
   * a storefront nobody can open without an account is not a storefront. Only
   * ACTIVE listings appear: a sold or delisted card is not on sale, and showing
   * it would advertise something that cannot be bought.
   */
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
