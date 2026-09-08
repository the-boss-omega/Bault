import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { MAX_IMAGE_BYTES, MediaService, type UploadPurpose } from './media.service';

/**
 * Base64 expands by 4/3, so the string cap is the byte cap plus room for the
 * padding and a data-URL prefix. Applied here as well as on the decoded bytes so
 * an oversized payload is refused before it is decoded into memory.
 */
const MAX_BASE64_LENGTH = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 128;

class UploadDto {
  @IsString() @MinLength(1) contentType!: string;
  @IsString() @MinLength(1) @MaxLength(MAX_BASE64_LENGTH) dataBase64!: string;
  @IsIn(['item_intake', 'parcel']) purpose!: UploadPurpose;
}

/**
 * Uploading an image — the step that did not exist.
 *
 * Any signed-in caller may put bytes in storage; a key on its own grants nothing,
 * and every route that ATTACHES a key checks who is allowed to attach it (intake
 * and the parcel bench are both staff-only). Splitting it this way keeps the
 * booking routes small and lets a bench upload three photographs while the
 * operator is still typing the description.
 */
@ApiTags('MED')
@Controller('media')
export class MedController {
  constructor(private readonly media: MediaService) {}

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
