import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import { Roles } from '../sec/roles.decorator';
import type { AuthUser } from '../sec/auth-context';
import { MediaService, type UploadPurpose } from './media.service';

class UploadDto {
  @IsString() @MinLength(1) contentType!: string;
  @IsString() @MinLength(1) dataBase64!: string;
  @IsIn(['item_intake', 'parcel']) purpose!: UploadPurpose;
}

@ApiTags('MED')
@Controller('media')
export class MedController {
  constructor(private readonly media: MediaService) {}

  @Roles('warehouse_operator', 'admin')
  @Post('uploads')
  upload(@CurrentUser() user: AuthUser, @Body() dto: UploadDto) {
    return this.media.upload({
      uploaderId: user.id,
      purpose: dto.purpose,
      contentType: dto.contentType,
      dataBase64: dto.dataBase64,
    });
  }
}
