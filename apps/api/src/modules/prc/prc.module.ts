import { Global, Module } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { PriceListService } from './price-list.service';
import { PrcController } from './prc.controller';
import { PricingCoverageController } from './pricing-coverage.controller';

@Global()
@Module({
  controllers: [PrcController, PricingCoverageController],
  providers: [PricingService, PriceListService],
  exports: [PricingService],
})
export class PrcModule {}
