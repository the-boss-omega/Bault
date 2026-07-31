import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { ShipmentService } from './shipment.service';
import { DispatchService } from './dispatch.service';

class CreateShipmentDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) itemIds!: string[];
  @IsString() destinationAddress!: string;
  @IsOptional() @IsBoolean() rush?: boolean;
}
class SelectRateDto {
  @IsString() carrier!: string;
  @IsString() serviceLevel!: string;
}
/**
 * Structured warehouse fulfillment form (Requirement 5.3): the operator confirms
 * every packed item AND the required carrier / weight / notes before the shipment
 * request can be closed.
 */
class DispatchDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) scannedItemIds!: string[];
  @IsString() carrier!: string;
  @IsInt() @Min(1) packageWeightGrams!: number;
  @IsString() fulfillmentNotes!: string;
}

/** SHP endpoints (T108). `/shipping/shipments*`. */
@ApiTags('SHP')
@Controller('shipping')
export class ShpController {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly dispatch: DispatchService,
  ) {}

  @Post('shipments')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateShipmentDto) {
    return this.shipments.create(user.id, dto.itemIds, dto.destinationAddress, dto.rush ?? false);
  }

  @Get('shipments/:id/rates')
  rates(@Param('id') id: string) {
    return this.shipments.rates(id);
  }

  @Post('shipments/:id/select-rate')
  selectRate(@Param('id') id: string, @Body() dto: SelectRateDto) {
    return this.shipments.selectRate(id, dto.carrier, dto.serviceLevel);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('shipments/:id/dispatch')
  dispatchShipment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DispatchDto) {
    return this.dispatch.dispatch(user.id, id, {
      scannedItemIds: dto.scannedItemIds,
      carrier: dto.carrier,
      packageWeightGrams: dto.packageWeightGrams,
      fulfillmentNotes: dto.fulfillmentNotes,
    });
  }

  @Get('shipments/:id')
  track(@Param('id') id: string) {
    return this.shipments.track(id);
  }
}
