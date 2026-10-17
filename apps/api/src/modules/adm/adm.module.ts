import { Module } from '@nestjs/common';
import { AdmService } from './adm.service';
import { ShelfYieldService } from './shelf-yield.service';
import { AdmController } from './adm.controller';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { OutboxAdminService } from './outbox-admin.service';
import { AccModule } from '../acc/acc.module';

/**
 * ADM module (administration). Manage users + cards, disputes, and storage-fee
 * runs. The accountant's exports live here too: read-only, admin-only.
 */
@Module({
  // AccModule for `MfaService`: an administrator resets another account's
  // second factor from the Users screen.
  imports: [AccModule],
  controllers: [AdmController, AccountingController],
  providers: [AdmService, ShelfYieldService, AccountingService, OutboxAdminService],
})
export class AdmModule {}
