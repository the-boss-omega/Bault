import { Global, Module } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { MemController } from './mem.controller';

/**
 * MEM module (membership).
 *
 * `@Global`, and for one specific reason: `BillingService` in PAY has to ask
 * "is this action included in the caller's tier" before it raises a charge, and
 * PAY is built before MEM in the module graph. Making this global is the same
 * choice PRC made for the same shape of problem — one service that almost
 * everything that touches money needs to consult.
 */
@Global()
@Module({
  controllers: [MemController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MemModule {}
