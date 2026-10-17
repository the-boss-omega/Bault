import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import { loadEnv } from '@bault/config';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { pgErrorCode } from '../../shared/errors/pg-error';
import { prefixedId } from '../../shared/ids';
import { fullName } from '../../shared/names';
import { userAccount } from '../acc/acc.schema';
import { OutboxService } from '../not/outbox/outbox.service';
import { AuditService } from '../sec/audit.service';
import type { AuthUser } from '../sec/auth-context';
import { PAYMENT_ADAPTER } from '../../shared/adapters/adapters.module';
import { PaymentProviderError, paypalPayoutItemOutcome, type PaymentAdapter } from '@bault/adapters';
import { LedgerService, DEFAULT_CURRENCY } from './ledger.service';
import { charge, externalPayment, ledgerRecord, walletRequest, walletRequestEvent } from './pay.schema';
import { cashOutSettlement } from './money-terms';
import {
  canTransition,
  OPEN_WALLET_REQUEST_STATUSES,
  validateWalletRequestDraft,
  type WalletRequestDraft,
  type WalletRequestStatus,
  type WalletRequestType,
} from './wallet-request.rules';
import { MembershipService } from '../mem/membership.service';

export type RequestActor = Pick<AuthUser, 'id' | 'role'>;

/**
 * How long the payout provider may take to answer before the call is given up.
 *
 * Giving up is safe: the debit and a pending payment are committed before the
 * call, outside any transaction, so an abandoned call leaves an unknown outcome
 * for reconciliation, not money unaccounted for.
 */
export const PAYOUT_PROVIDER_TIMEOUT_MS = 20_000;

/** The `provider` of a payout an administrator made by hand (`PAYOUT_MODE=manual`). */
export const MANUAL_PAYOUT_PROVIDER = 'manual';

/**
 * The key a cash-out's payout is sent under, and recorded as.
 *
 * One per request, for the life of the request: PayPal takes it as both the
 * request id and the batch id, so sending it again (a retry, a reconciliation)
 * finds the original payout instead of making a second one.
 */
export function payoutKey(requestId: string): string {
  return `wallet_request:${requestId}`;
}

/**
 * What a provider's payout event says happened, or null for an event that is
 * not about a payout.
 *
 * PayPal reports a payout per ITEM (`PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, `.FAILED`,
 * `.RETURNED`, `.UNCLAIMED`, ...) and per BATCH. Only a denied batch settles
 * anything at batch level: a batch marked SUCCESS has been processed, and its
 * item can still be unclaimed and come back a month later.
 *
 * `reversed` is the money coming BACK (`.REFUNDED`, `.REVERSED`, `.RETURNED`).
 * Before the payout was paid that is a refusal like any other; after it was
 * paid, it is the only word that still changes anything (`recordPayoutOutcome`).
 */
export function payoutEventOutcome(type: string): 'succeeded' | 'pending' | 'failed' | 'reversed' | null {
  const t = (type ?? '').toUpperCase();
  if (t.startsWith('PAYMENT.PAYOUTS-ITEM.')) {
    const suffix = t.slice('PAYMENT.PAYOUTS-ITEM.'.length);
    if (PAYOUT_CAME_BACK.has(suffix)) return 'reversed';
    return paypalPayoutItemOutcome(suffix === 'SUCCEEDED' ? 'SUCCESS' : suffix);
  }
  if (t.startsWith('PAYMENT.PAYOUTSBATCH.')) return t.endsWith('.DENIED') ? 'failed' : 'pending';
  return null;
}

/** Payout item events that mean the money came back to Bault. */
const PAYOUT_CAME_BACK = new Set(['REFUNDED', 'REVERSED', 'RETURNED']);

export interface WalletRequestFilters {
  type?: WalletRequestType;
  status?: WalletRequestStatus;
  userId?: string;
  /** ISO date (inclusive) bounds on `created_at`. */
  from?: string;
  to?: string;
}

/**
 * Cash-in / cash-out REQUESTS.
 *
 * The invariant this service holds: **submitting a request never moves money**.
 * A submission writes one `wallet_request` row and one `wallet_request_event`
 * row and stops. The wallet balance (derived from `ledger_record` alone,
 * Principle IV) changes only when a reviewer completes an approved request
 * (`complete()`), or when a refused payout is reversed (`recordPayoutOutcome`).
 *
 * Separation of duties is enforced: the account that raised a request can never
 * be the account that reviews it, even when that account is an admin.
 *
 * Every transition appends to `wallet_request_event`, which is registered with
 * the append-only guards in `0001_append_only.sql`, so the review trail cannot
 * be edited or deleted afterwards, by anyone, including this service.
 */
@Injectable()
export class WalletRequestService {
  private readonly logger = new Logger(WalletRequestService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_ADAPTER) private readonly payment: PaymentAdapter,
    private readonly memberships: MembershipService,
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
   * and, for a cash-out, refuses an amount the wallet cannot currently cover.
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

    // Duplicate guard: an identical request that is still open. The reference
    // is part of the identity (see `isDuplicateOf`).
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
   * the review drawer names the customer it is about.
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

    // The money on its way out, where there is any: what the provider was asked
    // to pay, and where that stands.
    const [payout] = request.payoutPaymentId
      ? await this.db.select().from(externalPayment).where(eq(externalPayment.id, request.payoutPaymentId)).limit(1)
      : [];

    return {
      ...request,
      username: owner?.username ?? null,
      email: owner?.email ?? null,
      customerName: fullName(owner?.firstName, owner?.lastName),
      payout: payout ?? null,
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
   * Completion: where a wallet request moves money.
   *
   * A cash-in, and a cash-out under `PAYOUT_MODE=manual`, settle in one
   * transaction: lock the request, re-check what could have changed since
   * approval, append the ledger rows, link the request to them
   * (`settled_ledger_id`, which `lockForCompletion` refuses to set twice), and
   * record the transition.
   *
   * A cash-out paid through the provider cannot be one transaction, because the
   * money leaves through somebody else's API (see `payOut`).
   */
  async complete(requestId: string, actor: RequestActor, options: { note?: string; payoutReference?: string } = {}) {
    this.assertReviewer(actor);
    const note = options.note;
    const reference = options.payoutReference?.trim() || null;

    // The type never changes, so it can be read before the lock.
    const [peek] = await this.db
      .select({ type: walletRequest.type })
      .from(walletRequest)
      .where(eq(walletRequest.id, requestId))
      .limit(1);
    if (!peek) throw AppError.notFound('Wallet request not found');

    if (peek.type === 'cash_out') {
      if (loadEnv().PAYOUT_MODE === 'provider') {
        /**
         * A payout reference here means an administrator believes they paid
         * this by hand on a platform that pays through the provider, one click
         * from paying it twice. Refused with the reason, not ignored.
         */
        if (reference) {
          throw AppError.validation(
            'Cash-outs here are paid through the payment provider, so there is no payout reference to record. Do not pay this by hand.',
            { field: 'payoutReference' },
          );
        }
        return this.payOut(requestId, actor, note);
      }
      if (!reference) {
        throw AppError.validation(
          'Payouts are made by hand here. Record the reference of the payment you sent — a PayPal transaction id or a bank transfer reference.',
          { field: 'payoutReference' },
        );
      }
    }
    return this.settleInOneStep(requestId, actor, note, peek.type === 'cash_out' ? reference : null);
  }

  /** Lock a request and check it may still be completed. */
  private async lockForCompletion(tx: Database, requestId: string, actor: RequestActor, to: WalletRequestStatus) {
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
    if (request.status === 'paying') {
      throw AppError.conflict(
        ErrorCode.CONFLICT,
        'This payout has already been sent to the provider. It settles when the provider confirms it, or by reconciliation.',
      );
    }
    if (!canTransition(request.status, to)) {
      throw AppError.conflict(
        ErrorCode.CONFLICT,
        `A request that is ${request.status} cannot be completed; approve it first.`,
      );
    }
    if (request.settledLedgerId) {
      throw AppError.conflict(ErrorCode.CONFLICT, 'This request has already settled.');
    }
    return request;
  }

  /**
   * The debit side of a cash-out: the fee frozen now, the balance re-checked,
   * the withdrawal and the fee written. Shared by both payout modes, so a
   * cash-out moves the same money whoever sends it.
   */
  private async debitCashOut(tx: Database, request: typeof walletRequest.$inferSelect) {
    /**
     * The cash-out fee.
     *
     * Frozen here rather than at submission, because the request may have sat
     * in review across a change to the schedule. It is quoted at submission
     * from the same function, so the two agree unless the schedule moved.
     */
    const grossFeeMinor = cashOutSettlement(request.amount).feeMinor;
    // The wallet before the membership period the waiver writes to, the order
    // every other spend takes them in, so a cash-out completing while its owner
    // pays for a parcel cannot deadlock against it.
    await this.ledger.lockWallet(request.userId, tx);
    // A membership may waive it: only ever less than the fee quoted at
    // submission, never more (see `MembershipService.waive`).
    const waiver =
      grossFeeMinor > 0
        ? await this.memberships.waive(tx, request.userId, 'cash_out_fee', grossFeeMinor)
        : { waivedMinor: 0, tier: null, periodId: undefined };
    const settlement = cashOutSettlement(request.amount, waiver.waivedMinor);
    const currency = request.currency ?? DEFAULT_CURRENCY;

    // Re-check the balance at the moment money actually moves. Approval may have
    // happened when the wallet was healthy and a purchase may have drained it
    // since; completing anyway would overdraw a derived balance. The fee comes
    // out of the amount asked for, so the amount is all that has to fit.
    const balance = await this.ledger.balanceOf(request.userId, tx);
    if (balance.amount < settlement.grossMinor) {
      throw AppError.conflict(
        ErrorCode.INSUFFICIENT_BALANCE,
        'The balance no longer covers this cash-out; it cannot be completed.',
        { availableMinor: balance.amount, requestedMinor: request.amount, feeMinor: settlement.feeMinor },
      );
    }

    // The withdrawal is what the provider pays out: the net, not the gross.
    // With the fee row below it adds up to the gross, so the fee is taken once.
    const [ledgerRow] = await tx
      .insert(ledgerRecord)
      .values({
        userId: request.userId,
        type: 'withdrawal',
        amount: settlement.netMinor,
        direction: 'debit',
        currency,
        referenceType: 'wallet_request',
        referenceId: request.id,
      })
      .returning({ id: ledgerRecord.id });
    if (!ledgerRow) throw AppError.validation('Failed to record the money movement');

    /**
     * The fee, as its own charge and its own ledger row.
     *
     * Not netted into the withdrawal row, so a collector asking for $200 and
     * receiving $193 sees both numbers on their statement, and the two rows
     * together are exactly the $200 the quote showed.
     */
    if (settlement.feeMinor > 0) {
      const [c] = await tx
        .insert(charge)
        .values({
          userId: request.userId,
          actionType: 'service',
          pricingRuleSnapshot: {
            cashOutFee: true,
            grossMinor: settlement.grossMinor,
            feeMinor: settlement.feeMinor,
            netMinor: settlement.netMinor,
            ...(waiver.waivedMinor > 0 ? { membershipWaiver: waiver } : {}),
          },
          amount: settlement.feeMinor,
          currency,
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
          amount: settlement.feeMinor,
          direction: 'debit',
          currency,
          referenceType: 'charge',
          referenceId: c.id,
        },
        tx,
      );
    }

    return { ledgerRowId: ledgerRow.id, settlement, currency, waiver };
  }

  /** A cash-in, or a cash-out paid by hand: everything in one transaction. */
  private async settleInOneStep(requestId: string, actor: RequestActor, note: string | undefined, reference: string | null) {
    return this.db.transaction(async (tx) => {
      const request = await this.lockForCompletion(tx as Database, requestId, actor, 'completed');
      const currency = request.currency ?? DEFAULT_CURRENCY;

      let ledgerRowId: string;
      let feeMinor = 0;
      let netMinor = request.amount;
      let paymentId: string | null = null;

      if (request.type === 'cash_out') {
        const debit = await this.debitCashOut(tx as Database, request);
        ledgerRowId = debit.ledgerRowId;
        feeMinor = debit.settlement.feeMinor;
        netMinor = debit.settlement.netMinor;

        /**
         * The payment an administrator made by hand, written down as one.
         *
         * Same row a provider payout gets, so reconciliation reads one table
         * whichever way the money left. The reference is unique per provider:
         * one bank transfer cannot be recorded as paying two cash-outs.
         */
        const [taken] = await tx
          .select({ id: externalPayment.id })
          .from(externalPayment)
          .where(and(eq(externalPayment.provider, MANUAL_PAYOUT_PROVIDER), eq(externalPayment.externalRef, reference!)))
          .limit(1);
        if (taken) {
          throw AppError.conflict(ErrorCode.CONFLICT, 'That payment reference is already recorded against another payout.', {
            field: 'payoutReference',
          });
        }
        let ep: { id: string } | undefined;
        try {
          [ep] = await tx
            .insert(externalPayment)
            .values({
              userId: request.userId,
              provider: MANUAL_PAYOUT_PROVIDER,
              providerRef: payoutKey(request.id),
              externalRef: reference,
              purpose: 'payout',
              status: 'succeeded',
              amount: netMinor,
              currency,
            })
            .returning({ id: externalPayment.id });
        } catch (e) {
          if (pgErrorCode(e) === '23505') {
            throw AppError.conflict(ErrorCode.CONFLICT, 'That payment reference is already recorded against another payout.', {
              field: 'payoutReference',
            });
          }
          throw e;
        }
        if (!ep) throw AppError.validation('Failed to record the payout');
        paymentId = ep.id;
      } else {
        // The money movement itself: one append-only ledger row, recorded the
        // same way every other movement in the platform is (Principle IV).
        const [ledgerRow] = await tx
          .insert(ledgerRecord)
          .values({
            userId: request.userId,
            type: 'credit_topup',
            amount: request.amount,
            direction: 'credit',
            currency,
            referenceType: 'wallet_request',
            referenceId: request.id,
          })
          .returning({ id: ledgerRecord.id });
        if (!ledgerRow) throw AppError.validation('Failed to record the money movement');
        ledgerRowId = ledgerRow.id;
      }

      const completedAt = new Date();
      const [updated] = await tx
        .update(walletRequest)
        .set({
          status: 'completed',
          settledLedgerId: ledgerRowId,
          payoutPaymentId: paymentId,
          payoutReference: reference,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(walletRequest.id, request.id))
        .returning();
      if (!updated) throw AppError.validation('Failed to complete the request');

      await this.appendEvent(tx as Database, {
        requestId: request.id,
        actorId: actor.id,
        actorRole: actor.role,
        fromStatus: request.status,
        toStatus: 'completed',
        reason: note ?? null,
        metadata: {
          ledgerRecordId: ledgerRowId,
          amountMinor: request.amount,
          currency: request.currency,
          feeMinor,
          netMinor,
          ...(paymentId ? { paymentId, payoutReference: reference, payoutMode: 'manual' } : {}),
        },
      });
      await this.emitCompleted(tx as Database, updated, feeMinor, netMinor);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'wallet_request.complete',
          targetEntity: 'wallet_request',
          targetId: request.id,
          metadata: {
            fromStatus: request.status,
            ledgerRecordId: ledgerRowId,
            amountMinor: request.amount,
            requesterId: request.userId,
            ...(reference ? { payoutReference: reference } : {}),
          },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * A cash-out paid through the provider, in three steps. The provider call is
   * outside any transaction, so a failure after the provider paid cannot roll
   * back the debit, and a hung provider holds no connection or wallet lock.
   *
   *   1. Under the request lock: debit the wallet, write a `pending` payment and
   *      mark the request `paying`. Commit. From here the money is accounted
   *      for whatever happens next.
   *   2. Ask the provider, outside any transaction, for at most
   *      `PAYOUT_PROVIDER_TIMEOUT_MS`.
   *   3. Record its answer in a second transaction (`recordPayoutOutcome`):
   *      paid → `completed`; refused → the debit reversed by a compensating
   *      credit and `payout_failed`; accepted but not yet paid, or no answer at
   *      all → left `paying` and `pending`, for the provider's webhook or for
   *      reconciliation to settle. An unknown outcome is never treated as a
   *      refusal: the provider may have paid before the line went quiet.
   */
  private async payOut(requestId: string, actor: RequestActor, note: string | undefined) {
    const started = await this.db.transaction(async (tx) => {
      const request = await this.lockForCompletion(tx as Database, requestId, actor, 'paying');
      const debit = await this.debitCashOut(tx as Database, request);

      const [payment] = await tx
        .insert(externalPayment)
        .values({
          userId: request.userId,
          provider: this.payment.providerName,
          // The key the provider is sent, and echoes back in its webhooks.
          providerRef: payoutKey(request.id),
          purpose: 'payout',
          status: 'pending',
          amount: debit.settlement.netMinor,
          currency: debit.currency,
        })
        .returning();
      if (!payment) throw AppError.validation('Failed to record the payout');

      const now = new Date();
      const [updated] = await tx
        .update(walletRequest)
        .set({ status: 'paying', settledLedgerId: debit.ledgerRowId, payoutPaymentId: payment.id, updatedAt: now })
        .where(eq(walletRequest.id, request.id))
        .returning();
      if (!updated) throw AppError.validation('Failed to start the payout');

      await this.appendEvent(tx as Database, {
        requestId: request.id,
        actorId: actor.id,
        actorRole: actor.role,
        fromStatus: request.status,
        toStatus: 'paying',
        reason: note ?? null,
        metadata: {
          ledgerRecordId: debit.ledgerRowId,
          paymentId: payment.id,
          amountMinor: request.amount,
          currency: request.currency,
          feeMinor: debit.settlement.feeMinor,
          netMinor: debit.settlement.netMinor,
          // So a refused payout can give the member's allowance back.
          waivedMinor: debit.waiver.waivedMinor,
          waiverPeriodId: debit.waiver.periodId ?? null,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'wallet_request.pay',
          targetEntity: 'wallet_request',
          targetId: request.id,
          metadata: { fromStatus: request.status, paymentId: payment.id, amountMinor: request.amount, requesterId: request.userId },
        },
        tx,
      );
      return { request: updated, payment };
    });

    const { request, payment } = started;
    let answer: { status: 'succeeded' | 'pending' | 'failed'; externalRef: string | null } | null = null;
    let reason: string | null = null;
    try {
      const result = await this.payment.createPayout({
        userId: request.userId,
        amountMinor: payment.amount,
        currency: payment.currency,
        idempotencyKey: payment.providerRef,
        destinationToken: request.destinationAccount ?? '',
        signal: AbortSignal.timeout(PAYOUT_PROVIDER_TIMEOUT_MS),
      });
      answer = { status: result.status, externalRef: result.providerRef };
    } catch (e) {
      reason = e instanceof Error ? e.message.slice(0, 200) : 'unknown';
      // Only a provider that answered "no" is a refusal. Silence is not.
      if (e instanceof PaymentProviderError && e.refused) answer = { status: 'failed', externalRef: null };
    }

    if (!answer) {
      throw new AppError(
        ErrorCode.PROVIDER_UNAVAILABLE,
        `The payout provider did not answer, so this payout's outcome is unknown. ${request.code} stays debited and paying; ` +
          'the provider\'s notification or a reconciliation will settle it. Do not pay it again by hand.',
        502,
        { requestId: request.id, paymentId: payment.id, reason },
      );
    }

    const settled = await this.recordPayoutOutcome(payment.id, answer, { source: 'provider', actor, reason });
    if (answer.status === 'failed') {
      throw AppError.conflict(
        ErrorCode.CONFLICT,
        `The provider refused this payout. ${request.code} is closed as payout failed and the collector's money is back in their wallet.`,
        { requestId: request.id, paymentId: payment.id, reason },
      );
    }
    return settled ?? request;
  }

  /**
   * Record what became of a payout (from the provider's answer, its webhook,
   * or reconciliation) exactly once.
   *
   * Only a payment still `pending` on a request still `paying` changes: the
   * first word on a payout is the one that counts, and every later one (a
   * redelivered webhook, a reconciliation racing the provider's answer) finds
   * it settled and does nothing, and says so in the log. The ledger is
   * append-only, so a refusal is undone by a compensating `payout_reversal`
   * credit for everything the cash-out debited, never by touching the debit.
   *
   * The one word that still counts after a payout was PAID is the money coming
   * back (`reversed`: PayPal refunded, reversed or returned the item). That is
   * undone exactly like a refusal, once: see `reversePaidPayout`.
   */
  async recordPayoutOutcome(
    paymentId: string,
    outcome: { status: 'succeeded' | 'pending' | 'failed' | 'reversed'; externalRef: string | null },
    context: { source: 'provider' | 'webhook' | 'reconcile'; actor?: RequestActor | null; webhookEventId?: string | null; reason?: string | null },
  ) {
    return this.db.transaction(async (tx) => {
      // The request, then its payment, then the wallet: the order `payOut` takes them in.
      const [request] = await tx
        .select()
        .from(walletRequest)
        .where(eq(walletRequest.payoutPaymentId, paymentId))
        .for('update')
        .limit(1);
      if (!request) return null;
      const [payment] = await tx
        .select()
        .from(externalPayment)
        .where(eq(externalPayment.id, paymentId))
        .for('update')
        .limit(1);
      if (!payment) return null;
      if (payment.status !== 'pending' || request.status !== 'paying') {
        if (outcome.status === 'reversed' && payment.status === 'succeeded' && request.status === 'completed') {
          return this.reversePaidPayout(tx as Database, request, payment, outcome.externalRef, context);
        }
        if (outcome.status !== 'pending' && outcome.status !== payment.status) {
          // Acknowledged and changed nothing: the first word counted. Logged so
          // a provider contradicting what was recorded is seen by somebody.
          this.logger.warn(
            `Payout ${paymentId} (${request.code}) is ${payment.status}; a later "${outcome.status}" from ${context.source} ` +
              `changed nothing${context.reason ? ` (${context.reason})` : ''}`,
          );
        }
        return request;
      }
      // Before the provider paid, money coming back is a refusal.
      const status = outcome.status === 'reversed' ? 'failed' : outcome.status;

      const externalRef = outcome.externalRef ?? payment.externalRef;
      const now = new Date();

      if (status === 'pending') {
        // Nothing has happened yet, but the provider has said what it calls the
        // payout, which is what a later lookup needs.
        if (externalRef && externalRef !== payment.externalRef) {
          await tx.update(externalPayment).set({ externalRef, updatedAt: now }).where(eq(externalPayment.id, paymentId));
          const [updated] = await tx
            .update(walletRequest)
            .set({ payoutReference: externalRef, updatedAt: now })
            .where(eq(walletRequest.id, request.id))
            .returning();
          return updated ?? request;
        }
        return request;
      }

      await tx
        .update(externalPayment)
        .set({
          status,
          externalRef,
          webhookEventId: context.webhookEventId ?? payment.webhookEventId,
          updatedAt: now,
        })
        .where(eq(externalPayment.id, paymentId));

      const actorId = context.actor?.id ?? null;
      const actorRole = context.actor?.role ?? 'system';
      const meta = await this.payingMetadata(tx as Database, request.id);
      const feeMinor = Number(meta.feeMinor ?? 0);
      const netMinor = Number(meta.netMinor ?? payment.amount);

      if (status === 'succeeded') {
        const [updated] = await tx
          .update(walletRequest)
          .set({ status: 'completed', payoutReference: externalRef, completedAt: now, updatedAt: now })
          .where(eq(walletRequest.id, request.id))
          .returning();
        if (!updated) throw AppError.validation('Failed to complete the request');
        await this.appendEvent(tx as Database, {
          requestId: request.id,
          actorId,
          actorRole,
          fromStatus: 'paying',
          toStatus: 'completed',
          reason: null,
          metadata: { source: context.source, paymentId, externalRef, webhookEventId: context.webhookEventId ?? null },
        });
        await this.emitCompleted(tx as Database, updated, feeMinor, netMinor);
        await this.audit.record(
          {
            actorId,
            action: 'wallet_request.complete',
            targetEntity: 'wallet_request',
            targetId: request.id,
            metadata: { fromStatus: 'paying', source: context.source, paymentId, externalRef, requesterId: request.userId },
          },
          tx,
        );
        return updated;
      }

      // Refused or returned: the money never reached the collector, so all of
      // it comes back (the withdrawal and the fee, which together are the
      // amount they asked for).
      await this.ledger.lockWallet(request.userId, tx as Database);
      await this.ledger.record(
        {
          userId: request.userId,
          type: 'payout_reversal',
          amount: request.amount,
          direction: 'credit',
          currency: request.currency ?? DEFAULT_CURRENCY,
          referenceType: 'wallet_request',
          referenceId: request.id,
        },
        tx,
      );
      // A free cash-out the membership paid for was not used either.
      if (typeof meta.waiverPeriodId === 'string' && Number(meta.waivedMinor ?? 0) > 0) {
        await this.memberships.restoreCounted(tx as Database, meta.waiverPeriodId, 'cash_out_fee');
      }
      const [updated] = await tx
        .update(walletRequest)
        .set({ status: 'payout_failed', payoutReference: externalRef, updatedAt: now })
        .where(eq(walletRequest.id, request.id))
        .returning();
      if (!updated) throw AppError.validation('Failed to record the failed payout');
      await this.appendEvent(tx as Database, {
        requestId: request.id,
        actorId,
        actorRole,
        fromStatus: 'paying',
        toStatus: 'payout_failed',
        reason: context.reason ?? 'The provider did not pay this out.',
        metadata: {
          source: context.source,
          paymentId,
          externalRef,
          webhookEventId: context.webhookEventId ?? null,
          reversedMinor: request.amount,
        },
      });
      await this.outbox.emit(tx, {
        aggregateType: 'wallet_request',
        aggregateId: request.id,
        eventType: 'wallet_request_payout_failed',
        payload: {
          requestId: request.id,
          code: request.code,
          type: request.type,
          status: 'payout_failed',
          userId: request.userId,
          amountMinor: request.amount,
        },
      });
      await this.audit.record(
        {
          actorId,
          action: 'wallet_request.payout_failed',
          targetEntity: 'wallet_request',
          targetId: request.id,
          metadata: { source: context.source, paymentId, reversedMinor: request.amount, requesterId: request.userId },
        },
        tx,
      );
      return updated;
    });
  }

  /** What the cash-out recorded when it was sent: its fee, net and any membership waiver. */
  private async payingMetadata(tx: Database, requestId: string): Promise<Record<string, unknown>> {
    const [started] = await tx
      .select({ metadata: walletRequestEvent.metadata })
      .from(walletRequestEvent)
      .where(and(eq(walletRequestEvent.requestId, requestId), eq(walletRequestEvent.toStatus, 'paying')))
      .limit(1);
    return (started?.metadata as Record<string, unknown> | null) ?? {};
  }

  /**
   * A payout the provider paid, and then took back (refunded, reversed or
   * returned): the money is with Bault again and not with the collector.
   *
   * Undone the way a refusal is, because in the end the cash-out did not
   * happen: one `payout_reversal` credit for everything it debited (the
   * withdrawal and the fee), the membership's free cash-out given back, the
   * request closed as `payout_failed` and the payment marked `reversed`.
   *
   * Once only. The caller holds the request and the payment FOR UPDATE and has
   * seen the payment `succeeded`; it is `reversed` when this commits, so a
   * redelivered event, or a second one for the same item, finds nothing to do.
   * The event's id goes on the payment, so the webhook dedupe also knows it.
   */
  private async reversePaidPayout(
    tx: Database,
    request: typeof walletRequest.$inferSelect,
    payment: typeof externalPayment.$inferSelect,
    externalRefIn: string | null,
    context: { source: 'provider' | 'webhook' | 'reconcile'; actor?: RequestActor | null; webhookEventId?: string | null; reason?: string | null },
  ) {
    const now = new Date();
    const externalRef = externalRefIn ?? payment.externalRef;
    const actorId = context.actor?.id ?? null;
    const actorRole = context.actor?.role ?? 'system';
    const meta = await this.payingMetadata(tx, request.id);

    await this.ledger.lockWallet(request.userId, tx);
    await this.ledger.record(
      {
        userId: request.userId,
        type: 'payout_reversal',
        amount: request.amount,
        direction: 'credit',
        currency: request.currency ?? DEFAULT_CURRENCY,
        referenceType: 'wallet_request',
        referenceId: request.id,
      },
      tx,
    );
    if (typeof meta.waiverPeriodId === 'string' && Number(meta.waivedMinor ?? 0) > 0) {
      await this.memberships.restoreCounted(tx, meta.waiverPeriodId, 'cash_out_fee');
    }
    await tx
      .update(externalPayment)
      .set({
        status: 'reversed',
        externalRef,
        webhookEventId: context.webhookEventId ?? payment.webhookEventId,
        updatedAt: now,
      })
      .where(eq(externalPayment.id, payment.id));
    const [updated] = await tx
      .update(walletRequest)
      .set({ status: 'payout_failed', updatedAt: now })
      .where(eq(walletRequest.id, request.id))
      .returning();
    if (!updated) throw AppError.validation('Failed to record the reversed payout');
    await this.appendEvent(tx, {
      requestId: request.id,
      actorId,
      actorRole,
      fromStatus: 'completed',
      toStatus: 'payout_failed',
      reason: context.reason ?? 'The provider took this payout back after paying it.',
      metadata: {
        source: context.source,
        paymentId: payment.id,
        externalRef,
        webhookEventId: context.webhookEventId ?? null,
        reversedMinor: request.amount,
        afterPaid: true,
      },
    });
    await this.outbox.emit(tx, {
      aggregateType: 'wallet_request',
      aggregateId: request.id,
      eventType: 'wallet_request_payout_failed',
      payload: {
        requestId: request.id,
        code: request.code,
        type: request.type,
        status: 'payout_failed',
        userId: request.userId,
        amountMinor: request.amount,
      },
    });
    await this.audit.record(
      {
        actorId,
        action: 'wallet_request.payout_reversed',
        targetEntity: 'wallet_request',
        targetId: request.id,
        metadata: {
          source: context.source,
          paymentId: payment.id,
          webhookEventId: context.webhookEventId ?? null,
          reversedMinor: request.amount,
          requesterId: request.userId,
        },
      },
      tx,
    );
    this.logger.warn(`Payout ${payment.id} (${request.code}) came back after it was paid; ${request.amount} credited back`);
    return updated;
  }

  /**
   * Ask the provider again about payouts that have been pending too long.
   *
   * The webhook is how a payout normally settles, and webhooks get lost. Every
   * pending payout older than `olderThanMinutes` is looked up by the provider's
   * batch id when it gave one, or, when its answer never arrived, by sending
   * the same payout again under the same key, which the provider recognises
   * rather than paying twice. Whatever it says is recorded through
   * `recordPayoutOutcome`; an error is recorded as nothing, because on a retry
   * it proves nothing either way.
   *
   * Admin-only and on demand; no worker job runs it.
   */
  async reconcilePayouts(actor: RequestActor, options: { olderThanMinutes?: number; limit?: number } = {}) {
    this.assertReviewer(actor);
    const olderThan = Math.max(0, options.olderThanMinutes ?? 15);
    const cutoff = new Date(Date.now() - olderThan * 60_000);
    const stale = await this.db
      .select({ payment: externalPayment, request: walletRequest })
      .from(externalPayment)
      .innerJoin(walletRequest, eq(walletRequest.payoutPaymentId, externalPayment.id))
      .where(
        and(
          eq(externalPayment.purpose, 'payout'),
          eq(externalPayment.status, 'pending'),
          ne(externalPayment.provider, MANUAL_PAYOUT_PROVIDER),
          lte(externalPayment.updatedAt, cutoff),
        ),
      )
      .orderBy(externalPayment.updatedAt)
      .limit(Math.min(Math.max(1, options.limit ?? 50), 200));

    const summary = { checked: 0, succeeded: 0, failed: 0, pending: 0, unanswered: 0 };
    for (const { payment, request } of stale) {
      summary.checked += 1;
      // Never re-send on a different rail from the one that took it.
      if (payment.provider !== this.payment.providerName) {
        summary.unanswered += 1;
        continue;
      }
      let result;
      try {
        const signal = AbortSignal.timeout(PAYOUT_PROVIDER_TIMEOUT_MS);
        result = payment.externalRef
          ? await this.payment.getPayout(payment.externalRef, { signal })
          : await this.payment.createPayout({
              userId: request.userId,
              amountMinor: payment.amount,
              currency: payment.currency,
              idempotencyKey: payment.providerRef,
              destinationToken: request.destinationAccount ?? '',
              signal,
            });
      } catch {
        summary.unanswered += 1;
        continue;
      }
      await this.recordPayoutOutcome(
        payment.id,
        { status: result.status, externalRef: result.providerRef },
        { source: 'reconcile', actor },
      );
      summary[result.status] += 1;
    }
    return summary;
  }

  /**
   * Apply a payout event the provider sent us.
   *
   * Matched by the key Bault sent (PayPal echoes it as the item's
   * `sender_item_id` and the batch's `sender_batch_id`), or by the batch id it
   * returned. The caller has already authenticated the delivery and checked
   * `event.id` against the events already applied.
   */
  async applyPayoutEvent(event: { id: string; type: string; data: Record<string, unknown> }): Promise<'applied' | 'unmatched' | 'ignored'> {
    const status = payoutEventOutcome(event.type);
    if (!status) return 'ignored';

    const data = event.data ?? {};
    const pick = (...path: string[]): string | null => {
      let cur: unknown = data;
      for (const key of path) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[key] : undefined;
      return typeof cur === 'string' && cur.trim() !== '' ? cur : null;
    };
    const keys = [pick('payout_item', 'sender_item_id'), pick('sender_item_id'), pick('batch_header', 'sender_batch_header', 'sender_batch_id')].filter(
      (k): k is string => k !== null,
    );
    const batchId = pick('payout_batch_id') ?? pick('batch_header', 'payout_batch_id');

    const matches = [
      ...(keys.length > 0 ? [inArray(externalPayment.providerRef, keys)] : []),
      ...(batchId ? [eq(externalPayment.externalRef, batchId)] : []),
    ];
    if (matches.length === 0) return 'unmatched';
    const [payment] = await this.db
      .select({ id: externalPayment.id })
      .from(externalPayment)
      .where(and(eq(externalPayment.purpose, 'payout'), or(...matches)))
      .limit(1);
    if (!payment) return 'unmatched';

    await this.recordPayoutOutcome(
      payment.id,
      { status, externalRef: batchId },
      { source: 'webhook', webhookEventId: status === 'pending' ? null : event.id, reason: `Provider event ${event.type}` },
    );
    return 'applied';
  }

  /** The notification and outbox row for a completed request, the same whichever path completed it. */
  private async emitCompleted(tx: Database, request: typeof walletRequest.$inferSelect, feeMinor: number, netMinor: number) {
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
        netMinor,
      },
    });
  }

  /**
   * Separation of duties.
   *
   * An admin is a customer too and may raise their own cash-out, so the
   * requester is barred from every reviewer action on their own request
   * regardless of role.
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
   * the append-only event, the notification and the audit record, in one
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

  /** One immutable row per state change: acting user, timestamp, from, to, reason. */
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
