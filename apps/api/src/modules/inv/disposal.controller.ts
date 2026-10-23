import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { DisposalService } from './disposal.service';
import { DISPOSAL_CATEGORIES, DISPOSAL_OUTCOMES, ITEM_CLASSES } from './item-classes';

class RecordDisposalDto {
  @IsString() ownerUsername!: string;
  @IsString() category!: string;
  @IsString() outcome!: string;
  @IsString() @MinLength(1) @MaxLength(200) description!: string;
  @IsString() @MinLength(1) @MaxLength(1000) notes!: string;
}

@ApiTags('INV')
@Controller()
export class DisposalController {
  constructor(private readonly disposals: DisposalService) {}

  @Get('intake/vocabulary')
  vocabulary() {
    return {
      itemClasses: ITEM_CLASSES,
      disposalCategories: DISPOSAL_CATEGORIES,
      disposalOutcomes: DISPOSAL_OUTCOMES,
    };
  }

  @Roles('warehouse_operator', 'admin')
  @Post('intake/disposals')
  record(@Body() dto: RecordDisposalDto, @CurrentUser() user: AuthUser) {
    return this.disposals.record(user.id, dto);
  }

  @Roles('warehouse_operator', 'admin')
  @Get('intake/disposals')
  listAll() {
    return this.disposals.listAll();
  }

  @Get('me/disposals')
  listMine(@CurrentUser() user: AuthUser) {
    return this.disposals.listMine(user.id);
  }
}
