import { Global, Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MedController } from './med.controller';

/**
 * MED — putting bytes into object storage, and getting readable URLs back.
 *
 * Global because several modules attach images (INV at intake and on a parcel,
 * MKT when a store order is shelved), and threading the same tiny service
 * through each of their imports would be ceremony for nothing.
 */
@Global()
@Module({
  controllers: [MedController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MedModule {}
