import { Global, Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PriceListService } from './price-list.service';
import { PrcController } from './prc.controller';

/** PRC module (pricing). Global — the single pricing source used by PAY/MKT/SHP/DIS. */
@Global()
@Module({
  controllers: [PrcController],
  providers: [PricingService, PriceListService],
  exports: [PricingService],
})
export class PrcModule {}
