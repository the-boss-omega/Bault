import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { AppError } from '../../shared/errors/app-error';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { RelocateService } from './relocate.service';
import { InventoryService, type Cut } from './inventory.service';
import { StowService } from './stow.service';

class RelocateDto {
  @IsString()
  binId!: string;
}

class CreateBinDto {
  @IsString() zone!: string;
  @IsOptional() @IsString() facilityId?: string;
  @IsOptional() @IsString() facilityCode?: string;
  @IsOptional() @IsBoolean() oversized?: boolean;
}

class BinActiveDto {
  @IsBoolean() active!: boolean;
}

const CUTS: readonly Cut[] = ['shelf', 'owner', 'condition', 'item_class'];

@ApiTags('CST')
@Controller('custody')
export class CstController {
  constructor(
    private readonly relocate: RelocateService,
    private readonly inventory: InventoryService,
    private readonly stow: StowService,
  ) {}

  @Roles('warehouse_operator', 'admin')
  @Post('items/:itemId/relocate')
  async relocateItem(
    @Param('itemId') itemId: string,
    @Body() dto: RelocateDto,
    @CurrentUser() user: AuthUser,
  ) {
    const target = await this.stow.resolveItem(itemId);
    const destination = await this.stow.resolveBin(dto.binId);
    await this.relocate.relocate(target.id, destination.id, user.id);
    return { status: 'relocated', itemId: target.id, binId: destination.id };
  }

  @Roles('warehouse_operator', 'admin')
  @Post('items/:itemId/hold')
  async placeHold(@Param('itemId') itemId: string, @CurrentUser() user: AuthUser) {
    const target = await this.stow.resolveItem(itemId);
    const changed = await this.relocate.placeHold(target.id, user.id);
    return { status: changed ? 'hold_placed' : 'already_on_hold', changed, itemId: target.id };
  }

  @Roles('warehouse_operator', 'admin')
  @Delete('items/:itemId/hold')
  async releaseHold(@Param('itemId') itemId: string, @CurrentUser() user: AuthUser) {
    const target = await this.stow.resolveItem(itemId);
    const changed = await this.relocate.releaseHold(target.id, user.id);
    return { status: changed ? 'hold_released' : 'was_not_on_hold', changed, itemId: target.id };
  }

  @Roles('warehouse_operator', 'admin')
  @Get('items/:itemId/history')
  history(@Param('itemId') itemId: string) {
    return this.inventory.history(itemId);
  }

  @Roles('warehouse_operator', 'admin')
  @Get('items/:itemId/timeline')
  timeline(@Param('itemId') itemId: string) {
    return this.inventory.itemTimeline(itemId);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('reconcile')
  reconcile() {
    return this.inventory.reconcile();
  }

  @Roles('warehouse_operator', 'admin')
  @Get('report')
  report(@Query('cut') cut?: string) {
    const chosen = cut ?? 'shelf';
    if (!(CUTS as readonly string[]).includes(chosen)) {
      throw AppError.validation(`Invalid cut "${chosen}"; expected one of ${CUTS.join(', ')}`);
    }
    return this.inventory.report(chosen as Cut);
  }

  @Roles('warehouse_operator', 'admin')
  @Get('report.pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'inline; filename="inventory-report.pdf"')
  async reportPdf(@Query('cut') cut: string | undefined, @Res({ passthrough: true }) res: Response) {
    const chosen = cut ?? 'shelf';
    if (!(CUTS as readonly string[]).includes(chosen)) {
      throw AppError.validation(`Invalid cut "${chosen}"; expected one of ${CUTS.join(', ')}`);
    }
    const pdf = await this.inventory.reportPdf(chosen as Cut);
    res.setHeader('Content-Length', pdf.length);
    return res.end(pdf);
  }

  @Roles('warehouse_operator', 'admin')
  @Post('bins')
  createBin(@Body() dto: CreateBinDto) {
    return this.inventory.createBin({
      zone: dto.zone,
      facilityId: dto.facilityId,
      facilityCode: dto.facilityCode,
      oversized: dto.oversized,
    });
  }

  @Roles('warehouse_operator', 'admin')
  @Get('bins')
  listBins() {
    return this.inventory.listBins();
  }

  @Roles('warehouse_operator', 'admin')
  @Get('bins/suggest')
  async suggestBin(
    @Query('facilityCode') facilityCode?: string,
    @Query('oversized') oversized?: string,
  ) {
    const facilityId = await this.stow.facilityIdByCode(facilityCode);
    return this.stow.suggest({ facilityId, oversized: oversized === 'true' });
  }

  @Roles('warehouse_operator', 'admin')
  @Get('bins/stowable')
  async stowableBins(
    @Query('facilityCode') facilityCode?: string,
    @Query('oversized') oversized?: string,
  ) {
    const facilityId = await this.stow.facilityIdByCode(facilityCode);
    return this.stow.listStowable({ facilityId, oversized: oversized === 'true' });
  }

  @Roles('warehouse_operator', 'admin')
  @Get('bins/:binId/items')
  binItems(@Param('binId') binId: string) {
    return this.inventory.binItems(binId);
  }

  @Roles('warehouse_operator', 'admin')
  @Patch('bins/:binId')
  setBinActive(@Param('binId') binId: string, @Body() dto: BinActiveDto) {
    return this.inventory.setBinActive(binId, dto.active);
  }
}
