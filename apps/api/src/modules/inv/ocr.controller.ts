import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../sec/roles.decorator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { OcrService } from './ocr.service';

class ConfirmLabelDto {
  @IsOptional() @IsString() @MaxLength(120) trackingNumber?: string;
  @IsOptional() @IsString() @MaxLength(60) carrier?: string;
  @IsOptional() @IsString() @MaxLength(120) senderName?: string;
  @IsOptional() @IsString() @MaxLength(500) senderAddress?: string;
}

class ConfirmItemDto {
  @IsOptional() @IsString() @MaxLength(120) cardName?: string;
  @IsOptional() @IsString() @MaxLength(120) setName?: string;
  @IsOptional() @IsString() @MaxLength(20) cardNumber?: string;
  @IsOptional() @IsString() @MaxLength(4) year?: string;
  @IsOptional() @IsString() @MaxLength(10) gradingBody?: string;
  @IsOptional() @IsString() @MaxLength(10) grade?: string;
  @IsOptional() @IsString() @MaxLength(20) certNumber?: string;
}

@ApiTags('INV')
@Roles('warehouse_operator', 'admin')
@Controller()
export class OcrController {
  constructor(private readonly ocr: OcrService) {}

  @Get('parcels/:id/ocr')
  parcelReading(@Param('id') id: string) {
    return this.ocr.suggestionFor('parcel', id);
  }

  @Post('parcels/:id/ocr/confirm')
  confirmParcel(@Param('id') id: string, @Body() dto: ConfirmLabelDto, @CurrentUser() user: AuthUser) {
    return this.ocr.confirm(user.id, 'parcel', id, dto);
  }

  @Get('custody/items/:id/ocr')
  itemReading(@Param('id') id: string) {
    return this.ocr.suggestionFor('item', id);
  }

  @Post('custody/items/:id/ocr/confirm')
  confirmItem(@Param('id') id: string, @Body() dto: ConfirmItemDto, @CurrentUser() user: AuthUser) {
    return this.ocr.confirm(user.id, 'item', id, dto);
  }
}
