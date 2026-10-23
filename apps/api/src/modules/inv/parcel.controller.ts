import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { IsObjectKey } from '../../shared/object-key';
import { FacilityService } from './facility.service';
import { ParcelService } from './parcel.service';

class RegisterParcelDto {
  @IsString() facilityCode!: string;
  @IsOptional() @IsString() @MaxLength(60) carrier?: string;
  @IsOptional() @IsString() @MaxLength(120) trackingNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) declaredContents?: string;
  @IsOptional() @IsBoolean() internationalOrigin?: boolean;
  @IsOptional() @IsString() expectedAt?: string;
}

const MAX_PHOTOS = 6;

class ReceiveParcelDto {
  @IsString() facilityCode!: string;
  @IsOptional() @IsString() @MaxLength(64) addressedTo?: string;
  @IsOptional() @IsString() @MaxLength(60) carrier?: string;
  @IsOptional() @IsString() @MaxLength(120) trackingNumber?: string;
  @IsOptional() @IsBoolean() internationalOrigin?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_PHOTOS) @IsString({ each: true }) @IsObjectKey({ each: true }) photoKeys?: string[];
}

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
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_PHOTOS) @IsString({ each: true }) @IsObjectKey({ each: true }) photoKeys?: string[];
}

class ProcessParcelDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(1000) emptyReason?: string;
}

class ClaimParcelDto {
  @IsString() ownerUsername!: string;
}

class DisposeParcelDto {
  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;
}

@ApiTags('INV')
@Controller()
export class ParcelController {
  constructor(
    private readonly facilities: FacilityService,
    private readonly parcels: ParcelService,
  ) {}

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

  @Get('parcels/:id')
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const staff = user.role === 'warehouse_operator' || user.role === 'admin';
    return this.parcels.detailFor(user.id, id, staff);
  }

  @Get('parcels/workflow/status')
  workflow() {
    return this.parcels.workflow();
  }

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

  @Roles('warehouse_operator', 'admin')
  @Post('parcels/receive/batch')
  receiveMany(@Body() dto: ReceiveManyDto, @CurrentUser() user: AuthUser) {
    return this.parcels.receiveMany(user.id, dto.parcels);
  }

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
