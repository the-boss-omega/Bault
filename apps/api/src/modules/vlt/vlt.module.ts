import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { BreakEvenService } from './break-even.service';
import { VltController } from './vlt.controller';

@Module({
  controllers: [VltController],
  providers: [VaultService, BreakEvenService],
})
export class VltModule {}
