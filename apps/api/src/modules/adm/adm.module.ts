import { Module } from '@nestjs/common';
import { AdmService } from './adm.service';
import { ShelfYieldService } from './shelf-yield.service';
import { AdmController } from './adm.controller';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { AccModule } from '../acc/acc.module';

/**
 * ADM module (administration). Manage users + cards, disputes (ADM-04), and
 * storage-fee runs (VLT-04). Dashboard banners were removed (Requirement 1.2).
 * The accountant's exports live here too (N40): read-only, admin-only.
 */
@Module({
  // AccModule for `MfaService`: an administrator resets another account's
  // second factor from the Users screen.
  imports: [AccModule],
  controllers: [AdmController, AccountingController],
  providers: [AdmService, ShelfYieldService, AccountingService],
})
export class AdmModule {}
