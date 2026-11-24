import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { isSafeObjectKey, type StorageAdapter } from '@bault/adapters';
import { DRIZZLE } from '../../db/db.module';
import type { Database } from '../../db/client';
import { AppError } from '../../shared/errors/app-error';
import { ErrorCode } from '../../shared/errors/error-codes';
import { STORAGE_ADAPTER } from '../../shared/adapters/adapters.module';
import { mediaUpload } from './med.schema';

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

export const FOREIGN_UPLOAD_WINDOW_MS = 30 * 60 * 1000;

export const RECEIPT_URL_SECONDS = 300;

export type UploadPurpose = 'item_intake' | 'parcel' | 'cash_in_receipt';

export const STAFF_UPLOAD_PURPOSES: readonly UploadPurpose[] = ['item_intake', 'parcel'];

export const COLLECTOR_UPLOAD_PURPOSES: readonly UploadPurpose[] = ['cash_in_receipt'];

interface PurposeRule {
  prefix: (uploaderId: string) => string;
  types: readonly string[];
  maxBytes: number;
  noun: string;
  kinds: string;
  attachedTo: string;
  ownOnly: boolean;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

const PURPOSES: Record<UploadPurpose, PurposeRule> = {
  item_intake: {
    prefix: () => 'intake',
    types: IMAGE_TYPES,
    maxBytes: MAX_IMAGE_BYTES,
    noun: 'photo',
    kinds: 'a JPEG, PNG, WebP or HEIC image',
    attachedTo: 'an item',
    ownOnly: false,
  },
  parcel: {
    prefix: () => 'parcels',
    types: IMAGE_TYPES,
    maxBytes: MAX_IMAGE_BYTES,
    noun: 'photo',
    kinds: 'a JPEG, PNG, WebP or HEIC image',
    attachedTo: 'a parcel',
    ownOnly: false,
  },
  cash_in_receipt: {
    prefix: (uploaderId) => `receipts/${uploaderId}`,
    types: [...IMAGE_TYPES, 'application/pdf'],
    maxBytes: MAX_RECEIPT_BYTES,
    noun: 'receipt',
    kinds: 'a PDF or a JPEG, PNG, WebP or HEIC image',
    attachedTo: 'a cash-in receipt',
    ownOnly: true,
  },
};

const MB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function sniffImageType(body: Buffer): string | null {
  const ascii = (from: number, to: number) => body.subarray(from, to).toString('latin1');
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.length >= 4 && body[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (body.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (body.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'heic' || brand === 'heix') return 'image/heic';
    if (brand === 'mif1' || brand === 'msf1') return 'image/heif';
  }
  return null;
}

export function sniffUploadType(body: Buffer): string | null {
  if (body.length >= 5 && body.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return sniffImageType(body);
}

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

  async upload(input: {
    uploaderId: string;
    purpose: UploadPurpose;
    contentType: string;
    dataBase64: string;
  }): Promise<{ objectKey: string; bytes: number; contentType: string }> {
    const rule = PURPOSES[input.purpose];
    const limit = `${rule.maxBytes / 1024 / 1024} MB`;
    const declared = input.contentType.trim().toLowerCase();
    if (!rule.types.includes(declared)) {
      throw AppError.validation(
        `A ${rule.noun} has to be ${rule.kinds}. This one says it is "${input.contentType}".`,
      );
    }

    const payload = input.dataBase64.includes(',')
      ? input.dataBase64.slice(input.dataBase64.indexOf(',') + 1)
      : input.dataBase64;

    const estimated = decodedLength(payload);
    if (estimated > rule.maxBytes) {
      throw AppError.validation(`That file is ${MB(estimated)}. The largest a ${rule.noun} can be is ${limit}.`);
    }

    const body = Buffer.from(payload, 'base64');
    if (body.byteLength === 0) throw AppError.validation('That file is empty.');
    if (body.byteLength > rule.maxBytes) {
      throw AppError.validation(`That file is ${MB(body.byteLength)}. The largest a ${rule.noun} can be is ${limit}.`);
    }

    const contentType = sniffUploadType(body);
    if (!contentType || !rule.types.includes(contentType)) {
      throw AppError.validation(
        `That file is not what it says it is. A ${rule.noun} has to be ${rule.kinds}.`,
      );
    }
    const extension = ALLOWED_TYPES[contentType]!;

    const now = new Date();
    const key = [
      rule.prefix(input.uploaderId),
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.${extension}`,
    ].join('/');

    try {
      await this.storage.putObject({ key, body, contentType });
    } catch (e) {
      this.logger.error(`Storage refused ${key}: ${e instanceof Error ? e.message : String(e)}`);
      throw new AppError(
        ErrorCode.STORAGE_UNAVAILABLE,
        `File storage cannot be reached right now, so the ${rule.noun} was not saved. Try again in a few minutes.`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    await this.db.insert(mediaUpload).values({
      objectKey: key,
      purpose: input.purpose,
      uploadedBy: input.uploaderId,
      contentType,
      bytes: body.byteLength,
    });
    return { objectKey: key, bytes: body.byteLength, contentType };
  }

  async assertAttachable(
    tx: Database,
    keys: readonly string[],
    expected: { purpose: UploadPurpose; actorId: string },
  ): Promise<void> {
    const unique = [...new Set(keys)];
    if (unique.length === 0) return;
    for (const key of unique) {
      if (!isSafeObjectKey(key)) {
        throw AppError.validation(
          `${capitalised(PURPOSES[expected.purpose].noun)} "${key}" has a "." or ".." segment, which a key cannot have.`,
        );
      }
    }

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
        throw AppError.validation(
          `${capitalised(PURPOSES[expected.purpose].noun)} "${key}" was not uploaded here. Choose the file again.`,
        );
      }
      const rule = PURPOSES[expected.purpose];
      const what = capitalised(rule.noun);
      if (row.purpose !== expected.purpose) {
        throw AppError.validation(`${what} "${key}" was uploaded for ${PURPOSES[row.purpose].attachedTo}, not for this.`);
      }
      if (row.uploadedBy !== expected.actorId && rule.ownOnly) {
        throw AppError.forbidden(`${what} "${key}" was uploaded by somebody else. Upload your own.`);
      }
      if (row.uploadedBy !== expected.actorId && !row.recent) {
        throw AppError.forbidden(
          `${what} "${key}" was uploaded by somebody else more than ${FOREIGN_UPLOAD_WINDOW_MS / 60_000} minutes ago. Take the photo again.`,
        );
      }
    }
  }

  async contentTypeOf(objectKey: string): Promise<string | null> {
    const [row] = await this.db
      .select({ contentType: mediaUpload.contentType })
      .from(mediaUpload)
      .where(eq(mediaUpload.objectKey, objectKey))
      .limit(1);
    return row?.contentType ?? null;
  }

  async signed(objectKey: string, expiresInSeconds?: number): Promise<string | null> {
    try {
      return await this.storage.getSignedUrl(objectKey, expiresInSeconds);
    } catch {
      return null;
    }
  }

  async signAll<T extends { objectKey: string }>(rows: readonly T[]): Promise<(T & { url: string })[]> {
    const out: (T & { url: string })[] = [];
    for (const row of rows) {
      const url = await this.signed(row.objectKey);
      if (url) out.push({ ...row, url });
    }
    return out;
  }
}
