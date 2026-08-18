import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsPositive, IsString } from 'class-validator';
import { Public } from '../acc/public.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { ListingService } from './listing.service';
import { BrowseService } from './browse.service';
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

/** MKT listings + purchase (T080). */
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
  list(@Query('limit') limit?: string, @Query('q') q?: string) {
    return this.browse.list(limit ? Number(limit) : undefined, q);
  }

  /**
   * The caller's OWN listings, with the count of offers still awaiting them.
   *
   * Declared before `listings/:id` so "mine" is never captured as an id — the
   * route table is ordered, and a literal segment that sits after a parameter
   * is unreachable.
   */
  @Get('listings/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.read.myListings(user.id);
  }

  /** Every offer the caller is party to, on either side of the table. */
  @Get('offers/mine')
  myOffers(@CurrentUser() user: AuthUser) {
    return this.read.myOffers(user.id);
  }

  /**
   * Resolve a username to the id the swap and transfer endpoints take.
   * Answers with an id and a name only — never a profile.
   */
  @Get('collectors/:username')
  collector(@CurrentUser() user: AuthUser, @Param('username') username: string) {
    return this.read.counterparty(username, user.id);
  }

  /**
   * A collector's public storefront. Public on purpose: it is the page a seller
   * shares, and one that needs an account to open is not a storefront.
   */
  /**
   * One of another collector's items, by serial — the only way to name what a
   * swap asks for. Requiring the serial IS the privacy control.
   */
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
