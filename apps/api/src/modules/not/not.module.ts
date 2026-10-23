import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox/outbox.service';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';

@Global()
@Module({
  controllers: [NotificationController, ContentController],
  providers: [OutboxService, NotificationService, ContentService],
  exports: [OutboxService, NotificationService, ContentService],
})
export class NotModule {}
