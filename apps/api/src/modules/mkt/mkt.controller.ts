import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsPositive, IsString } from 'class-validator';
import { Public } from '../acc/public.decorator';
import { pageLimit } from '../../shared/query';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { ListingService } from './listing.service';
import { BrowseService, type BrowseSort } from './browse.service';

const BROWSE_DEFAULT = 50;
const BROWSE_MAX = 200;

const BROWSE_SORTS: readonly string[] = ['newest', 'price_asc', 'price_desc'];
import { PurchaseService } from './purchase.service';
import { MarketReadService } from './market-read.service';

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

@ApiTags('MKT')
@Controller('marketplace')
export class MktController {
  constructor(
    private readonly listings: ListingService,
    private readonly browse: BrowseService,
    private readonly purchases: PurchaseService,
    private readonly read: MarketReadService,
  ) {}

  @Public()
  @Get('listings')
  list(
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('condition') condition?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
    @Query('sort') sort?: string,
  ) {
    const price = (raw: string | undefined) => {
      const n = Number(raw);
      return raw !== undefined && raw !== '' && Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    return this.browse.list(pageLimit(limit, { max: BROWSE_MAX, fallback: BROWSE_DEFAULT }), {
      q,
      type,
      condition,
      minPrice: price(minPrice),
      maxPrice: price(maxPrice),
      sort: BROWSE_SORTS.includes(sort as BrowseSort) ? (sort as BrowseSort) : 'newest',
    });
  }

  @Get('listings/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.read.myListings(user.id);
  }

  @Get('offers/mine')
  myOffers(@CurrentUser() user: AuthUser) {
    return this.read.myOffers(user.id);
  }

  @Get('collectors/:username')
  collector(@CurrentUser() user: AuthUser, @Param('username') username: string) {
    return this.read.counterparty(username, user.id);
  }

  @Get('collectors/:username/items/:serial')
  tradable(
    @CurrentUser() user: AuthUser,
    @Param('username') username: string,
    @Param('serial') serial: string,
  ) {
    return this.read.tradableItem(username, serial, user.id);
  }

  @Public()
  @Get('sellers/:username')
  storefront(@Param('username') username: string) {
    return this.read.storefront(username);
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
