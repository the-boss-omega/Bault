import { Module } from '@nestjs/common';
import { AdmService } from './adm.service';
import { ShelfYieldService } from './shelf-yield.service';
import { AdmController } from './adm.controller';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

/**
 * ADM module (administration). Manage users + cards, disputes (ADM-04), and
 * storage-fee runs (VLT-04). Dashboard banners were removed (Requirement 1.2).
 * The accountant's exports live here too (N40): read-only, admin-only.
 */
@Module({
  controllers: [AdmController, AccountingController],
  providers: [AdmService, ShelfYieldService, AccountingService],
})
export class AdmModule {}
