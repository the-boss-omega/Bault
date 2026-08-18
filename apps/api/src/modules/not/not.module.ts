import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox/outbox.service';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';

/**
 * NOT module. Provides the OutboxService globally so any state change across
 * modules can emit domain events transactionally (T018), plus the notification
 * feed + preference endpoints (NOT-01/NOT-02). Dispatch (outbox → notification)
 * runs in the worker (outbox-dispatch job).
 */
@Global()
@Module({
  controllers: [NotificationController, ContentController],
  providers: [OutboxService, NotificationService, ContentService],
  exports: [OutboxService, NotificationService, ContentService],
})
export class NotModule {}
