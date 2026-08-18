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

/**
 * INV module — everything about goods ARRIVING.
 *
 * It now owns both ends of that: the facilities parcels are sent to and the
 * parcels themselves, then the intake that turns a parcel's contents into vault
 * items, plus corrections, batch splits, and the record of arrivals that were
 * never accepted. Depends on the global CST kernel (custody), the billing port
 * and the outbox — all injected.
 */
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
