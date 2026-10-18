import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupController } from './sup.controller';

@Module({
  controllers: [SupController],
  providers: [SupportService],
})
export class SupModule {}
