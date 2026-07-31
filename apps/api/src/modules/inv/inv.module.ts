import { Module } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { CorrectionService } from './correction.service';
import { BatchService } from './batch.service';
import { InvController } from './inv.controller';

/**
 * INV module (intake). Depends on the global CST kernel (custody), the billing
 * port, and the outbox — all injected. Owns only intake/batch/correction logic.
 */
@Module({
  controllers: [InvController],
  providers: [IntakeService, CorrectionService, BatchService],
})
export class InvModule {}
