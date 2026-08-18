import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { prefixedId } from '../../shared/ids';
import { fullName } from '../../shared/names';
import { userAccount } from '../acc/acc.schema';
import { OutboxService } from '../not/outbox/outbox.service';
import { AuditService } from '../sec/audit.service';
import type { AuthUser } from '../sec/auth-context';
import { PAYMENT_ADAPTER } from '../../shared/adapters/adapters.module';
import type { PaymentAdapter } from '@bault/adapters';
import { LedgerService, DEFAULT_CURRENCY } from './ledger.service';
import { charge, externalPayment, ledgerRecord, walletRequest, walletRequestEvent } from './pay.schema';
import { cashOutFeeMinor } from './money-terms';
import {
  canTransition,
  OPEN_WALLET_REQUEST_STATUSES,
  validateWalletRequestDraft,
  type WalletRequestDraft,
  type WalletRequestStatus,
  type WalletRequestType,
} from './wallet-request.rules';

export type RequestActor = Pick<AuthUser, 'id' | 'role'>;

export interface WalletRequestFilters {
  type?: WalletRequestType;
  status?: WalletRequestStatus;
  userId?: string;
  /** ISO date (inclusive) bounds on `created_at`. */
  from?: string;
  to?: string;
}

/**
 * Cash-in / cash-out REQUESTS (Requirements 7 & 8).
 *
 * The invariant this service exists to hold: **submitting a request never moves
 * money**. A submission writes one `wallet_request` row and one
 * `wallet_request_event` row and stops. The wallet balance — which is derived
 * from `ledger_record` and nothing else (Principle IV) — changes at exactly one
 * moment in this file, in `complete()`, and only for a request an authorized
 * reviewer has already approved.
 *
 * Separation of duties is enforced rather than assumed: the account that raised a
 * request can never be the account that reviews it, even when that account is an
 * admin reviewing their own cash-out.
 *
 * Every transition appends to `wallet_request_event`, which is registered with
 * the append-only guards in `0001_append_only.sql` — so the review trail cannot
 * be edited or deleted afterwards, by anyone, including this service.
 */
@Injectable()
export class WalletRequestService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_ADAPTER) private readonly payment: PaymentAdapter,
  ) {}

  private static isReviewer(actor: RequestActor): boolean {
    return actor.role === 'admin';
  }

  private assertReviewer(actor: RequestActor): void {
    if (!WalletRequestService.isReviewer(actor)) {
      throw AppError.forbidden('Only an administrator may review wallet requests.');
    }
  }

  /* ---------------------------------------------------------------------------
     Submission
     ------------------------------------------------------------------------- */

  /**
   * Raise a request. Validates the draft, refuses a duplicate of an open request,
   * and — for a cash-out — refuses an amount the wallet cannot currently cover.
   *
   * The balance check here is a courtesy that fails fast at submission time. It
   * is NOT the guarantee: the binding check happens again inside `complete()`,
   * because a balance can fall between submission and approval.
   */
  async submit(userId: string, draft: WalletRequestDraft) {
    const currency = (draft.currency || DEFAULT_CURRENCY).toUpperCase();
    const normalized: WalletRequestDraft = { ...draft, currency };

    const violations = validateWalletRequestDraft(normalized);
    if (violations.length > 0) {
      throw AppError.validation(violations[0]?.message ?? 'Invalid wallet request', { violations });
    }

    // Duplicate guard: an identical request that is still somebody's open work.
    // The reference is part of the identity — see `isDuplicateOf` for why two
    // same-amount transfers with different references are not duplicates.
    const reference = normalized.reference ?? null;
    const [duplicate] = await this.db
      .select({ id: walletRequest.id, code: walletRequest.code, status: walletRequest.status })
      .from(walletRequest)
      .where(
        and(
          eq(walletRequest.userId, userId),
          eq(walletRequest.type, normalized.type),
          eq(walletRequest.amount, normalized.amountMinor),
          eq(walletRequest.currency, currency),
          // `= NULL` is never true in SQL, so the no-reference case needs IS NULL.
          reference === null ? isNull(walletRequest.reference) : eq(walletRequest.reference, reference),
          inArray(walletRequest.status, [...OPEN_WALLET_REQUEST_STATUSES]),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw AppError.conflict(
        ErrorCode.CONFLICT,
        `An identical request (${duplicate.code}) is already open. Wait for it to be decided, or cancel it first.`,
        { existingRequestId: duplicate.id, existingCode: duplicate.code, existingStatus: duplicate.status },
      );
    }

    if (normalized.type === 'cash_out') {
      const balance = await this.ledger.balanceOf(userId);
      if (balance.amount < normalized.amountMinor) {
        throw AppError.conflict(
          ErrorCode.INSUFFICIENT_BALANCE,
          'Your available balance does not cover this cash-out.',
          { availableMinor: balance.amount, requestedMinor: normalized.amountMinor },
        );
      }
    }

    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(walletRequest)
        .values({
          code: prefixedId('WR'),
          userId,
          type: normalized.type,
          status: 'submitted',
          amount: normalized.amountMinor,
          currency,
          fundingSource: normalized.type === 'cash_in' ? (normalized.fundingSource ?? null) : null,
          destinationAccount: normalized.type === 'cash_out' ? (normalized.destinationAccount ?? null) : null,
          beneficiaryName: normalized.type === 'cash_out' ? (normalized.beneficiaryName ?? null) : null,
          reference: normalized.reference ?? null,
          documentKey: normalized.documentKey ?? null,
          notes: normalized.notes ?? null,
        })
        .returning();
      if (!created) throw AppError.validation('Failed to create the wallet request');

      await this.appendEvent(tx, {
        requestId: created.id,
        actorId: userId,
        actorRole: 'user',
        fromStatus: null,
        toStatus: 'submitted',
        reason: null,
        metadata: { amountMinor: created.amount, currency, type: created.type },
      });

      await this.outbox.emit(tx, {
        aggregateType: 'wallet_request',
        aggregateId: created.id,
        eventType: 'wallet_request_submitted',
        payload: { requestId: created.id, code: created.code, type: created.type, status: 'submitted', userId },
      });

      await this.audit.record(
        {
          actorId: userId,
          action: 'wallet_request.submit',
          targetEntity: 'wallet_request',
          targetId: created.id,
          metadata: { type: created.type, amountMinor: created.amount, currency },
        },
        tx,
      );

      return created;
    });
  }

  /* ---------------------------------------------------------------------------
     Reads
     ------------------------------------------------------------------------- */

  /** The caller's own requests, newest first. Never anyone else's. */
  listMine(userId: string) {
    return this.db
      .select()
      .from(walletRequest)
      .where(eq(walletRequest.userId, userId))
      .orderBy(desc(walletRequest.createdAt));
  }

  /**
   * The review queue. Admin-only, and filterable by type, user, status and date
   * because a reviewer works a slice of the queue, not the whole of it.
   */
  async listForReview(actor: RequestActor, filters: WalletRequestFilters = {}) {
    this.assertReviewer(actor);

    const conditions = [];
    if (filters.type) conditions.push(eq(walletRequest.type, filters.type));
    if (filters.status) conditions.push(eq(walletRequest.status, filters.status));
    if (filters.userId) conditions.push(eq(walletRequest.userId, filters.userId));
    if (filters.from) conditions.push(gte(walletRequest.createdAt, new Date(filters.from)));
    if (filters.to) conditions.push(lte(walletRequest.createdAt, new Date(filters.to)));

    const rows = await this.db
      .select({
        request: walletRequest,
        username: userAccount.username,
        email: userAccount.email,
        firstName: userAccount.firstName,
        lastName: userAccount.lastName,
      })
      .from(walletRequest)
      .leftJoin(userAccount, eq(userAccount.id, walletRequest.userId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(walletRequest.createdAt));

    return rows.map((row) => ({
      ...row.request,
      username: row.username,
      email: row.email,
      customerName: fullName(row.firstName, row.lastName),
    }));
  }

  /**
   * One request, with its full audit history. Owner or reviewer only.
   *
   * Carries the SAME joined identity fields as the queue (`listForReview`), so
   * the review drawer names the customer it is about. Without them the drawer
   * showed a request with "Customer —" beside a queue row that named the person
   * perfectly well; a reviewer deciding someone's money should not have to go
   * back to the table to find out whose.
   */
  async detail(requestId: string, actor: RequestActor) {
    const request = await this.loadFor(requestId, actor);

    const [owner] = await this.db
      .select({
        username: userAccount.username,
        email: userAccount.email,
        firstName: userAccount.firstName,
        lastName: userAccount.lastName,
      })
      .from(userAccount)
      .where(eq(userAccount.id, request.userId))
      .limit(1);

    const history = await this.db
      .select()
      .from(walletRequestEvent)
      .where(eq(walletRequestEvent.requestId, requestId))
      .orderBy(walletRequestEvent.occurredAt);

    return {
      ...request,
      username: owner?.username ?? null,
      email: owner?.email ?? null,
      customerName: fullName(owner?.firstName, owner?.lastName),
      history,
    };
  }

  /**
   * Load a request on behalf of a caller.
   *
   * `notFound` rather than `forbidden` when a non-owner asks: confirming that
   * some other customer's request id exists is itself a disclosure.
   */
  private async loadFor(requestId: string, actor: RequestActor) {
    const [row] = await this.db.select().from(walletRequest).where(eq(walletRequest.id, requestId)).limit(1);
    if (!row) throw AppError.notFound('Wallet request not found');
    if (!WalletRequestService.isReviewer(actor) && row.userId !== actor.id) {
      throw AppError.notFound('Wallet request not found');
    }
    return row;
  }

  /* ---------------------------------------------------------------------------
     Transitions
     ------------------------------------------------------------------------- */

  /** The requester withdraws their own request while it is still open. */
  async cancel(requestId: string, actor: RequestActor, reason?: string) {
    const request = await this.loadFor(requestId, actor);
    if (request.userId !== actor.id) {
      throw AppError.forbidden('Only the person who raised a request may cancel it.');
    }
    return this.applyTransition(request.id, 'cancelled', actor, { reason: reason ?? null, actorRole: 'user' });
  }

  /** Reviewer moves a request into review. */
  async markUnderReview(requestId: string, actor: RequestActor) {
    this.assertReviewer(actor);
    return this.applyTransition(requestId, 'pending_review', actor, {});
  }

  async approve(requestId: string, actor: RequestActor, note?: string) {
    this.assertReviewer(actor);
    return this.applyTransition(requestId, 'approved', actor, { reason: note ?? null, stampReview: true });
  }

  async reject(requestId: string, actor: RequestActor, reason: string) {
    this.assertReviewer(actor);
    const trimmed = (reason ?? '').trim();
    if (trimmed.length === 0) {
      throw AppError.validation('A rejection must state a reason.', { field: 'reason' });
    }
    return this.applyTransition(requestId, 'rejected', actor, {
      reason: trimmed,
      stampReview: true,
      rejectionReason: trimmed,
    });
  }

  /** Reviewer marks the money movement as under way with the payment provider. */
  async markProcessing(requestId: string, actor: RequestActor, note?: string) {
    this.assertReviewer(actor);
    return this.applyTransition(requestId, 'processing', actor, { reason: note ?? null });
  }

  /**
   * Completion — THE ONLY PLACE A WALLET REQUEST MOVES MONEY.
   *
   * In one transaction: re-check the invariants that could have changed since
   * approval, append the single `ledger_record` row that is the money movement,
   * link it to the request (`settled_ledger_id`, which carries a partial unique
   * index so a second settlement is impossible at the database), and record the
   * transition.
   */
  async complete(requestId: string, actor: RequestActor, note?: string) {
    this.assertReviewer(actor);

    return this.db.transaction(async (tx) => {
      // `for('update')` so two reviewers pressing Complete at the same moment
      // serialize here rather than racing to write two ledger rows.
      const [request] = await tx
        .select()
        .from(walletRequest)
        .where(eq(walletRequest.id, requestId))
        .for('update')
        .limit(1);
      if (!request) throw AppError.notFound('Wallet request not found');

      this.assertSeparationOfDuties(request.userId, actor);

      if (request.status === 'completed') {
        throw AppError.conflict(ErrorCode.CONFLICT, 'This request has already been completed.');
      }
      if (!canTransition(request.status, 'completed')) {
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          `A request that is ${request.status} cannot be completed; approve it first.`,
        );
      }
      if (request.settledLedgerId) {
        throw AppError.conflict(ErrorCode.CONFLICT, 'This request has already settled.');
      }

      // Re-check the balance at the moment money actually moves. Approval may
      // have happened when the wallet was healthy and a purchase may have
      // drained it since; completing anyway would overdraw a derived balance.
      /**
       * The cash-out fee.
       *
       * Frozen here rather than at submission, because the schedule is a
       * platform rule and the request may have sat in review across a change to
       * it — but quoted to the collector at submission from the same function,
       * so the two agree unless somebody deliberately moved the schedule.
       */
      const feeMinor = request.type === 'cash_out' ? cashOutFeeMinor(request.amount) : 0;

      if (request.type === 'cash_out') {
        const balance = await this.ledger.balanceOf(request.userId, tx);
        // The FEE has to fit too. Completing a cash-out that clears the balance
        // and then charging a fee against it would overdraw an account by an
        // amount the collector was told about and never agreed to fund.
        const needed = request.amount + feeMinor;
        if (balance.amount < needed) {
          throw AppError.conflict(
            ErrorCode.INSUFFICIENT_BALANCE,
            'The balance no longer covers this cash-out and its fee; it cannot be completed.',
            { availableMinor: balance.amount, requestedMinor: request.amount, feeMinor },
          );
        }
      }

      /**
       * The payout rail.
       *
       * `WithdrawalService.confirm` had a `createPayout` call in it and nothing
       * routed to it any more, so a completed cash-out wrote a ledger debit and
       * moved no actual money — the request said settled and the collector's
       * bank account never heard about it.
       *
       * The provider is called BEFORE the ledger row is written, and a failure
       * aborts the transaction. The alternative — debit first, pay out after —
       * loses the collector's money whenever the provider is down.
       */
      let payoutRef: string | null = null;
      if (request.type === 'cash_out') {
        const payout = await this.payment.createPayout({
          userId: request.userId,
          amountMinor: request.amount - feeMinor,
          currency: request.currency ?? DEFAULT_CURRENCY,
          idempotencyKey: `wallet_request:${request.id}`,
          destinationToken: request.destinationAccount ?? '',
        });
        if (payout.status === 'failed') {
          throw AppError.conflict(
            ErrorCode.CONFLICT,
            'The payout was refused by the provider. Nothing has been debited.',
            { providerRef: payout.providerRef },
          );
        }
        payoutRef = payout.providerRef;

        const [ep] = await tx
          .insert(externalPayment)
          .values({
            userId: request.userId,
            provider: 'payout',
            providerRef: payout.providerRef,
            purpose: 'payout',
            status: payout.status,
            amount: request.amount - feeMinor,
            currency: request.currency ?? DEFAULT_CURRENCY,
          })
          .returning({ id: externalPayment.id });
        if (!ep) throw AppError.validation('Failed to record the payout');
      }

      // The money movement itself: one append-only ledger row, recorded the same
      // way every other movement in the platform is (Principle IV).
      const [ledgerRow] = await tx
        .insert(ledgerRecord)
        .values({
          userId: request.userId,
          type: request.type === 'cash_in' ? 'credit_topup' : 'withdrawal',
          amount: request.amount,
          direction: request.type === 'cash_in' ? 'credit' : 'debit',
          currency: request.currency ?? DEFAULT_CURRENCY,
          referenceType: 'wallet_request',
          referenceId: request.id,
        })
        .returning({ id: ledgerRecord.id });
      if (!ledgerRow) throw AppError.validation('Failed to record the money movement');

      /**
       * The fee, as its own charge and its own ledger row.
       *
       * Deliberately NOT netted off the withdrawal row. A collector asking for
       * $200 and receiving $193 should be able to see both numbers on their
       * statement; a single $200 debit next to a $193 arrival is the shape of a
       * question to support.
       */
      if (feeMinor > 0) {
        const [c] = await tx
          .insert(charge)
          .values({
            userId: request.userId,
            actionType: 'service',
            pricingRuleSnapshot: {
              cashOutFee: true,
              grossMinor: request.amount,
              feeMinor,
              netMinor: request.amount - feeMinor,
            },
            amount: feeMinor,
            currency: request.currency ?? DEFAULT_CURRENCY,
            paymentMeans: 'wallet',
            status: 'settled',
            referenceId: request.id,
          })
          .returning({ id: charge.id });
        if (!c) throw AppError.validation('Failed to charge the cash-out fee');
        await this.ledger.record(
          {
            userId: request.userId,
            type: 'fee',
            amount: feeMinor,
            direction: 'debit',
            currency: request.currency ?? DEFAULT_CURRENCY,
            referenceType: 'charge',
            referenceId: c.id,
          },
          tx,
        );
      }

      const completedAt = new Date();
      const [updated] = await tx
        .update(walletRequest)
        .set({
          status: 'completed',
          settledLedgerId: ledgerRow.id,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(walletRequest.id, request.id))
        .returning();
      if (!updated) throw AppError.validation('Failed to complete the request');

      await this.appendEvent(tx, {
        requestId: request.id,
        actorId: actor.id,
        actorRole: actor.role,
        fromStatus: request.status,
        toStatus: 'completed',
        reason: note ?? null,
        metadata: {
          ledgerRecordId: ledgerRow.id,
          amountMinor: request.amount,
          currency: request.currency,
          feeMinor,
          netMinor: request.amount - feeMinor,
          payoutRef,
        },
      });

      await this.outbox.emit(tx, {
        aggregateType: 'wallet_request',
        aggregateId: request.id,
        eventType: 'wallet_request_completed',
        payload: {
          requestId: request.id,
          code: request.code,
          type: request.type,
          status: 'completed',
          userId: request.userId,
          amountMinor: request.amount,
          feeMinor,
          netMinor: request.amount - feeMinor,
        },
      });

      await this.audit.record(
        {
          actorId: actor.id,
          action: 'wallet_request.complete',
          targetEntity: 'wallet_request',
          targetId: request.id,
          metadata: {
            fromStatus: request.status,
            ledgerRecordId: ledgerRow.id,
            amountMinor: request.amount,
            requesterId: request.userId,
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Separation of duties.
   *
   * An admin is a customer too — they have a wallet and may raise their own
   * cash-out. Nothing about the `admin` role should let them decide their own
   * money, so the requester is barred from every reviewer action on their own
   * request regardless of role.
   */
  private assertSeparationOfDuties(requesterId: string, actor: RequestActor): void {
    if (requesterId === actor.id) {
      throw AppError.forbidden(
        'You cannot review your own wallet request. Another administrator must decide it.',
      );
    }
  }

  /**
   * The shared transition path: legality, separation of duties, the row update,
   * the append-only event, the notification and the audit record — in one
   * transaction, so a state change is never visible without its trail.
   */
  private async applyTransition(
    requestId: string,
    toStatus: WalletRequestStatus,
    actor: RequestActor,
    options: {
      reason?: string | null;
      rejectionReason?: string;
      stampReview?: boolean;
      actorRole?: string;
    },
  ) {
    return this.db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(walletRequest)
        .where(eq(walletRequest.id, requestId))
        .for('update')
        .limit(1);
      if (!request) throw AppError.notFound('Wallet request not found');

      // The requester may only cancel; every other transition is a reviewer's,
      // and a reviewer may never act on their own request.
      if (toStatus !== 'cancelled') this.assertSeparationOfDuties(request.userId, actor);

      if (!canTransition(request.status, toStatus)) {
        throw AppError.conflict(
          ErrorCode.CONFLICT,
          `A request that is ${request.status} cannot become ${toStatus}.`,
          { from: request.status, to: toStatus },
        );
      }

      const now = new Date();
      const [updated] = await tx
        .update(walletRequest)
        .set({
          status: toStatus,
          updatedAt: now,
          ...(options.stampReview ? { reviewedBy: actor.id, reviewedAt: now } : {}),
          ...(options.rejectionReason ? { rejectionReason: options.rejectionReason } : {}),
        })
        .where(eq(walletRequest.id, requestId))
        .returning();
      if (!updated) throw AppError.validation('Failed to update the request');

      await this.appendEvent(tx, {
        requestId,
        actorId: actor.id,
        actorRole: options.actorRole ?? actor.role,
        fromStatus: request.status,
        toStatus,
        reason: options.reason ?? null,
        metadata: {},
      });

      await this.outbox.emit(tx, {
        aggregateType: 'wallet_request',
        aggregateId: requestId,
        eventType: `wallet_request_${toStatus}`,
        payload: {
          requestId,
          code: request.code,
          type: request.type,
          status: toStatus,
          userId: request.userId,
          reason: options.reason ?? null,
        },
      });

      await this.audit.record(
        {
          actorId: actor.id,
          action: `wallet_request.${toStatus}`,
          targetEntity: 'wallet_request',
          targetId: requestId,
          metadata: { fromStatus: request.status, toStatus, reason: options.reason ?? null },
        },
        tx,
      );

      return updated;
    });
  }

  /** One immutable row per state change (Requirement 8: acting user, timestamp, from, to, reason). */
  private async appendEvent(
    tx: Database,
    entry: {
      requestId: string;
      actorId: string | null;
      actorRole: string | null;
      fromStatus: string | null;
      toStatus: string;
      reason: string | null;
      metadata: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.insert(walletRequestEvent).values({
      requestId: entry.requestId,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      reason: entry.reason,
      metadata: entry.metadata,
    });
  }

  /** Open requests, used by the wallet summary so a user sees pending money. */
  async openTotals(userId: string) {
    const rows = await this.db
      .select({ type: walletRequest.type, amount: walletRequest.amount })
      .from(walletRequest)
      .where(
        and(
          eq(walletRequest.userId, userId),
          inArray(walletRequest.status, [...OPEN_WALLET_REQUEST_STATUSES]),
        ),
      );
    return {
      cashInMinor: rows.filter((r) => r.type === 'cash_in').reduce((sum, r) => sum + r.amount, 0),
      cashOutMinor: rows.filter((r) => r.type === 'cash_out').reduce((sum, r) => sum + r.amount, 0),
      count: rows.length,
    };
  }
}
