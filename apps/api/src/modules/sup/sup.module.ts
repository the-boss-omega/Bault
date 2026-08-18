import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupController } from './sup.controller';

/**
 * SUP module — the helpdesk. Owns only the ticket and its thread; depends on the
 * global outbox to notify a customer when staff reply.
 */
@Module({
  controllers: [SupController],
  providers: [SupportService],
})
export class SupModule {}
