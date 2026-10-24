import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Public } from '../acc/public.decorator';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { ShipmentService } from './shipment.service';
import { ShipmentEditService } from './shipment-edit.service';
import { GroupShipmentService } from './group-shipment.service';
import { CustomsService } from './customs.service';
import { destinationGuidance } from './destinations';
import { DirectShipService } from './direct-ship.service';
import { DispatchService } from './dispatch.service';
import { HumanFulfilmentService } from './human-fulfilment.service';
import { shippingCountries } from './countries';
import { SHIPPING_BOX_KEYS } from './boxes';

class ShipmentOptionsDto {
  @IsOptional() @IsBoolean() rush?: boolean;
  @IsOptional() @IsInt() @Min(0) insuredValueMinor?: number;
  @IsOptional() @IsInt() @Min(0) declaredValueMinor?: number;
  @IsOptional() @IsBoolean() signatureRequired?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) addOns?: string[];
  @IsOptional() @IsString() @MaxLength(500) customerNotes?: string;
  @IsOptional() @IsIn(['simple', 'personalised']) serviceMode?: 'simple' | 'personalised';
  @IsOptional() @IsObject() perItemCustomsValues?: Record<string, number>;
  @IsOptional() @IsIn(SHIPPING_BOX_KEYS) boxSize?: string | null;
}

class CreateShipmentDto extends ShipmentOptionsDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) itemIds!: string[];
  @IsOptional() @IsString() addressId?: string;
  @IsOptional() @IsString() destinationAddress?: string;
  @IsOptional() @IsString() @MaxLength(2) destinationCountry?: string;
  @IsOptional() @IsString() @MaxLength(20) destinationPostalCode?: string;
  @IsOptional() @IsString() @MaxLength(140) recipientName?: string;
}

class UpdateShipmentDto extends ShipmentOptionsDto {
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsString({ each: true }) itemIds?: string[];
  @IsOptional() @IsString() @MaxLength(140) recipientName?: string;
}

class SelectRateDto {
  @IsString() carrier!: string;
  @IsString() serviceLevel!: string;
}

class MergeDto {
  @IsString() sourceShipmentId!: string;
}

class CancelDto {
  @IsString() @MaxLength(300) reason!: string;
}

class OpenGroupDto {
  @IsString() shipmentId!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class JoinGroupDto {
  @IsString() groupCode!: string;
  @IsString() shipmentId!: string;
}

class LeaveGroupDto {
  @IsString() shipmentId!: string;
}

class DirectShipDto {
  @IsOptional() @IsString() addressId?: string;
  @IsOptional() @IsString() destinationAddress?: string;
  @IsOptional() @IsString() @MaxLength(2) destinationCountry?: string;
  @IsOptional() @IsString() @MaxLength(20) destinationPostalCode?: string;
  @IsOptional() @IsString() @MaxLength(140) recipientName?: string;
  @IsInt() @Min(1) cardCount!: number;
  @IsOptional() @IsInt() @Min(0) insuredValueMinor?: number;
  @IsOptional() @IsString() @MaxLength(300) customerNotes?: string;
}

class HandDeliveryDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) itemIds!: string[];
  @IsString() @MaxLength(400) pickupAddress!: string;
  @IsString() pickupFrom!: string;
  @IsString() pickupTo!: string;
  @IsString() @MaxLength(400) deliveryAddress!: string;
  @IsString() deliverFrom!: string;
  @IsString() deliverTo!: string;
  @IsString() @MaxLength(2) destinationCountry!: string;
  @IsOptional() @IsString() @MaxLength(140) recipientName?: string;
  @IsOptional() @IsString() @MaxLength(500) customerNotes?: string;
}

class QuoteDto {
  @IsInt() @Min(1) quoteMinor!: number;
  @IsString() @MaxLength(1000) notes!: string;
}

class AcceptQuoteDto {
  @IsInt() @Min(1) quoteMinor!: number;
}

class PickupDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) itemIds!: string[];
  @IsString() eventId!: string;
  @IsOptional() @IsString() @MaxLength(500) customerNotes?: string;
}

class HandOverDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) scannedItemIds!: string[];
  @IsString() @MaxLength(140) handedToName!: string;
  @IsString() @MaxLength(1000) notes!: string;
}

class DispatchDto {
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsString({ each: true }) @MaxLength(120, { each: true })
  scannedItemIds?: string[];
  @IsOptional() @IsString() @MaxLength(120) scannedParcel?: string;
  @IsString() carrier!: string;
  @IsInt() @Min(1) packageWeightGrams!: number;
  @IsString() fulfillmentNotes!: string;
}

@ApiTags('SHP')
@Controller('shipping')
export class ShpController {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly edits: ShipmentEditService,
    private readonly groups: GroupShipmentService,
    private readonly customs: CustomsService,
    private readonly direct: DirectShipService,
    private readonly dispatch: DispatchService,
    private readonly human: HumanFulfilmentService,
  ) {}

  @Get('countries')
  countries() {
    return shippingCountries();
  }

  @Get('services')
  services() {
    return this.shipments.services();
  }

  @Post('quote')
  quote(@CurrentUser() user: AuthUser, @Body() dto: CreateShipmentDto) {
    return this.shipments.quote(user.id, dto);
  }

  @Post('shipments')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateShipmentDto) {
    return this.shipments.create(user.id, dto);
  }

  @Get('shipments')
  list(@CurrentUser() user: AuthUser) {
    return this.shipments.listFor(user);
  }

  @Get('groups')
  myGroups(@CurrentUser() user: AuthUser) {
    return this.groups.mine(user.id);
  }

  @Post('groups')
  openGroup(@CurrentUser() user: AuthUser, @Body() dto: OpenGroupDto) {
    return this.groups.open(user.id, dto.shipmentId, dto.notes, user);
  }

  @Post('groups/join')
  joinGroup(@CurrentUser() user: AuthUser, @Body() dto: JoinGroupDto) {
    return this.groups.join(user.id, dto.groupCode, dto.shipmentId, user);
  }

  @Post('groups/leave')
  leaveGroup(@CurrentUser() user: AuthUser, @Body() dto: LeaveGroupDto) {
    return this.groups.leave(user.id, dto.shipmentId, user);
  }

  @Get('groups/:id')
  group(@Param('id') id: string) {
    return this.groups.describe(id);
  }

  @Post('groups/:id/lock')
  lockGroup(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groups.lock(user.id, id);
  }

  @Post('groups/:id/cancel')
  cancelGroup(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.groups.cancel(user.id, id, dto.reason);
  }

  @Get('white-glove/terms')
  whiteGloveTerms() {
    return this.human.whiteGloveTerms();
  }

  @Post('white-glove')
  requestHandDelivery(@CurrentUser() user: AuthUser, @Body() dto: HandDeliveryDto) {
    return this.human.requestHandDelivery(user.id, dto);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('white-glove/:id/quote')
  quoteHandDelivery(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: QuoteDto) {
    return this.human.quoteHandDelivery(user.id, id, dto);
  }

  @Post('white-glove/:id/accept')
  acceptQuote(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AcceptQuoteDto) {
    return this.human.acceptQuote(id, user, dto.quoteMinor);
  }

  @Get('pickup/shows')
  pickupShows() {
    return this.human.pickupShows();
  }

  @Post('pickup')
  requestPickup(@CurrentUser() user: AuthUser, @Body() dto: PickupDto) {
    return this.human.requestPickup(user.id, dto);
  }

  @Get('direct/terms')
  directTerms() {
    return this.direct.terms();
  }

  @Get('direct/:parcelId/eligibility')
  directEligibility(@CurrentUser() user: AuthUser, @Param('parcelId') parcelId: string) {
    return this.direct.eligibility(user.id, parcelId);
  }

  @Post('direct/:parcelId')
  directShip(
    @CurrentUser() user: AuthUser,
    @Param('parcelId') parcelId: string,
    @Body() dto: DirectShipDto,
  ) {
    return this.direct.request(user.id, parcelId, dto);
  }

  @Get('shipments/:id/rates')
  rates(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shipments.rates(id, user);
  }

  @Post('shipments/:id/select-rate')
  selectRate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SelectRateDto) {
    return this.shipments.selectRate(id, dto.carrier, dto.serviceLevel, user);
  }

  @Post('shipments/:id/choose-for-me')
  chooseForMe(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shipments.selectRecommended(id, user);
  }

  @Post('shipments/:id/pay')
  pay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shipments.pay(id, user);
  }

  @Patch('shipments/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateShipmentDto) {
    return this.edits.update(id, user, dto);
  }

  @Post('shipments/:id/merge')
  merge(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MergeDto) {
    return this.edits.merge(id, dto.sourceShipmentId, user);
  }

  @Get('shipments/:id/cancel-fee')
  cancelFee(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.edits.cancelFee(id, user);
  }

  @Post('shipments/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.edits.cancel(id, user, dto.reason);
  }

  @Get('shipments/:id/customs')
  customsInvoice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customs.invoice(id, user);
  }

  @Get('shipments/:id/customs/readiness')
  customsReadiness(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customs.readiness(id, user);
  }

  @Public()
  @Get('destinations/:country')
  destination(@Param('country') country: string) {
    return destinationGuidance(country);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('shipments/:id/hand-over')
  handOver(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: HandOverDto) {
    return this.human.handOver(user.id, id, dto);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('shipments/:id/dispatch')
  dispatchShipment(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: DispatchDto) {
    return this.dispatch.dispatch(user.id, id, {
      scannedItemIds: dto.scannedItemIds,
      scannedParcel: dto.scannedParcel,
      carrier: dto.carrier,
      packageWeightGrams: dto.packageWeightGrams,
      fulfillmentNotes: dto.fulfillmentNotes,
    });
  }

  @Get('shipments/:id')
  track(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shipments.track(id, user);
  }
}
