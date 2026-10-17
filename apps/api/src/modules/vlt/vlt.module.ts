import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { BreakEvenService } from './break-even.service';
import { VltController } from './vlt.controller';

/** VLT module (customer vault): a read model over items, images and custody. */
@Module({
  controllers: [VltController],
  providers: [VaultService, BreakEvenService],
})
export class VltModule {}
