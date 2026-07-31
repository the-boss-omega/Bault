import { Body, Controller, Delete, Get, Header, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { AppError } from '../../shared/errors/app-error';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { RelocateService } from './relocate.service';
import { InventoryService, type Cut } from './inventory.service';

class RelocateDto {
  @IsString()
  binId!: string;
}

class CreateBinDto {
  @IsString() zone!: string;
  @IsInt() capacity!: number;
  @IsOptional() @IsString() barcode?: string;
}

const CUTS: readonly Cut[] = ['shelf', 'owner', 'condition', 'item_class'];

/** CST endpoints (T053): relocate, hold, history, reconcile. */
@ApiTags('CST')
@Controller('custody')
export class CstController {
  constructor(
    private readonly relocate: RelocateService,
    private readonly inventory: InventoryService,
  ) {}

  @Roles('warehouse_operator', 'admin')
  @Post('items/:itemId/relocate')
  async relocateItem(
    @Param('itemId') itemId: string,
    @Body() dto: RelocateDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.relocate.relocate(itemId, dto.binId, user.id);
    return { status: 'relocated' };
  }

  @Roles('warehouse_operator', 'admin')
  @Post('items/:itemId/hold')
  async placeHold(@Param('itemId') itemId: string, @CurrentUser() user: AuthUser) {
    await this.relocate.placeHold(itemId, user.id);
    return { status: 'hold_placed' };
  }

  @Roles('warehouse_operator', 'admin')
  @Delete('items/:itemId/hold')
  async releaseHold(@Param('itemId') itemId: string, @CurrentUser() user: AuthUser) {
    await this.relocate.releaseHold(itemId, user.id);
    return { status: 'hold_released' };
  }

  // Staff-only: these read ANY item, so a customer must use the owner-scoped
  // `/vault/items/:id/timeline` instead (which asserts ownership first).
  @Roles('warehouse_operator', 'admin')
  @Get('items/:itemId/history')
  history(@Param('itemId') itemId: string) {
    return this.inventory.history(itemId);
  }

  /** Complete, viewable per-item history timeline (Requirement 13.2). */
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

  /** CST-06: inventory report cut by shelf / owner / condition / item class. */
  @Roles('warehouse_operator', 'admin')
  @Get('report')
  report(@Query('cut') cut?: string) {
    const chosen = cut ?? 'shelf';
    if (!(CUTS as readonly string[]).includes(chosen)) {
      throw AppError.validation(`Invalid cut "${chosen}"; expected one of ${CUTS.join(', ')}`);
    }
    return this.inventory.report(chosen as Cut);
  }

  /** CST-06: the same inventory report exported as a professional PDF (Req 11.2). */
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

  /** INV-01: bin/shelf management. */
  @Roles('warehouse_operator', 'admin')
  @Post('bins')
  createBin(@Body() dto: CreateBinDto) {
    return this.inventory.createBin({ zone: dto.zone, capacity: dto.capacity, barcode: dto.barcode });
  }

  @Roles('warehouse_operator', 'admin')
  @Get('bins')
  listBins() {
    return this.inventory.listBins();
  }
}
