import { Module } from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { DispatchService } from './dispatch.service';
import { ShpController } from './shp.controller';

/** SHP module (outbound shipping). Uses global CST/PAY/PRC/NOT + the shipping adapter. */
@Module({
  controllers: [ShpController],
  providers: [ShipmentService, DispatchService],
})
export class ShpModule {}
