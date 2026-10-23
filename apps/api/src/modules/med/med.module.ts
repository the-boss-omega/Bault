import { Global, Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MedController } from './med.controller';

@Global()
@Module({
  controllers: [MedController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MedModule {}
