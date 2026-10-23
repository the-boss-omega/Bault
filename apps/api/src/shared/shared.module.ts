import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency/idempotency.service';
import { ConfirmationService } from './confirmation/confirmation.service';

@Global()
@Module({
  providers: [IdempotencyService, ConfirmationService],
  exports: [IdempotencyService, ConfirmationService],
})
export class SharedModule {}
