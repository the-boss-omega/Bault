import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { AppError } from '../../shared/errors/app-error';
import {
  COLLECTOR_UPLOAD_PURPOSES,
  MediaService,
  STAFF_UPLOAD_PURPOSES,
  type UploadPurpose,
} from './media.service';

class UploadDto {
  @IsString() @MinLength(1) contentType!: string;
  @IsString() @MinLength(1) dataBase64!: string;
  @IsIn([...STAFF_UPLOAD_PURPOSES, ...COLLECTOR_UPLOAD_PURPOSES]) purpose!: UploadPurpose;
}

@ApiTags('MED')
@Controller('media')
export class MedController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  upload(@CurrentUser() user: AuthUser, @Body() dto: UploadDto) {
    const allowed = user.role === 'user' ? COLLECTOR_UPLOAD_PURPOSES : STAFF_UPLOAD_PURPOSES;
    if (!allowed.includes(dto.purpose)) {
      throw AppError.forbidden(
        user.role === 'user' ? 'This page is for Card Embassy staff.' : 'Only a collector uploads a cash-in receipt.',
      );
    }
    return this.media.upload({
      uploaderId: user.id,
      purpose: dto.purpose,
      contentType: dto.contentType,
      dataBase64: dto.dataBase64,
    });
  }
}
