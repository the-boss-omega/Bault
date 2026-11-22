import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VltController } from './vlt.controller';

@Module({
  controllers: [VltController],
  providers: [VaultService],
})
export class VltModule {}
