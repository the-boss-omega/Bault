import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { FacilityService } from './facility.service';
import { ParcelService } from './parcel.service';

class RegisterParcelDto {
  @IsString() facilityCode!: string;
  @IsOptional() @IsString() @MaxLength(60) carrier?: string;
  /**
   * Required. Registering exists so the bench can match an arriving box to its
   * owner, and the tracking number is the only thing it matches on — a
   * registration without one was an empty parcel record that could never be
   * matched to anything.
   */
  @IsString() @IsNotEmpty() @MaxLength(120) trackingNumber!: string;
  @IsOptional() @IsString() @MaxLength(500) declaredContents?: string;
  @IsOptional() @IsBoolean() internationalOrigin?: boolean;
  @IsOptional() @IsString() expectedAt?: string;
}

/**
 * At most this many photographs on one step.
 *
 * Six is a box from every side plus the label. A cap exists so a bench cannot
 * accidentally attach a phone's whole camera roll to one parcel.
 */
const MAX_PHOTOS = 6;

class ReceiveParcelDto {
  @IsString() facilityCode!: string;
  @IsOptional() @IsString() @MaxLength(64) addressedTo?: string;
  @IsOptional() @IsString() @MaxLength(60) carrier?: string;
  @IsOptional() @IsString() @MaxLength(120) trackingNumber?: string;
  @IsOptional() @IsBoolean() internationalOrigin?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /** Keys from `POST /media/uploads` — never image bytes on this route. */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_PHOTOS) @IsString({ each: true }) photoKeys?: string[];
}

/**
 * A stack of boxes, booked in together.
 *
 * A courier drops a dozen at once and the operator works down the pile; the
 * single-parcel form cleared itself between each, so the facility and the
 * carrier were re-chosen every time and there was no way to see the run as a
 * whole. `ArrayMaxSize` is a sanity bound, not a workflow limit.
 */
class ReceiveManyDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ReceiveParcelDto)
  parcels!: ReceiveParcelDto[];
}

class OpenParcelDto {
  @IsIn(['sound', 'packaging_damaged', 'contents_damaged'])
  condition!: 'sound' | 'packaging_damaged' | 'contents_damaged';
  @IsString() @MinLength(1) @MaxLength(1000) conditionNotes!: string;
  /** What the arrival check actually saw — evidence, not a sentence about it. */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_PHOTOS) @IsString({ each: true }) photoKeys?: string[];
}

/**
 * The only way to close out a parcel that produced no items: the operator
 * states, in words, that it really did arrive empty. Absent, an empty parcel is
 * refused rather than billed — see `ParcelService.process`.
 */
class ProcessParcelDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(1000) emptyReason?: string;
}

class ClaimParcelDto {
  @IsString() ownerUsername!: string;
}

class DisposeParcelDto {
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}

/**
 * Inbound parcels and the addresses they are sent to.
 *
 * Roles are per method. The collector half — their addresses, their parcels,
 * registering one, cancelling one they registered — is ordinary account
 * functionality; the warehouse half is staff-only. A class-level role, as
 * `InvController` has, would put a collector's own inbound record behind a
 * warehouse permission.
 */
@ApiTags('INV')
@Controller()
export class ParcelController {
  constructor(
    private readonly facilities: FacilityService,
    private readonly parcels: ParcelService,
  ) {}

  /* ---------------- collector ---------------- */

  /** The addresses this collector ships purchases to, addressed to them. */
  @Get('me/inbound-addresses')
  inboundAddresses(@CurrentUser() user: AuthUser) {
    return this.facilities.inboundAddressesFor(user.id);
  }

  @Get('me/parcels')
  myParcels(@CurrentUser() user: AuthUser) {
    return this.parcels.listMine(user.id);
  }

  @Post('me/parcels')
  register(@Body() dto: RegisterParcelDto, @CurrentUser() user: AuthUser) {
    return this.parcels.register(user.id, dto);
  }

  @Post('me/parcels/:id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.parcels.cancelRegistration(user.id, id);
  }

  /**
   * One parcel in full. Staff may open any; a collector only their own, and the
   * service answers `notFound` rather than `forbidden` on a miss — telling a
   * stranger that somebody else's parcel id exists is itself a leak.
   */
  @Get('parcels/:id')
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const staff = user.role === 'warehouse_operator' || user.role === 'admin';
    return this.parcels.detailFor(user.id, id, staff);
  }

  /**
   * The live processing backlog. Readable by any signed-in caller: it is the
   * honest answer to "how long is this taking", and it is about the queue rather
   * than about anybody's parcel in particular.
   */
  @Get('parcels/workflow/status')
  workflow() {
    return this.parcels.workflow();
  }

  /* ---------------- warehouse ---------------- */

  @Roles('warehouse_operator', 'admin')
  @Get('parcels')
  queue() {
    return this.parcels.listQueue();
  }

  @Roles('warehouse_operator', 'admin')
  @Post('parcels/receive')
  receive(@Body() dto: ReceiveParcelDto, @CurrentUser() user: AuthUser) {
    return this.parcels.receive(user.id, dto);
  }

  /**
   * Several arrivals in one gesture — all of them, or none.
   *
   * Declared before `parcels/:id/...` for the same reason `listings/mine` is: the
   * route table is ordered, and a literal segment that sits after a parameter is
   * unreachable.
   */
  @Roles('warehouse_operator', 'admin')
  @Post('parcels/receive/batch')
  receiveMany(@Body() dto: ReceiveManyDto, @CurrentUser() user: AuthUser) {
    return this.parcels.receiveMany(user.id, dto.parcels);
  }

  /**
   * The photographs on one parcel.
   *
   * Same visibility rule as the parcel itself: `detailFor` decides whether this
   * caller may see the box at all, and the photographs follow it — a collector
   * gets the pictures of their own arrival, which is the point of taking them.
   */
  @Get('parcels/:id/photos')
  async photos(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const staff = user.role === 'warehouse_operator' || user.role === 'admin';
    await this.parcels.detailFor(user.id, id, staff);
    return this.parcels.photos(id);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('parcels/:id/forward')
  forward(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.parcels.forward(user.id, id);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('parcels/:id/open')
  open(@Param('id') id: string, @Body() dto: OpenParcelDto, @CurrentUser() user: AuthUser) {
    return this.parcels.open(user.id, id, dto);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('parcels/:id/process')
  process(
    @Param('id') id: string,
    @Body() dto: ProcessParcelDto | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.parcels.process(user.id, id, dto?.emptyReason);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('parcels/:id/claim')
  claim(@Param('id') id: string, @Body() dto: ClaimParcelDto, @CurrentUser() user: AuthUser) {
    return this.parcels.claim(user.id, id, dto.ownerUsername);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('parcels/:id/dispose')
  dispose(@Param('id') id: string, @Body() dto: DisposeParcelDto, @CurrentUser() user: AuthUser) {
    return this.parcels.dispose(user.id, id, dto.reason);
  }
}
