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

/**
 * `binId` takes the shelf's BARCODE as readily as its internal id, because the
 * barcode is what is printed on the shelf and therefore what a scanner
 * produces. The field keeps its name so every existing caller still works.
 */
class RelocateDto {
  @IsString()
  binId!: string;
}

/**
 * A bin is a shelf in a building, and optionally the oversized kind.
 *
 * No capacity — nothing enforced it and nothing could
 * (`0018_stow_wherever_it_fits`) — and no barcode, because the shelf's serial is
 * minted rather than named (`0019_bins_get_a_serial`).
 */
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

/** CST endpoints (T053): relocate, hold, history, reconcile. */
@ApiTags('CST')
@Controller('custody')
export class CstController {
  constructor(
    private readonly relocate: RelocateService,
    private readonly inventory: InventoryService,
    private readonly stow: StowService,
  ) {}

  /**
   * Move an item to another shelf.
   *
   * Both identifiers are whatever the scanner produced: the item by its printed
   * barcode (or serial, or id) and the destination by its shelf barcode (or
   * id). Before this, the console's "scan item" field accepted only the internal
   * id — a string that appears on no label in the building — so scanning the
   * label Bault itself printed was the one thing that could not work.
   */
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

  /**
   * Placing a hold is idempotent, and now SAYS whether it did anything.
   *
   * It answered `hold_placed` either way, so an operator who scanned a card that
   * was already frozen was told the hold had just been placed. The data was
   * always right; the bench was told a story about work it had not done, on the
   * one screen whose entire job is saying what happened to a card.
   */
  @Roles('warehouse_operator', 'admin')
  @Post('items/:itemId/hold')
  async placeHold(@Param('itemId') itemId: string, @CurrentUser() user: AuthUser) {
    // The bench scans the label, so take a barcode or serial as well as the id.
    const target = await this.stow.resolveItem(itemId);
    const changed = await this.relocate.placeHold(target.id, user.id);
    return { status: changed ? 'hold_placed' : 'already_on_hold', changed };
  }

  @Roles('warehouse_operator', 'admin')
  @Delete('items/:itemId/hold')
  async releaseHold(@Param('itemId') itemId: string, @CurrentUser() user: AuthUser) {
    const target = await this.stow.resolveItem(itemId);
    const changed = await this.relocate.releaseHold(target.id, user.id);
    return { status: changed ? 'hold_released' : 'was_not_on_hold', changed };
  }

  /** One item, by any label the bench can scan. Staff-only, like the history below. */
  @Roles('warehouse_operator', 'admin')
  @Get('items/:itemId')
  lookup(@Param('itemId') itemId: string) {
    return this.inventory.lookup(itemId);
  }

  // Staff-only: these read ANY item, so a customer must use the owner-scoped
  // `/vault/items/:id/timeline` instead (which asserts ownership first).
  @Roles('warehouse_operator', 'admin')
  @Get('items/:itemId/history')
  async history(@Param('itemId') itemId: string) {
    return this.inventory.history((await this.stow.resolveItem(itemId)).id);
  }

  /** Complete, viewable per-item history timeline (Requirement 13.2). */
  @Roles('warehouse_operator', 'admin')
  @Get('items/:itemId/timeline')
  async timeline(@Param('itemId') itemId: string) {
    return this.inventory.itemTimeline((await this.stow.resolveItem(itemId)).id);
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

  /**
   * Where should this go? — the directed-stow answer.
   *
   * The operator does not choose a shelf from a list of every shelf in the
   * company; they ask where there is room and are sent somewhere. `facilityCode`
   * scopes it to the building the goods are actually in, `oversized` to the kind
   * of shelving the goods need.
   */
  @Roles('warehouse_operator', 'admin')
  @Get('bins/suggest')
  async suggestBin(
    @Query('facilityCode') facilityCode?: string,
    @Query('oversized') oversized?: string,
  ) {
    const facilityId = await this.stow.facilityIdByCode(facilityCode);
    return this.stow.suggest({ facilityId, oversized: oversized === 'true' });
  }

  /** The same set, emptiest first, for an operator who wants to pick instead. */
  @Roles('warehouse_operator', 'admin')
  @Get('bins/stowable')
  async stowableBins(
    @Query('facilityCode') facilityCode?: string,
    @Query('oversized') oversized?: string,
  ) {
    const facilityId = await this.stow.facilityIdByCode(facilityCode);
    return this.stow.listStowable({ facilityId, oversized: oversized === 'true' });
  }

  /** Take a shelf out of service, or put it back. Never a delete. */
  @Roles('warehouse_operator', 'admin')
  @Patch('bins/:binId')
  setBinActive(@Param('binId') binId: string, @Body() dto: BinActiveDto) {
    return this.inventory.setBinActive(binId, dto.active);
  }
}
