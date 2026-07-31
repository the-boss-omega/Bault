import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsPositive, IsString } from 'class-validator';
import { Public } from '../acc/public.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { ListingService } from './listing.service';
import { BrowseService } from './browse.service';
import { PurchaseService } from './purchase.service';

class CreateListingDto {
  @IsString() itemId!: string;
  @IsInt() @IsPositive() askingPrice!: number;
}
class RepriceDto {
  @IsInt() @IsPositive() askingPrice!: number;
}
class ConfirmTokenDto {
  @IsString() confirmationToken!: string;
}

/** MKT listings + purchase (T080). */
@ApiTags('MKT')
@Controller('marketplace')
export class MktController {
  constructor(
    private readonly listings: ListingService,
    private readonly browse: BrowseService,
    private readonly purchases: PurchaseService,
  ) {}

  @Public()
  @Get('listings')
  list(@Query('limit') limit?: string, @Query('q') q?: string) {
    return this.browse.list(limit ? Number(limit) : undefined, q);
  }

  @Post('listings')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateListingDto) {
    return this.listings.create(user.id, dto.itemId, dto.askingPrice);
  }

  @Public()
  @Get('listings/:id')
  detail(@Param('id') id: string) {
    return this.browse.detail(id);
  }

  @Patch('listings/:id')
  reprice(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: RepriceDto) {
    return this.listings.reprice(user.id, id, dto.askingPrice);
  }

  @Post('listings/:id/remove')
  requestRemove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.requestRemove(user.id, id);
  }

  @Post('listings/remove/confirm')
  confirmRemove(@CurrentUser() user: AuthUser, @Body() dto: ConfirmTokenDto) {
    return this.listings.confirmRemove(user.id, dto.confirmationToken);
  }

  @Post('listings/:id/purchase')
  purchase(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string,
  ) {
    return this.purchases.purchase(user.id, id, key ?? `purchase-${user.id}-${id}`);
  }
}
