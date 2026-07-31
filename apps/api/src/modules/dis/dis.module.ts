import { Module } from '@nestjs/common';
import { ServiceRequestService } from './service.service';
import { PhotographyService } from './photography.service';
import { GradingService } from './grading.service';
import { DonationService } from './donation.service';
import { ConsignmentService } from './consignment.service';
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
  ],
})
export class DisModule {}
