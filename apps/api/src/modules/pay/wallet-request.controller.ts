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

class SubmitWalletRequestDto {
  @IsIn(['cash_in', 'cash_out']) type!: WalletRequestType;
  @IsInt() @IsPositive() amountMinor!: number;
  @IsOptional() @IsIn([...SUPPORTED_CURRENCIES]) currency?: string;
  @IsOptional() @IsIn([...FUNDING_SOURCES]) fundingSource?: string;
  @IsOptional() @IsString() @MaxLength(140) destinationAccount?: string;
  @IsOptional() @IsString() @MaxLength(140) beneficiaryName?: string;
  @IsOptional() @IsString() @MaxLength(MAX_REFERENCE_LENGTH) reference?: string;
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
  @IsOptional() @IsString() @MaxLength(MAX_REFERENCE_LENGTH) payoutReference?: string;
}

const QUEUE_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const queueDate = (field: string) => ({ message: `${field} has to be a date, written YYYY-MM-DD or as an ISO 8601 time.` });

class ReviewQueueQuery {
  @IsOptional() @IsIn(['cash_in', 'cash_out']) type?: WalletRequestType;
  @IsOptional() @IsIn(Object.keys(WALLET_REQUEST_TRANSITIONS)) status?: WalletRequestStatus;
  @IsOptional() @IsString() @MaxLength(64) userId?: string;
  @IsOptional() @Matches(QUEUE_DATE, queueDate('from')) @IsISO8601({ strict: true }, queueDate('from')) from?: string;
  @IsOptional() @Matches(QUEUE_DATE, queueDate('to')) @IsISO8601({ strict: true }, queueDate('to')) to?: string;
}

class ReconcileDto {
  @IsOptional() @IsInt() @Min(0) @Max(10_080) olderThanMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(200) limit?: number;
}

@ApiTags('PAY')
@Controller()
export class WalletRequestController {
  constructor(private readonly requests: WalletRequestService) {}

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

  @Roles('admin')
  @Post('admin/wallet-requests/:id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CompleteDto) {
    return this.requests.complete(id, user, { note: dto.note, payoutReference: dto.payoutReference });
  }

  @Roles('admin')
  @Post('admin/payouts/reconcile')
  reconcile(@CurrentUser() user: AuthUser, @Body() dto: ReconcileDto) {
    return this.requests.reconcilePayouts(user, { olderThanMinutes: dto.olderThanMinutes, limit: dto.limit });
  }
}
