import { Module } from '@nestjs/common';
import { ListingService } from './listing.service';
import { BrowseService } from './browse.service';
import { PurchaseService } from './purchase.service';
import { OfferService } from './offer.service';
import { TradeService } from './trade.service';
import { MktController } from './mkt.controller';
import { OfferController } from './offer.controller';
import { TradeController } from './trade.controller';

/**
 * MKT module (marketplace). Injects the global kernels — CST (custody), PRC
 * (pricing), PAY (ledger/wallet + billing port), NOT (outbox), and the shared
 * idempotency/confirmation services — and owns listings, purchase, offers, swaps,
 * and transfers.
 */
@Module({
  controllers: [MktController, OfferController, TradeController],
  providers: [ListingService, BrowseService, PurchaseService, OfferService, TradeService],
})
export class MktModule {}
