import { Body, Controller, Get, Inject, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import type { StorageAdapter } from '@bault/adapters';
import { CurrentUser } from '../sec/current-user.decorator';
import type { AuthUser } from '../sec/auth-context';
import { Public } from '../acc/public.decorator';
import { STORAGE_ADAPTER } from '../../shared/adapters/adapters.module';
import { AppError } from '../../shared/errors/app-error';
import { MAX_IMAGE_BYTES, MediaService, type UploadPurpose } from './media.service';
import { verifyMediaKey } from './media-url';

/**
 * Base64 expands by 4/3, so the string cap is the byte cap plus room for the
 * padding and a data-URL prefix. Applied here as well as on the decoded bytes so
 * an oversized payload is refused before it is decoded into memory.
 */
const MAX_BASE64_LENGTH = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 128;

class UploadDto {
  @IsString() @MinLength(1) contentType!: string;
  @IsString() @MinLength(1) @MaxLength(MAX_BASE64_LENGTH) dataBase64!: string;
  @IsIn(['item_intake', 'parcel', 'service_media', 'wallet_document']) purpose!: UploadPurpose;
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
  constructor(
    private readonly media: MediaService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  @Post('uploads')
  upload(@CurrentUser() user: AuthUser, @Body() dto: UploadDto) {
    return this.media.upload({
      uploaderId: user.id,
      purpose: dto.purpose,
      contentType: dto.contentType,
      dataBase64: dto.dataBase64,
    });
  }

  /**
   * An image, served from the API's own origin.
   *
   * Public in the sense a presigned URL is public: no session is asked for, but
   * nothing is served without a signature minted by a route that already
   * checked who may see the image, and it expires. This is what the photo URLs
   * point at when the store is not reachable by the browser — MinIO on
   * localhost from a phone on a tunnel, or the development sandbox.
   */
  @Public()
  @Get('object')
  async object(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const expiresAt = Number(exp);
    if (!verifyMediaKey(key, expiresAt, sig)) throw AppError.notFound('Image not found');
    const found = await this.storage.getObject(key);
    if (!found) throw AppError.notFound('Image not found');
    const maxAge = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
    res.setHeader('Content-Type', found.contentType);
    res.setHeader('Cache-Control', `private, max-age=${maxAge}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(found.body);
  }
}
