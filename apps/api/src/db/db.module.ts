import { Global, Module } from '@nestjs/common';
import { createDb, type Database } from './client';

/**
 * DI token for the Drizzle handle. Inject with `@Inject(DRIZZLE) db: Database`.
 */
export const DRIZZLE = Symbol('DRIZZLE');

/**
 * Global DB module (T009). Provides one shared Drizzle client (backed by a single
 * pg Pool) to every module. Marked @Global so modules need not re-import it.
 */
@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (): Database => createDb().db,
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}
