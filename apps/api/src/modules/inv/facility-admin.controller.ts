import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Roles } from '../sec/roles.decorator';
import { IsShippableCountry } from '../shp/country.validator';
import { FacilityAdminService } from './facility-admin.service';

const FILLED = /\S/;

class NewFacilityDto {
  @Matches(/^[A-Za-z0-9][A-Za-z0-9-]{1,7}$/, {
    message: 'The code is two to eight letters, digits or hyphens, such as NJ.',
  })
  code!: string;
  @IsString() @MaxLength(80) @Matches(FILLED, { message: 'name must not be empty' }) name!: string;
  @IsIn(['primary', 'forwarding']) role!: 'primary' | 'forwarding';
  @IsString()
  @MaxLength(120)
  @Matches(FILLED, { message: 'line1 must not be empty' })
  line1!: string;
  @IsOptional() @IsString() @MaxLength(120) line2?: string | null;
  @IsString() @MaxLength(80) @Matches(FILLED, { message: 'city must not be empty' }) city!: string;
  @IsOptional() @IsString() @MaxLength(60) region?: string | null;
  @IsString()
  @MaxLength(20)
  @Matches(FILLED, { message: 'postalCode must not be empty' })
  postalCode!: string;
  @IsShippableCountry() country!: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(2500) salesTaxBps?: number;
  @IsOptional() @IsString() forwardsToFacilityId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(60) forwardingDays?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** A facility's code and role are not here: parcels, shelves and forwarding legs were written against them. */
class FacilityChangesDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(FILLED, { message: 'name must not be empty' })
  name?: string;
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(FILLED, { message: 'line1 must not be empty' })
  line1?: string;
  @IsOptional() @IsString() @MaxLength(120) line2?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(FILLED, { message: 'city must not be empty' })
  city?: string;
  @IsOptional() @IsString() @MaxLength(60) region?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(FILLED, { message: 'postalCode must not be empty' })
  postalCode?: string;
  @IsOptional() @IsShippableCountry() country?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(2500) salesTaxBps?: number;
  @IsOptional() @IsString() forwardsToFacilityId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(60) forwardingDays?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

/** The places parcels are sent to and shipped from, kept by an administrator. Customers see the active ones as their receiving addresses. */
@ApiTags('INV')
@Roles('admin')
@Controller('admin/facilities')
export class FacilityAdminController {
  constructor(private readonly facilities: FacilityAdminService) {}

  @Get()
  list() {
    return this.facilities.list();
  }

  @Post()
  create(@Body() dto: NewFacilityDto) {
    return this.facilities.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: FacilityChangesDto) {
    return this.facilities.update(id, dto);
  }
}
