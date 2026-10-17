import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { EscController } from './esc.controller';

/**
 * ESC module: middleman and escrow on a private deal.
 *
 * Uses the global CST kernel for custody, PAY for the ledger, PRC for the
 * published terms, MEM for fee waivers and NOT for the outbox. It owns no
 * adapters of its own.
 */
@Module({
  controllers: [EscController],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscModule {}
