import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
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

class IntakeItemDto {
  @IsString() ownerIntakeId!: string;
  @IsString() typeClass!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() conditionGrade?: string;
  @IsString() binId!: string; // mandatory bin (Requirement 10.3)
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) quantity?: number; // bulk intake (Requirement 10.1)
  @IsOptional() @IsBoolean() isLot?: boolean; // lot support (Requirement 10.5)
  @IsOptional() @IsInt() @Min(1) @Max(1000) lotSize?: number;
}

class CorrectionPatch {
  @IsString() field!: string;
  @IsString() value!: string;
}
class CorrectDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CorrectionPatch) patches!: CorrectionPatch[];
}

class OpenBatchDto {
  @IsString() ownerIntakeId!: string;
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
  ) {}

  @Post('items')
  createItem(@Body() dto: IntakeItemDto, @CurrentUser() user: AuthUser) {
    return this.intake.intakeItem(user.id, dto);
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
  correct(@Param('itemId') itemId: string, @Body() dto: CorrectDto, @CurrentUser() user: AuthUser) {
    return this.corrections.correct(user.id, itemId, dto.patches);
  }

  @Post('batches')
  openBatch(@Body() dto: OpenBatchDto) {
    return this.batches.open(dto.ownerIntakeId);
  }

  @Post('batches/:batchId/split')
  split(@Param('batchId') batchId: string, @Body() dto: SplitDto, @CurrentUser() user: AuthUser) {
    return this.batches.split(user.id, batchId, dto.items);
  }
}
