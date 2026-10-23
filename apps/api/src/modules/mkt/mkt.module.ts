import { Module } from '@nestjs/common';
import { ListingService } from './listing.service';
import { BrowseService } from './browse.service';
import { PurchaseService } from './purchase.service';
import { OfferService } from './offer.service';
import { TradeService } from './trade.service';
import { MarketReadService } from './market-read.service';
import { MktController } from './mkt.controller';
import { OfferController } from './offer.controller';
import { TradeController } from './trade.controller';
import { HouseStoreController } from './house-store.controller';
import { HouseStoreService } from './house-store.service';

@Module({
  controllers: [MktController, OfferController, TradeController, HouseStoreController],
  providers: [
    ListingService,
    BrowseService,
    PurchaseService,
    OfferService,
    TradeService,
    MarketReadService,
    HouseStoreService,
  ],
})
export class MktModule {}
