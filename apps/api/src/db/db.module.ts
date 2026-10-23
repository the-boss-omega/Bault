import { Global, Module } from '@nestjs/common';
import { createDb, type Database } from './client';

export const DRIZZLE = Symbol('DRIZZLE');

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
