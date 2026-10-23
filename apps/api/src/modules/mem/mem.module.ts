import { Global, Module } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { MemController } from './mem.controller';

@Global()
@Module({
  controllers: [MemController],
  providers: [MembershipService],
  exports: [MembershipService],
})
export class MemModule {}
