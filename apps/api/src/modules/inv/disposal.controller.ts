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

/**
 * Arrival disposals, and the vocabulary behind them.
 *
 * Roles are set PER METHOD rather than on the class, which is deliberate: the
 * write and the warehouse-wide list are staff work, but a collector must be able
 * to read their own disposals — that is the entire point of recording them. A
 * class-level `@Roles('warehouse_operator', 'admin')`, as `InvController` has,
 * would lock the owner out of the record of their own property.
 */
@ApiTags('INV')
@Controller()
export class DisposalController {
  constructor(private readonly disposals: DisposalService) {}

  /**
   * The taxonomy, served to whoever is drawing a form over it.
   *
   * Any signed-in caller may read it: the classes and categories are product
   * vocabulary, not privileged information, and a collector reading their own
   * disposal list needs the same labels the operator picked from.
   */
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

  /** A collector's own record of what arrived for them and was not accepted. */
  @Get('me/disposals')
  listMine(@CurrentUser() user: AuthUser) {
    return this.disposals.listMine(user.id);
  }
}
