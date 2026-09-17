import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
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

/** The options every shipment path accepts, so the shapes cannot drift apart. */
class ShipmentOptionsDto {
  @IsOptional() @IsBoolean() rush?: boolean;
  /** What the collector wants covered, in minor units. 0 = uninsured. */
  @IsOptional() @IsInt() @Min(0) insuredValueMinor?: number;
  /** The customs value they declare. Required on anything crossing a border. */
  @IsOptional() @IsInt() @Min(0) declaredValueMinor?: number;
  @IsOptional() @IsBoolean() signatureRequired?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) addOns?: string[];
  @IsOptional() @IsString() @MaxLength(500) customerNotes?: string;
  @IsOptional() @IsIn(['simple', 'personalised']) serviceMode?: 'simple' | 'personalised';
  /** Per-item customs values, keyed by item id. Apportioned by weight if absent. */
  @IsOptional() @IsObject() perItemCustomsValues?: Record<string, number>;
  /** A box from the catalogue. Null clears it: priced on weight, the warehouse picks. */
  @IsOptional() @IsIn(SHIPPING_BOX_KEYS) boxSize?: string | null;
}

class CreateShipmentDto extends ShipmentOptionsDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) itemIds!: string[];
  /**
   * A saved address. Preferred over free text because it carries a real country
   * and postal code, which is what a rate actually depends on.
   */
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
  /** The request being absorbed. Its items move onto the one in the path. */
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
  /** Stated, not counted — nobody has opened the parcel. */
  @IsInt() @Min(1) cardCount!: number;
  @IsOptional() @IsInt() @Min(0) insuredValueMinor?: number;
  @IsOptional() @IsString() @MaxLength(300) customerNotes?: string;
}

/**
 * Structured warehouse fulfillment form (Requirement 5.3): the operator confirms
 * every packed item AND the required carrier / weight / notes before the shipment
 * request can be closed.
 */
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

class PickupDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) itemIds!: string[];
  @IsString() eventId!: string;
  @IsOptional() @IsString() @MaxLength(500) customerNotes?: string;
}

/** Closing a shipment that has no tracking number: a person took it. */
class HandOverDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) scannedItemIds!: string[];
  @IsString() @MaxLength(140) handedToName!: string;
  @IsString() @MaxLength(1000) notes!: string;
}

class DispatchDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) scannedItemIds!: string[];
  @IsString() carrier!: string;
  @IsInt() @Min(1) packageWeightGrams!: number;
  @IsString() fulfillmentNotes!: string;
}

/** SHP endpoints (T108). `/shipping/*`. */
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

  /**
   * The carrier line-up and its limits.
   *
   * Served before anything is chosen, because the limits ARE the product: a
   * collector needs to know ePacket will not insure past $500 while they can
   * still pick something else.
   */
  /**
   * The destinations an address may name.
   *
   * Served so the address form can be a select rather than a text box. It used
   * to be free text with "Israel" as its pre-filled value, which every carrier
   * rule read as an unrecognised country — see `shp/countries.ts`. Public to any
   * signed-in caller because it is a shipping capability, not anybody's data.
   */
  @Get('countries')
  countries() {
    return shippingCountries();
  }

  @Get('services')
  services() {
    return this.shipments.services();
  }

  /**
   * What would this cost?
   *
   * Creates nothing and charges nothing. Rates used to appear only after a
   * shipment record existed, so pricing a hypothetical parcel meant committing
   * to sending it.
   */
  @Post('quote')
  quote(@CurrentUser() user: AuthUser, @Body() dto: CreateShipmentDto) {
    return this.shipments.quote(user.id, dto);
  }

  @Post('shipments')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateShipmentDto) {
    return this.shipments.create(user.id, dto);
  }

  /**
   * Every shipment the caller may see, newest first.
   *
   * Declared BEFORE `shipments/:id` because Nest matches routes in declaration
   * order; the other way round, `:id` would swallow this path.
   */
  @Get('shipments')
  list(@CurrentUser() user: AuthUser) {
    return this.shipments.listFor(user);
  }

  /* ---- Shared parcels. Declared before `shipments/:id` for the same reason. ---- */

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

  /** Only the payer may close it — they are the one on the hook for the carrier. */
  @Post('groups/:id/lock')
  lockGroup(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.groups.lock(user.id, id);
  }

  @Post('groups/:id/cancel')
  cancelGroup(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.groups.cancel(user.id, id, dto.reason);
  }

  /* ---- White glove: a person drives it there ---- */

  @Get('white-glove/terms')
  whiteGloveTerms() {
    return this.human.whiteGloveTerms();
  }

  /**
   * Ask for a hand delivery.
   *
   * Creates a shipment with no carrier and no price — a white-glove request is a
   * QUESTION, and the quote that comes back is the answer.
   */
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
  acceptQuote(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.human.acceptQuote(id, user);
  }

  /* ---- Show pickup: the van was going anyway ---- */

  @Get('pickup/shows')
  pickupShows() {
    return this.human.pickupShows();
  }

  @Post('pickup')
  requestPickup(@CurrentUser() user: AuthUser, @Body() dto: PickupDto) {
    return this.human.requestPickup(user.id, dto);
  }

  /* ---- Direct from the tax-free facility, without entering the vault ---- */

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

  /* ---- One shipment ---- */

  @Get('shipments/:id/rates')
  rates(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shipments.rates(id, user);
  }

  @Post('shipments/:id/select-rate')
  selectRate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SelectRateDto) {
    return this.shipments.selectRate(id, dto.carrier, dto.serviceLevel, user);
  }

  /** "Choose for me" — Bault picks, and the shipment records that it did. */
  @Post('shipments/:id/choose-for-me')
  chooseForMe(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shipments.selectRecommended(id, user);
  }

  /** Settle a shipment that was held because the wallet could not cover it. */
  @Post('shipments/:id/pay')
  pay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.shipments.pay(id, user);
  }

  /** Change the contents or the options, while nobody has walked to a shelf. */
  @Patch('shipments/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateShipmentDto) {
    return this.edits.update(id, user, dto);
  }

  /** Fold another of your requests into this one. */
  @Post('shipments/:id/merge')
  merge(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MergeDto) {
    return this.edits.merge(id, dto.sourceShipmentId, user);
  }

  @Post('shipments/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.edits.cancel(id, user, dto.reason);
  }

  /** The commercial invoice, generated from the shipment's frozen customs lines. */
  @Get('shipments/:id/customs')
  customsInvoice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customs.invoice(id, user);
  }

  /**
   * What will happen to this parcel at the border, before it leaves.
   *
   * Separate from the invoice because it answers a different question at a
   * different moment: the invoice is what travels WITH the parcel, this is what
   * the collector reads while deciding whether to send it.
   */
  @Get('shipments/:id/customs/readiness')
  customsReadiness(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customs.readiness(id, user);
  }

  /**
   * Guidance for a destination, with no shipment involved.
   *
   * PUBLIC, and reachable before anything is created — "can Bault even ship to
   * Australia, and what will it cost me at the far end" is a question people ask
   * before they have a parcel, and often before they have an account. It carries
   * no shipment, no account and no rate: only what Bault does at a border and
   * who to read the real rules from.
   */
  @Public()
  @Get('destinations/:country')
  destination(@Param('country') country: string) {
    return destinationGuidance(country);
  }

  /** Closes a shipment that has no tracking number, because a person took it. */
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
