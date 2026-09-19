import { Body, Controller, Get, Headers, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { Public } from '../acc/public.decorator';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { HouseStoreService } from './house-store.service';

class CreateHouseListingDto {
  @IsString() typeClass!: string;
  @IsString() @MaxLength(300) description!: string;
  @IsOptional() @IsString() @MaxLength(40) conditionGrade?: string;
  /** A catalogue photo stem under assets/images, e.g. SN-CL10-0005. */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{1,64}$/) photoRef?: string;
  @IsInt() @IsPositive() askingPrice!: number;
  @IsInt() @Min(1) stock!: number;
}

class UpdateHouseListingDto {
  @IsOptional() @IsInt() @IsPositive() askingPrice?: number;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsIn(['active', 'removed']) status?: 'active' | 'removed';
}

class StowHouseOrderDto {
  @IsOptional() @IsString() binId?: string;
  @IsOptional() @IsBoolean() autoStow?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) photoKeys?: string[];
}

/** The Bault store — see HouseStoreService. */
@ApiTags('MKT')
@Controller('marketplace/house')
export class HouseStoreController {
  constructor(private readonly store: HouseStoreService) {}

  /** Public, like the marketplace shelf: somebody deciding whether to sign up may look. */
  @Public()
  @Get('listings')
  forSale() {
    return this.store.listForSale();
  }

  @Post('listings/:id/purchase')
  purchase(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.store.purchase(user.id, id, key);
  }

  @Roles('admin')
  @Get('manage')
  all() {
    return this.store.listAll();
  }

  @Roles('admin')
  @Post('listings')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateHouseListingDto) {
    return this.store.create(user.id, dto);
  }

  @Roles('admin')
  @Patch('listings/:id')
  update(@Param('id') id: string, @Body() dto: UpdateHouseListingDto) {
    return this.store.update(id, dto);
  }

  @Roles('warehouse_operator', 'admin')
  @Get('orders/queue')
  queue() {
    return this.store.queue();
  }

  @Roles('warehouse_operator', 'admin')
  @Post('orders/:id/stow')
  stow(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StowHouseOrderDto) {
    return this.store.stowOrder(user.id, id, dto);
  }
}
