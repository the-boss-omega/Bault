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
import { IsObjectKey } from '../../shared/object-key';
import { IntakeService } from './intake.service';
import { CorrectionService } from './correction.service';
import { BatchService } from './batch.service';

class IntakeItemDto {
  @IsOptional() @IsString() ownerUsername?: string;
  @IsOptional() @IsString() ownerIntakeId?: string;
  @IsString() typeClass!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() conditionGrade?: string;
  @IsOptional() @IsString() binId?: string;
  @IsOptional() @IsBoolean() autoStow?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(100000) weightGrams?: number;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) quantity?: number;
  @IsOptional() @IsBoolean() isLot?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(1000) lotSize?: number;
  @IsOptional() @IsString() parcelId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @IsObjectKey({ each: true }) photoKeys?: string[];
}

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

  @Post('items/batch')
  createUnits(@Body() dto: IntakeUnitsDto, @CurrentUser() user: AuthUser) {
    return this.intake.intakeUnits(user.id, dto.units);
  }

  @Get('lots')
  lots() {
    return this.intake.listOpenLots();
  }

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
    return this.batches.open({ ownerUsername: dto.ownerUsername, ownerIntakeId: dto.ownerIntakeId });
  }

  @Post('batches/:batchId/split')
  split(@Param('batchId') batchId: string, @Body() dto: SplitDto, @CurrentUser() user: AuthUser) {
    return this.batches.split(user.id, batchId, dto.items);
  }
}
