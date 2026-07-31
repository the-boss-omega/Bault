import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox/outbox.service';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';

/**
 * NOT module. Provides the OutboxService globally so any state change across
 * modules can emit domain events transactionally (T018), plus the notification
 * feed + preference endpoints (NOT-01/NOT-02). Dispatch (outbox → notification)
 * runs in the worker (outbox-dispatch job).
 */
@Global()
@Module({
  controllers: [NotificationController],
  providers: [OutboxService, NotificationService],
  exports: [OutboxService, NotificationService],
})
export class NotModule {}
