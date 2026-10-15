import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { inArray, sql } from 'drizzle-orm';
import { isSafeObjectKey, type StorageAdapter } from '@bault/adapters';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { STORAGE_ADAPTER } from '../../shared/adapters/adapters.module';
import { mediaUpload } from './med.schema';

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
 *
 * THE TWO STEPS USED TO FORGET EACH OTHER. The key was handed back and nothing
 * remembered it, so the attaching routes stored whatever string they were sent:
 * a key minted for a parcel on a card, a colleague's photograph of a different
 * card from last week, a key nobody had ever uploaded. Every upload is now
 * recorded in `media_upload`, and `assertAttachable` checks a key against that
 * record before any route writes it onto an item or a parcel.
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

/**
 * How long somebody ELSE's upload may be attached for.
 *
 * The bench uploads a photograph the moment it is chosen and the form that
 * carries the key is submitted minutes later, by the same person — that is the
 * ordinary case and it is never time-limited. A colleague finishing the form at
 * the same bench is the reason the window exists at all, and half an hour is
 * generous for that. A key that turns up hours later in somebody else's hands
 * has been lifted from somewhere: a vault response, a log, a screenshot.
 */
export const FOREIGN_UPLOAD_WINDOW_MS = 30 * 60 * 1000;

export type UploadPurpose = 'item_intake' | 'parcel';

const PURPOSE_PREFIX: Record<UploadPurpose, string> = {
  item_intake: 'intake',
  parcel: 'parcels',
};

const MB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * What the bytes actually are, from their first few.
 *
 * The declared `contentType` was the only check there was, and it is whatever
 * the client typed: a text file, a PDF or a script labelled `image/png` went
 * into the bucket as a PNG and came back out of a signed URL as one. These are
 * the published signatures of the four formats a phone or a browser produces,
 * and anything else — including other images — is refused.
 */
export function sniffImageType(body: Buffer): string | null {
  const ascii = (from: number, to: number) => body.subarray(from, to).toString('latin1');
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.length >= 4 && body[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (body.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  // ISO-BMFF: a box size, then `ftyp`, then the MAJOR brand. Only the major
  // brand is read: AVIF lists `mif1` among its compatible brands, and reading
  // those would let it in as HEIF.
  if (body.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'heic' || brand === 'heix') return 'image/heic';
    if (brand === 'mif1' || brand === 'msf1') return 'image/heif';
  }
  return null;
}

/** Decoded size of a base64 string, without decoding it. */
function decodedLength(base64: string): number {
  const trimmed = base64.replace(/\s+/g, '');
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding);
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger('MediaService');

  constructor(
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

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
    const declared = input.contentType.trim().toLowerCase();
    if (!ALLOWED_TYPES[declared]) {
      throw AppError.validation(
        `A photo has to be a JPEG, PNG, WebP or HEIC image. This one says it is "${input.contentType}".`,
      );
    }

    // A data URL is what a canvas or a FileReader hands back; accept it rather
    // than making every caller remember to strip the prefix.
    const payload = input.dataBase64.includes(',')
      ? input.dataBase64.slice(input.dataBase64.indexOf(',') + 1)
      : input.dataBase64;

    /**
     * The size, BEFORE anything is decoded (N17).
     *
     * The DTO used to cap the string with `@MaxLength`, which did refuse early —
     * as "data base64 must be shorter than or equal to 13981142 characters", a
     * sentence about base64 that nobody holding a photograph can act on. The
     * arithmetic below costs nothing and says it in megabytes. The body parser's
     * 16 MB cap in `main.ts` is still what bounds the memory.
     */
    const estimated = decodedLength(payload);
    if (estimated > MAX_IMAGE_BYTES) {
      throw AppError.validation(
        `That image is ${MB(estimated)}. The largest a photo can be is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      );
    }

    const body = Buffer.from(payload, 'base64');
    if (body.byteLength === 0) throw AppError.validation('That image is empty.');
    if (body.byteLength > MAX_IMAGE_BYTES) {
      throw AppError.validation(
        `That image is ${MB(body.byteLength)}. The largest a photo can be is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      );
    }

    // The type is what the bytes ARE. The declared one only had to be plausible;
    // a browser names a file's type from its extension, so a `.png` that is
    // really a JPEG is stored — correctly — as a JPEG.
    const contentType = sniffImageType(body);
    if (!contentType) {
      throw AppError.validation(
        'That file is not a photograph. A photo has to be a JPEG, PNG, WebP or HEIC image.',
      );
    }
    const extension = ALLOWED_TYPES[contentType]!;

    const now = new Date();
    const key = [
      PURPOSE_PREFIX[input.purpose],
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.${extension}`,
    ].join('/');

    /**
     * A store that is down is a 503 that says so (E10).
     *
     * The adapter throws a plain `Error` — a refused connection, a signature the
     * bucket rejected — and that reached the client as `internal`, identical to
     * a bug. The underlying reason goes to the log, where the person who can fix
     * the bucket will look; the operator is told the one thing they can act on.
     */
    try {
      await this.storage.putObject({ key, body, contentType });
    } catch (e) {
      this.logger.error(`Storage refused ${key}: ${e instanceof Error ? e.message : String(e)}`);
      throw new AppError(
        ErrorCode.STORAGE_UNAVAILABLE,
        'Photo storage cannot be reached right now, so the photo was not saved. Try again in a few minutes.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // After the bytes are safely stored, never before: a row for an object that
    // does not exist would make a key attachable that resolves to nothing.
    await this.db.insert(mediaUpload).values({
      objectKey: key,
      purpose: input.purpose,
      uploadedBy: input.uploaderId,
      contentType,
      bytes: body.byteLength,
    });
    return { objectKey: key, bytes: body.byteLength, contentType };
  }

  /**
   * Refuse to record a photograph this API cannot vouch for (F453).
   *
   * Three questions, answered from `media_upload`:
   *
   *  1. Was it uploaded HERE? A key nobody uploaded is a guess at somebody
   *     else's object, or a path, and attaching it hands out a signed link.
   *  2. For THIS kind of thing? A parcel photograph is evidence about a box; on
   *     an item it would show the collector a picture of a different object.
   *  3. By THIS person, or recently? The person attaching it uploaded it — the
   *     bench's ordinary case, never time-limited — or a colleague did within
   *     `FOREIGN_UPLOAD_WINDOW_MS`. Somebody else's key from hours ago is a key
   *     that was lifted, and a stolen key attached to another card is exactly
   *     what this exists to stop.
   *
   * WHY A TABLE AND NOT A SIGNED TOKEN. A key carrying an HMAC of its uploader
   * would prove (3) without a row, but it cannot answer (1) for the life of the
   * key without a secret that never rotates, it changes the key format every
   * client already stores, and it leaves no record of what was uploaded and
   * never attached — which is what a cleanup of the bucket will need.
   *
   * Reads inside the caller's transaction, so the check and the write it guards
   * see the same database.
   */
  async assertAttachable(
    tx: Database,
    keys: readonly string[],
    expected: { purpose: UploadPurpose; actorId: string },
  ): Promise<void> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return;
    for (const key of unique) {
      // The DTOs refuse these already; repeated here because this is the last
      // point before a key is written somewhere a signed URL will be made from.
      if (!isSafeObjectKey(key)) {
        throw AppError.validation(`Photo "${key}" has a "." or ".." segment, which a key cannot have.`);
      }
    }

    // "Recent" is decided by the database's clock, the one that stamped the
    // upload, so a skewed API host cannot widen or close the window.
    const rows = await tx
      .select({
        objectKey: mediaUpload.objectKey,
        purpose: mediaUpload.purpose,
        uploadedBy: mediaUpload.uploadedBy,
        recent: sql<boolean>`${mediaUpload.createdAt} > now() - make_interval(secs => ${FOREIGN_UPLOAD_WINDOW_MS / 1000})`,
      })
      .from(mediaUpload)
      .where(inArray(mediaUpload.objectKey, unique));
    const byKey = new Map(rows.map((r) => [r.objectKey, r]));
    for (const key of unique) {
      const row = byKey.get(key);
      if (!row) {
        throw AppError.validation(`Photo "${key}" was not uploaded here. Take or choose the photo again.`);
      }
      if (row.purpose !== expected.purpose) {
        throw AppError.validation(
          `Photo "${key}" was taken for ${row.purpose === 'parcel' ? 'a parcel' : 'an item'}, not for this.`,
        );
      }
      if (row.uploadedBy !== expected.actorId && !row.recent) {
        throw AppError.forbidden(
          `Photo "${key}" was uploaded by somebody else more than ${FOREIGN_UPLOAD_WINDOW_MS / 60_000} minutes ago. Take the photo again.`,
        );
      }
    }
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
