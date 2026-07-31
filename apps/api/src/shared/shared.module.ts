import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency/idempotency.service';
import { ConfirmationService } from './confirmation/confirmation.service';

/**
 * Global module bundling the cross-cutting shared services (idempotency + two-step
 * confirmation) so any module can inject them without re-importing.
 */
@Global()
@Module({
  providers: [IdempotencyService, ConfirmationService],
  exports: [IdempotencyService, ConfirmationService],
})
export class SharedModule {}
