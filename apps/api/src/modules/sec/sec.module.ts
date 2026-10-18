import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { RolesGuard } from './roles.guard';
import { PiiInterceptor } from './pii';

@Global()
@Module({
  providers: [AuditService, AuditInterceptor, RolesGuard, PiiInterceptor],
  exports: [AuditService, AuditInterceptor, RolesGuard, PiiInterceptor],
})
export class SecModule {}
