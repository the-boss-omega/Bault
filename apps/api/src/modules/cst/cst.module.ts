import { Global, Module } from '@nestjs/common';
import { CustodyService } from './custody.service';
import { RelocateService } from './relocate.service';
import { InventoryService } from './inventory.service';
import { StowService } from './stow.service';
import { CstController } from './cst.controller';

@Global()
@Module({
  controllers: [CstController],
  providers: [CustodyService, RelocateService, InventoryService, StowService],
  exports: [CustodyService, InventoryService, StowService],
})
export class CstModule {}
