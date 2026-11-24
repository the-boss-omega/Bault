import { Global, Module } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { UsageTierService } from './usage-tier.service';
import { MemController } from './mem.controller';

@Global()
@Module({
  controllers: [MemController],
  providers: [MembershipService, UsageTierService],
  exports: [MembershipService, UsageTierService],
})
export class MemModule {}
