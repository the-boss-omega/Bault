import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * Observability (T022). Exposes health/readiness endpoints. Structured logging is
 * configured in main.ts; Sentry error reporting is initialized from SENTRY_DSN
 * when present (wired in main.ts bootstrap). Kept minimal by design.
 */
@Module({
  controllers: [HealthController],
})
export class ObservabilityModule {}
