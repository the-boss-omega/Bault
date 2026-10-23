import { Module } from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { EscController } from './esc.controller';

@Module({
  controllers: [EscController],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscModule {}
