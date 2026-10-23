import { Module } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { CorrectionService } from './correction.service';
import { BatchService } from './batch.service';
import { DisposalService } from './disposal.service';
import { FacilityService } from './facility.service';
import { ParcelService } from './parcel.service';
import { InvController } from './inv.controller';
import { DisposalController } from './disposal.controller';
import { ParcelController } from './parcel.controller';

@Module({
  controllers: [InvController, DisposalController, ParcelController],
  providers: [
    IntakeService,
    CorrectionService,
    BatchService,
    DisposalService,
    FacilityService,
    ParcelService,
  ],
})
export class InvModule {}
