import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { RolesGuard } from './roles.guard';
import { PiiInterceptor } from './pii';

/**
 * SEC module (audit + security cross-cutting). Global so guards/interceptors and
 * the audit service are available everywhere without re-importing.
 */
@Global()
@Module({
  providers: [AuditService, AuditInterceptor, RolesGuard, PiiInterceptor],
  exports: [AuditService, AuditInterceptor, RolesGuard, PiiInterceptor],
})
export class SecModule {}
