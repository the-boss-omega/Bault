import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsIn, IsOptional, IsPositive, IsString } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { OfferService } from './offer.service';
import { AppError } from '../../shared/errors/app-error';

class SubmitOfferDto {
  @IsInt() @IsPositive() amount!: number;
}
class RespondDto {
  @IsIn(['accept', 'reject', 'counter']) action!: 'accept' | 'reject' | 'counter';
  @IsOptional() @IsInt() @IsPositive() amount?: number;
}

/** MKT offers (T085). */
@ApiTags('MKT')
@Controller('marketplace')
export class OfferController {
  constructor(private readonly offers: OfferService) {}

  @Post('listings/:id/offers')
  submit(@CurrentUser() user: AuthUser, @Param('id') listingId: string, @Body() dto: SubmitOfferDto) {
    return this.offers.submit(user.id, listingId, dto.amount);
  }

  @Post('offers/:offerId/respond')
  respond(
    @CurrentUser() user: AuthUser,
    @Param('offerId') offerId: string,
    @Body() dto: RespondDto,
    @Headers('idempotency-key') key: string,
  ) {
    if (dto.action === 'accept') return this.offers.accept(user.id, offerId, key ?? `offer-${offerId}`);
    if (dto.action === 'reject') return this.offers.reject(user.id, offerId);
    if (dto.amount == null) throw AppError.validation('Counter requires an amount');
    return this.offers.counter(user.id, offerId, dto.amount);
  }
}
