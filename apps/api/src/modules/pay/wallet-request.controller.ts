import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { WalletRequestService } from './wallet-request.service';
import {
  FUNDING_SOURCES,
  MAX_NOTE_LENGTH,
  MAX_REFERENCE_LENGTH,
  MAX_REJECTION_REASON_LENGTH,
  SUPPORTED_CURRENCIES,
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
  /** Object key of an already-uploaded document — never the document itself. */
  @IsOptional() @IsString() @MaxLength(400) documentKey?: string;
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

/**
 * Wallet request endpoints.
 *
 * `/finance/wallet-requests*` is the customer surface: submit, list your own,
 * open one, cancel your own. `/admin/wallet-requests*` is the review surface and
 * carries `@Roles('admin')` — the guard is the enforcement, and the service
 * re-checks separation of duties so an admin still cannot decide their own.
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
  queue(
    @CurrentUser() user: AuthUser,
    @Query('type') type?: WalletRequestType,
    @Query('status') status?: WalletRequestStatus,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.requests.listForReview(user, { type, status, userId, from, to });
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

  /** The only endpoint in the platform that settles a wallet request. */
  @Roles('admin')
  @Post('admin/wallet-requests/:id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ReviewNoteDto) {
    return this.requests.complete(id, user, dto.note);
  }
}
