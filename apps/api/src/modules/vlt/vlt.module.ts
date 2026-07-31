import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VltController } from './vlt.controller';

/** VLT module (customer vault) — read model over items + images + custody. */
@Module({
  controllers: [VltController],
  providers: [VaultService],
})
export class VltModule {}
