import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
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
import { PrcModule } from './modules/prc/prc.module';
import { PayModule } from './modules/pay/pay.module';
import { MktModule } from './modules/mkt/mkt.module';
import { DisModule } from './modules/dis/dis.module';
import { ShpModule } from './modules/shp/shp.module';
import { EscModule } from './modules/esc/esc.module';
import { AdmModule } from './modules/adm/adm.module';
import { SupModule } from './modules/sup/sup.module';

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
    MktModule,
    DisModule,
    ShpModule,
    EscModule,
    AdmModule,
    SupModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
