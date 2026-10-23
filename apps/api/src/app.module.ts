import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { notAnAuthRoute } from './shared/throttle/auth-bucket';
import { loadEnv } from '@bault/config';
import { AppController } from './app.controller';

import { DbModule } from './db/db.module';
import { SecModule } from './modules/sec/sec.module';
import { SharedModule } from './shared/shared.module';
import { AdaptersModule } from './shared/adapters/adapters.module';
import { NotModule } from './modules/not/not.module';
import { ObservabilityModule } from './shared/observability/observability.module';

import { AccModule } from './modules/acc/acc.module';
import { CstModule } from './modules/cst/cst.module';
import { InvModule } from './modules/inv/inv.module';
import { VltModule } from './modules/vlt/vlt.module';
import { MedModule } from './modules/med/med.module';
import { PrcModule } from './modules/prc/prc.module';
import { PayModule } from './modules/pay/pay.module';
import { MktModule } from './modules/mkt/mkt.module';
import { DisModule } from './modules/dis/dis.module';
import { ShpModule } from './modules/shp/shp.module';
import { EscModule } from './modules/esc/esc.module';
import { AdmModule } from './modules/adm/adm.module';
import { SupModule } from './modules/sup/sup.module';
import { MemModule } from './modules/mem/mem.module';

import { SessionAuthGuard } from './modules/acc/session-auth.guard';
import { MfaEnrollmentGuard } from './modules/acc/mfa/mfa-enrollment.guard';
import { RolesGuard } from './modules/sec/roles.guard';
import { AuditInterceptor } from './modules/sec/audit.interceptor';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const env = loadEnv();
        return {
          throttlers: [
            { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE },
            { name: 'auth', ttl: 60_000, limit: env.AUTH_RATE_LIMIT_PER_MINUTE, skipIf: notAnAuthRoute },
          ],
        };
      },
    }),
    DbModule,
    SecModule,
    SharedModule,
    AdaptersModule,
    NotModule,
    ObservabilityModule,
    PrcModule,
    PayModule,
    AccModule,
    CstModule,
    InvModule,
    VltModule,
    MedModule,
    MktModule,
    DisModule,
    ShpModule,
    EscModule,
    AdmModule,
    SupModule,
    MemModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: MfaEnrollmentGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
