import { Global, Module } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { MemController } from './mem.controller';

/**
 * MEM module (membership).
 *
 * `@Global` because `BillingService` in PAY asks "is this action included in
 * the caller's tier" before it raises a charge, and PAY is built before MEM in
 * the module graph. PRC is global for the same reason.
 */
@Global()
@Module({
  controllers: [MemController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MemModule {}
