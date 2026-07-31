import { Global, Module } from '@nestjs/common';
import { CustodyService } from './custody.service';
import { RelocateService } from './relocate.service';
import { InventoryService } from './inventory.service';
import { CstController } from './cst.controller';

/**
 * CST module (custody). Global because CustodyService is the shared kernel used
 * by INV, MKT, SHP, and DIS to mutate items while guaranteeing custody events.
 */
@Global()
@Module({
  controllers: [CstController],
  providers: [CustodyService, RelocateService, InventoryService],
  // InventoryService is exported so VLT can serve the owner-scoped item history
  // timeline (Requirement 13.2) without duplicating the merge logic.
  exports: [CustodyService, InventoryService],
})
export class CstModule {}
