import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { IsObjectKey } from '../../shared/object-key';
import { WalletRequestService } from './wallet-request.service';
import {
  FUNDING_SOURCES,
  MAX_NOTE_LENGTH,
  MAX_REFERENCE_LENGTH,
  MAX_REJECTION_REASON_LENGTH,
  SUPPORTED_CURRENCIES,
  WALLET_REQUEST_TRANSITIONS,
  type WalletRequestStatus,
  type WalletRequestType,
} from './wallet-request.rules';

/**
 * Cash-in and cash-out share one submission shape. Which fields are REQUIRED
 * depends on the type, and that rule lives in `validateWalletRequestDraft` rather
 * than in decorators, so the API and the SPA enforce exactly the same thing.
 */
class SubmitWalletRequestDto {
  @IsIn(['cash_in', 'cash_out']) type!: WalletRequestType;
  @IsInt() @IsPositive() amountMinor!: number;
  @IsOptional() @IsIn([...SUPPORTED_CURRENCIES]) currency?: string;
  @IsOptional() @IsIn([...FUNDING_SOURCES]) fundingSource?: string;
  @IsOptional() @IsString() @MaxLength(140) destinationAccount?: string;
  @IsOptional() @IsString() @MaxLength(140) beneficiaryName?: string;
  @IsOptional() @IsString() @MaxLength(MAX_REFERENCE_LENGTH) reference?: string;
  /** Object key of an already-uploaded document, never the document itself. */
  @IsOptional() @IsString() @MaxLength(400) @IsObjectKey() documentKey?: string;
  @IsOptional() @IsString() @MaxLength(MAX_NOTE_LENGTH) notes?: string;
}

class CancelDto {
  @IsOptional() @IsString() @MaxLength(MAX_NOTE_LENGTH) reason?: string;
}

class ReviewNoteDto {
  @IsOptional() @IsString() @MaxLength(MAX_NOTE_LENGTH) note?: string;
}

class RejectDto {
  @IsString() @MinLength(1) @MaxLength(MAX_REJECTION_REASON_LENGTH) reason!: string;
}

class CompleteDto extends ReviewNoteDto {
  /**
   * With `PAYOUT_MODE=manual`, the reference of the payment the administrator
   * made by hand (a PayPal transaction id, a bank transfer reference). Required
   * for a cash-out in that mode, refused in the provider mode.
   */
  @IsOptional() @IsString() @MaxLength(MAX_REFERENCE_LENGTH) payoutReference?: string;
}

/**
 * A date the review queue can filter on: a day (`2026-10-15`, as the date
 * inputs send it) or a moment (`2026-10-15T09:30:00Z`). The pattern keeps out
 * the ISO forms `new Date()` cannot read (week and ordinal dates); strict
 * ISO 8601 keeps out days that do not exist (`2026-02-30`).
 */
const QUEUE_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const queueDate = (field: string) => ({ message: `${field} has to be a date, written YYYY-MM-DD or as an ISO 8601 time.` });

/**
 * The review queue's filters, checked here so a bad one is a 400 that names
 * it. An unreadable date used to reach `new Date()` and fail inside the query
 * as a 500.
 */
class ReviewQueueQuery {
  @IsOptional() @IsIn(['cash_in', 'cash_out']) type?: WalletRequestType;
  @IsOptional() @IsIn(Object.keys(WALLET_REQUEST_TRANSITIONS)) status?: WalletRequestStatus;
  @IsOptional() @IsString() @MaxLength(64) userId?: string;
  @IsOptional() @Matches(QUEUE_DATE, queueDate('from')) @IsISO8601({ strict: true }, queueDate('from')) from?: string;
  @IsOptional() @Matches(QUEUE_DATE, queueDate('to')) @IsISO8601({ strict: true }, queueDate('to')) to?: string;
}

class ReconcileDto {
  /** Only payouts pending at least this long are asked about. */
  @IsOptional() @IsInt() @Min(0) @Max(10_080) olderThanMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(200) limit?: number;
}

/**
 * Wallet request endpoints.
 *
 * `/finance/wallet-requests*` is the customer surface: submit, list your own,
 * open one, cancel your own. `/admin/wallet-requests*` is the review surface and
 * carries `@Roles('admin')`; the service re-checks separation of duties so an
 * admin still cannot decide their own.
 */
@ApiTags('PAY')
@Controller()
export class WalletRequestController {
  constructor(private readonly requests: WalletRequestService) {}

  /* ---- Customer ---- */

  @Post('finance/wallet-requests')
  submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitWalletRequestDto) {
    return this.requests.submit(user.id, {
      type: dto.type,
      amountMinor: dto.amountMinor,
      currency: dto.currency ?? 'USD',
      fundingSource: dto.fundingSource ?? null,
      destinationAccount: dto.destinationAccount ?? null,
      beneficiaryName: dto.beneficiaryName ?? null,
      reference: dto.reference ?? null,
      documentKey: dto.documentKey ?? null,
      notes: dto.notes ?? null,
    });
  }

  @Get('finance/wallet-requests')
  listMine(@CurrentUser() user: AuthUser) {
    return this.requests.listMine(user.id);
  }

  @Get('finance/wallet-requests/:id')
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.requests.detail(id, user);
  }

  @Post('finance/wallet-requests/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.requests.cancel(id, user, dto.reason);
  }

  /* ---- Review (admin only) ---- */

  @Roles('admin')
  @Get('admin/wallet-requests')
  queue(@CurrentUser() user: AuthUser, @Query() q: ReviewQueueQuery) {
    return this.requests.listForReview(user, { type: q.type, status: q.status, userId: q.userId, from: q.from, to: q.to });
  }

  @Roles('admin')
  @Get('admin/wallet-requests/:id')
  reviewDetail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.requests.detail(id, user);
  }

  @Roles('admin')
  @Post('admin/wallet-requests/:id/review')
  markUnderReview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.requests.markUnderReview(id, user);
  }

  @Roles('admin')
  @Post('admin/wallet-requests/:id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReviewNoteDto) {
    return this.requests.approve(id, user, dto.note);
  }

  @Roles('admin')
  @Post('admin/wallet-requests/:id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.requests.reject(id, user, dto.reason);
  }

  @Roles('admin')
  @Post('admin/wallet-requests/:id/processing')
  processing(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReviewNoteDto) {
    return this.requests.markProcessing(id, user, dto.note);
  }

  /**
   * Completes an approved request and moves its money. A provider payout then
   * settles by webhook or by `admin/payouts/reconcile`.
   */
  @Roles('admin')
  @Post('admin/wallet-requests/:id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CompleteDto) {
    return this.requests.complete(id, user, { note: dto.note, payoutReference: dto.payoutReference });
  }

  /**
   * Ask the payout provider again about cash-outs still `paying`.
   *
   * For a payout whose webhook never came, or whose answer was lost. Safe to run
   * any number of times: a payout settles once.
   */
  @Roles('admin')
  @Post('admin/payouts/reconcile')
  reconcile(@CurrentUser() user: AuthUser, @Body() dto: ReconcileDto) {
    return this.requests.reconcilePayouts(user, { olderThanMinutes: dto.olderThanMinutes, limit: dto.limit });
  }
}
