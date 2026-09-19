import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { skipsAuthBucket } from './modules/acc/auth-bucket.decorator';
import { loadEnv } from '@bault/config';
import { AppController } from './app.controller';

// Infrastructure (global)
import { DbModule } from './db/db.module';
import { SecModule } from './modules/sec/sec.module';
import { SharedModule } from './shared/shared.module';
import { AdaptersModule } from './shared/adapters/adapters.module';
import { NotModule } from './modules/not/not.module';
import { ObservabilityModule } from './shared/observability/observability.module';

// Feature modules
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

// Global guards + interceptors
import { SessionAuthGuard } from './modules/acc/session-auth.guard';
import { RolesGuard } from './modules/sec/roles.guard';
import { AuditInterceptor } from './modules/sec/audit.interceptor';

/**
 * Root module of the modular monolith. Composition order:
 *  - global infra (DB, SEC, shared services, adapters, billing seam, outbox, health)
 *  - feature modules (ACC, CST, INV, VLT so far; MKT/PAY/PRC/SHP/DIS/ADM/NOT added later)
 *  - APP_GUARD chain: SessionAuthGuard (authenticate + block suspended) → RolesGuard (@Roles)
 *  - APP_INTERCEPTOR: AuditInterceptor (immutable audit log of state-changing requests)
 */
@Module({
  imports: [
    /**
     * Rate limiting, which did not exist at all.
     *
     * `POST /auth/login` was unmetered, so a password could be attacked as fast
     * as the network allowed, and registration and password-reset were unmetered
     * mail cannons pointed at whatever address the caller named.
     *
     * Two budgets rather than one. The generous `default` keeps an operator
     * working a bench from being throttled while scanning items in; the `auth`
     * bucket is deliberately small because every route in it either checks a
     * credential or sends mail to a stranger. Both come from config, because the
     * right number depends on the deployment rather than on anything knowable
     * here.
     */
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const env = loadEnv();
        return {
          throttlers: [
            { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE },
            // Only the routes marked @AuthBucket — see auth-bucket.decorator.ts
            // for why this can't be left to @Throttle alone.
            {
              name: 'auth',
              ttl: 60_000,
              limit: env.AUTH_RATE_LIMIT_PER_MINUTE,
              skipIf: skipsAuthBucket,
            },
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
    // Global kernels — PRC/PAY provide pricing, ledger/wallet, and the real
    // BILLING_PORT (replacing the Phase-4 no-op) used by INV/MKT.
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
    // Throttling runs BEFORE authentication: an unauthenticated flood must be
    // cheap to refuse, and a guard that first hits the session table to decide
    // whether to rate-limit has already done the expensive part.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
