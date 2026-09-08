import { Module } from '@nestjs/common';
import { AdmService } from './adm.service';
import { ShelfYieldService } from './shelf-yield.service';
import { AdmController } from './adm.controller';

/**
 * ADM module (administration). Manage users + cards, disputes (ADM-04), and
 * storage-fee runs (VLT-04). Dashboard banners were removed (Requirement 1.2).
 */
@Module({
  controllers: [AdmController],
  providers: [AdmService, ShelfYieldService],
})
export class AdmModule {}
