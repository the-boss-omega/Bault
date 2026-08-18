import { Module } from '@nestjs/common';
import { ServiceRequestService } from './service.service';
import { PhotographyService } from './photography.service';
import { GradingService } from './grading.service';
import { DonationService } from './donation.service';
import { ConsignmentService } from './consignment.service';
import { BuyoutService } from './buyout.service';
import { MediaService } from './media.service';
import { DisposalServicesService } from './disposal-services.service';
import { LotSplitService } from './lot-split.service';
import { IntakeService } from '../inv/intake.service';
import { DisController } from './dis.controller';

/**
 * DIS module (disposal & value-added services). Uses the global CST/PAY/PRC/NOT
 * kernels + shared confirmation. Owns the unified service-request framework.
 */
@Module({
  controllers: [DisController],
  providers: [
    ServiceRequestService,
    PhotographyService,
    GradingService,
    DonationService,
    ConsignmentService,
    BuyoutService,
    MediaService,
    DisposalServicesService,
    LotSplitService,
    IntakeService,
  ],
})
export class DisModule {}
