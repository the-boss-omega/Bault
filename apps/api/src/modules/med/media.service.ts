import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../shared/errors/app-error';
import { STORAGE_ADAPTER } from '../../shared/adapters/adapters.module';
import type { StorageAdapter } from '@bault/adapters';

/**
 * Putting bytes into object storage — the step the platform did not have.
 *
 * `StorageAdapter.putObject` has existed since T020 and `item_image` has existed
 * since custody was built, and NOTHING in the API ever accepted an image. The
 * photography service records an object key for a photo shoot without ever
 * receiving the photograph; the only pictures in the product are the catalogue
 * files shipped in `assets/images` and served statically by Vite. So an operator
 * unpacking a box could not photograph what came out of it, and a parcel that
 * arrived crushed was described in a sentence with no evidence attached.
 *
 * TWO STEPS, DELIBERATELY. Bytes are uploaded here and the caller then references
 * the returned KEY when it creates the thing the image belongs to. That is the
 * convention the wallet request already uses for its supporting document ("an
 * already-uploaded document — never the document itself"), and it keeps intake
 * from carrying megabytes of payload through a route whose real job is booking a
 * card onto a shelf.
 *
 * Base64 in JSON rather than multipart: the API is JSON end to end, every client
 * of it speaks JSON, and adding a multipart parser to the one route that would
 * use it buys a third of the payload back in exchange for a second body-parsing
 * path and its own error shape. The size cap is applied to the DECODED bytes.
 */

/** What a browser will actually produce from a camera or a file picker. */
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/**
 * The largest image accepted, in decoded bytes.
 *
 * A phone photograph is 2–5 MB. Ten leaves room for one without inviting an
 * upload of something that is not a photograph at all, and the request body cap
 * in `main.ts` is set above this so the refusal comes from here — with a sentence
 * naming the limit — rather than from Express with a bare 413.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type UploadPurpose = 'item_intake' | 'parcel';

const PURPOSE_PREFIX: Record<UploadPurpose, string> = {
  item_intake: 'intake',
  parcel: 'parcels',
};

@Injectable()
export class MediaService {
  constructor(@Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter) {}

  /**
   * Store one image and return the key that names it.
   *
   * The key carries the date and a fresh uuid, never anything the caller chose:
   * a caller-supplied key is a caller-supplied path, and object stores are
   * unforgiving about that.
   */
  async upload(input: {
    uploaderId: string;
    purpose: UploadPurpose;
    contentType: string;
    dataBase64: string;
  }): Promise<{ objectKey: string; bytes: number; contentType: string }> {
    const contentType = input.contentType.trim().toLowerCase();
    const extension = ALLOWED_TYPES[contentType];
    if (!extension) {
      throw AppError.validation(
        `A photo has to be a JPEG, PNG, WebP or HEIC image. This one says it is "${input.contentType}".`,
      );
    }

    // A data URL is what a canvas or a FileReader hands back; accept it rather
    // than making every caller remember to strip the prefix.
    const payload = input.dataBase64.includes(',')
      ? input.dataBase64.slice(input.dataBase64.indexOf(',') + 1)
      : input.dataBase64;

    let body: Buffer;
    try {
      body = Buffer.from(payload, 'base64');
    } catch {
      throw AppError.validation('That image could not be read.');
    }
    if (body.byteLength === 0) throw AppError.validation('That image is empty.');
    if (body.byteLength > MAX_IMAGE_BYTES) {
      throw AppError.validation(
        `That image is ${(body.byteLength / 1024 / 1024).toFixed(1)} MB. The largest a photo can be is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      );
    }

    const now = new Date();
    const key = [
      PURPOSE_PREFIX[input.purpose],
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.${extension}`,
    ].join('/');

    await this.storage.putObject({ key, body, contentType });
    return { objectKey: key, bytes: body.byteLength, contentType };
  }

  /** A readable URL for a stored key, or null when it cannot be signed. */
  async signed(objectKey: string): Promise<string | null> {
    try {
      return await this.storage.getSignedUrl(objectKey);
    } catch {
      // A photo that cannot be signed should leave the record readable rather
      // than failing the whole response it was attached to.
      return null;
    }
  }

  /** Sign a list, dropping the ones that cannot be signed. */
  async signAll<T extends { objectKey: string }>(rows: readonly T[]): Promise<(T & { url: string })[]> {
    const out: (T & { url: string })[] = [];
    for (const row of rows) {
      const url = await this.signed(row.objectKey);
      if (url) out.push({ ...row, url });
    }
    return out;
  }
}
