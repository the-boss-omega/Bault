import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  providers: [AuditService, AuditInterceptor, RolesGuard],
  exports: [AuditService, AuditInterceptor, RolesGuard],
})
export class SecModule {}
