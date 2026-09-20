import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { IntakeService } from './intake.service';
import { CorrectionService } from './correction.service';
import { BatchService } from './batch.service';
import { StowService } from '../cst/stow.service';

/**
 * `ownerUsername` is the field the intake form fills in. `ownerIntakeId` is
 * optional and legacy — kept so a package with a pre-printed OW- label can still
 * be received — and no UI offers it. `IntakeService.resolveOwner` prefers the
 * username whenever both arrive.
 */
class IntakeItemDto {
  @IsOptional() @IsString() ownerUsername?: string;
  @IsOptional() @IsString() ownerIntakeId?: string;
  @IsString() typeClass!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() conditionGrade?: string;
  /**
   * The shelf, by internal id OR by the barcode printed on it. Optional here
   * and only here: send `autoStow` instead and the system directs the stow.
   * Every item still ends up on a shelf (Requirement 10.3) — see
   * `IntakeService.resolveStowBin`.
   */
  @IsOptional() @IsString() binId?: string;
  /** Put it wherever there is room, in the building the goods are actually in. */
  @IsOptional() @IsBoolean() autoStow?: boolean;
  /** What it weighed on the bench. Left out when nobody weighed it. */
  @IsOptional() @IsInt() @Min(1) @Max(100000) weightGrams?: number;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) quantity?: number; // bulk intake (Requirement 10.1)
  @IsOptional() @IsBoolean() isLot?: boolean; // lot support (Requirement 10.5)
  @IsOptional() @IsInt() @Min(1) @Max(1000) lotSize?: number;
  /** The open inbound parcel these items came out of, when there is one. */
  @IsOptional() @IsString() parcelId?: string;
  /**
   * Photographs of the thing actually being booked in, as keys from
   * `POST /media/uploads`.
   *
   * Recorded as `item_image` rows of type `intake`, which is the pipeline the
   * customer's card drawer already reads — so a card photographed at the bench
   * shows the operator's picture of it from the moment it lands in the vault,
   * instead of the generated placeholder it showed until somebody paid for a
   * professional shoot.
   *
   * On a bulk intake every copy gets the same photographs, which is the truth:
   * one shot of a run of twelve identical commons describes all twelve.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) photoKeys?: string[];
}

/**
 * Several DIFFERENT units, booked in together.
 *
 * `quantity` on `IntakeItemDto` makes N copies of one description, which is the
 * wrong instrument for the ordinary case — a box holds a Rayquaza ex, a sealed
 * pack and a graded Gold Star. Each entry here is its own unit with its own class,
 * description, condition, serial and photographs.
 */
class IntakeUnitsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => IntakeItemDto)
  units!: IntakeItemDto[];
}

class CorrectionPatch {
  @IsString() field!: string;
  @IsString() value!: string;
}
class CorrectDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CorrectionPatch) patches!: CorrectionPatch[];
}

class OpenBatchDto {
  @IsOptional() @IsString() ownerUsername?: string;
  /** Legacy, accepted for pre-printed arrivals only. */
  @IsOptional() @IsString() ownerIntakeId?: string;
}
class SplitItemDto {
  @IsString() typeClass!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() conditionGrade?: string;
  @IsOptional() @IsString() binId?: string;
}
class SplitDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => SplitItemDto) items!: SplitItemDto[];
}

/** INV endpoints (T053). Warehouse-operator only. */
@ApiTags('INV')
@Roles('warehouse_operator', 'admin')
@Controller('intake')
export class InvController {
  constructor(
    private readonly intake: IntakeService,
    private readonly corrections: CorrectionService,
    private readonly batches: BatchService,
    private readonly stow: StowService,
  ) {}

  @Post('items')
  createItem(@Body() dto: IntakeItemDto, @CurrentUser() user: AuthUser) {
    return this.intake.intakeItem(user.id, dto);
  }

  /**
   * A box's worth of different units, in one submission.
   *
   * Declared before `items/:itemId` for the reason `listings/mine` is: the route
   * table is ordered, and a literal segment after a parameter is unreachable.
   */
  @Post('items/batch')
  createUnits(@Body() dto: IntakeUnitsDto, @CurrentUser() user: AuthUser) {
    return this.intake.intakeUnits(user.id, dto.units);
  }

  /** Lots that are still whole — the candidates for "Break Lot" (Requirement 10.5). */
  @Get('lots')
  lots() {
    return this.intake.listOpenLots();
  }

  /** Break Lot: intake each contained item of a lot individually (Requirement 10.5). */
  @Post('items/:itemId/break-lot')
  breakLot(@Param('itemId') itemId: string, @CurrentUser() user: AuthUser) {
    return this.intake.breakLot(user.id, itemId);
  }

  @Patch('items/:itemId')
  async correct(@Param('itemId') itemId: string, @Body() dto: CorrectDto, @CurrentUser() user: AuthUser) {
    // The bench corrects by scanning the label, so take the barcode or serial too.
    const target = await this.stow.resolveItem(itemId);
    return this.corrections.correct(user.id, target.id, dto.patches);
  }

  @Post('batches')
  openBatch(@Body() dto: OpenBatchDto) {
    return this.batches.open({ ownerUsername: dto.ownerUsername, ownerIntakeId: dto.ownerIntakeId });
  }

  @Post('batches/:batchId/split')
  split(@Param('batchId') batchId: string, @Body() dto: SplitDto, @CurrentUser() user: AuthUser) {
    return this.batches.split(user.id, batchId, dto.items);
  }
}
