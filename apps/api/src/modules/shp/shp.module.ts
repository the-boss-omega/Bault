import { Module } from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { ShipmentEditService } from './shipment-edit.service';
import { GroupShipmentService } from './group-shipment.service';
import { CustomsService } from './customs.service';
import { DirectShipService } from './direct-ship.service';
import { ParcelProfileService } from './parcel-profile.service';
import { DispatchService } from './dispatch.service';
import { HumanFulfilmentService } from './human-fulfilment.service';
import { ShpController } from './shp.controller';

/** SHP module (outbound shipping). Uses global CST/PAY/PRC/NOT + the shipping adapter. */
@Module({
  controllers: [ShpController],
  providers: [
    ShipmentService,
    ShipmentEditService,
    GroupShipmentService,
    CustomsService,
    DirectShipService,
    ParcelProfileService,
    DispatchService,
    HumanFulfilmentService,
  ],
  exports: [ShipmentService],
})
export class ShpModule {}
