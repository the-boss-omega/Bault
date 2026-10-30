import { Module } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { CorrectionService } from './correction.service';
import { BatchService } from './batch.service';
import { DisposalService } from './disposal.service';
import { FacilityService } from './facility.service';
import { FacilityAdminService } from './facility-admin.service';
import { ParcelService } from './parcel.service';
import { InvController } from './inv.controller';
import { DisposalController } from './disposal.controller';
import { ParcelController } from './parcel.controller';
import { FacilityAdminController } from './facility-admin.controller';

@Module({
  controllers: [InvController, DisposalController, ParcelController, FacilityAdminController],
  providers: [
    IntakeService,
    CorrectionService,
    BatchService,
    DisposalService,
    FacilityService,
    FacilityAdminService,
    ParcelService,
  ],
})
export class InvModule {}
