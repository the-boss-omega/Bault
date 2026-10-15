import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../sec/current-user.decorator';
import { Roles } from '../sec/roles.decorator';
import type { AuthUser } from '../sec/auth-context';
import { MediaService, type UploadPurpose } from './media.service';

/**
 * No `@MaxLength` on the payload any more (N17). It refused an oversized photo
 * as "data base64 must be shorter than or equal to 13981142 characters" before
 * the media service could say "the largest a photo can be is 10 MB". The service
 * now measures the base64 BEFORE decoding it, so the early refusal survives and
 * reads in megabytes; the 16 MB body cap in `main.ts` bounds the memory.
 */
class UploadDto {
  @IsString() @MinLength(1) contentType!: string;
  @IsString() @MinLength(1) dataBase64!: string;
  @IsIn(['item_intake', 'parcel']) purpose!: UploadPurpose;
}

/**
 * Uploading an image — the step that did not exist.
 *
 * Splitting upload from attach keeps the booking routes small and lets a bench
 * upload three photographs while the operator is still typing the description.
 *
 * STAFF ONLY (E9). This was open to any signed-in account on the reasoning that
 * "a key on its own grants nothing" — which left every collector able to put
 * ten megabytes of anything in the private bucket, as often as they liked, at
 * Bault's expense. Every caller in the SPA is on the warehouse console
 * (receiving, the parcel queue, the intake bench, shelving a store order); no
 * customer screen uploads. When one needs to, it gets its own purpose and its
 * own rule, rather than this route opening up again.
 */
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
