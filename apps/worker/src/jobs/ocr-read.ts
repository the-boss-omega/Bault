import { dirname, join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import type { OcrKind, OcrProvider, StorageAdapter, TesseractModule, TesseractOptions } from '@bault/adapters';
import { log } from '../log';
import { reportJobFailure } from '../observability';

export const OCR_REQUESTED = 'ocr_requested';
export const OCR_MAX_ATTEMPTS = 3;
const RUN_LIMIT = 50;

export interface OcrJobDeps {
  storage: StorageAdapter;
  ocr: OcrProvider;
}

interface Request {
  id: string;
  payload: Record<string, unknown> | null;
}

interface Subject {
  subjectKind: 'parcel' | 'item';
  subjectId: string;
  objectKey: string;
  kind: OcrKind;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function subjectOf(payload: Record<string, unknown> | null): Subject | null {
  const subjectKind = payload?.subjectKind;
  const subjectId = payload?.subjectId;
  const objectKey = payload?.objectKey;
  if (subjectKind !== 'parcel' && subjectKind !== 'item') return null;
  if (typeof subjectId !== 'string' || !UUID.test(subjectId)) return null;
  if (typeof objectKey !== 'string' || objectKey.trim() === '') return null;
  return { subjectKind, subjectId, objectKey, kind: subjectKind === 'parcel' ? 'label' : 'item' };
}

export function tesseractOptions(): TesseractOptions {
  const data = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
  return {
    load: async () => (await import('tesseract.js')) as unknown as TesseractModule,
    langPath: join(data, '4.0.0_best_int'),
  };
}

async function read(db: PoolClient, deps: OcrJobDeps, subject: Subject): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM ocr_suggestion WHERE subject_kind = $1 AND subject_id = $2 LIMIT 1`,
    [subject.subjectKind, subject.subjectId],
  );
  if (rows.length > 0) return false;

  const bytes = await deps.storage.getObject(subject.objectKey);
  const reading = await deps.ocr.read(bytes, subject.kind);
  const lines = reading.blocks
    .map((b) => ({ text: b.text.replace(/\s+/g, ' ').trim(), confidence: b.confidence }))
    .filter((b) => b.text !== '');
  const inserted = await db.query(
    `INSERT INTO ocr_suggestion (subject_kind, subject_id, object_key, text, confidence)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (subject_kind, subject_id) DO NOTHING`,
    [
      subject.subjectKind,
      subject.subjectId,
      subject.objectKey,
      lines.map((l) => l.text).join('\n'),
      JSON.stringify({ lines: lines.map((l) => l.confidence) }),
    ],
  );
  return (inserted.rowCount ?? 0) > 0;
}

export async function readRequestedPhotos(pool: Pool, deps: OcrJobDeps): Promise<{ read: number; skipped: number; failed: number }> {
  const tried: string[] = [];
  const counts = { read: 0, skipped: 0, failed: 0 };

  while (tried.length < RUN_LIMIT) {
    const client = await pool.connect();
    let claimed: Request | undefined;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<Request>(
        `SELECT id, payload
           FROM outbox_message
          WHERE event_type = $1
            AND dispatched_at IS NULL
            AND attempts < $2
            AND NOT (id = ANY($3::uuid[]))
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [OCR_REQUESTED, OCR_MAX_ATTEMPTS, tried],
      );
      claimed = rows[0];
      if (!claimed) {
        await client.query('COMMIT');
        break;
      }
      tried.push(claimed.id);

      const subject = subjectOf(claimed.payload);
      const wrote = subject ? await read(client, deps, subject) : false;
      await client.query(
        `UPDATE outbox_message
            SET dispatched_at = now(), attempts = attempts + 1, last_attempt_at = now(),
                last_error = $2
          WHERE id = $1`,
        [claimed.id, subject ? null : 'The request names no photograph to read'],
      );
      await client.query('COMMIT');
      if (wrote) counts.read += 1;
      else counts.skipped += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!claimed) throw err;
      counts.failed += 1;
      await recordFailure(pool, claimed, err);
    } finally {
      client.release();
    }
  }

  if (tried.length > 0) log.info('photos read', { job: 'ocr.read', ...counts });
  return counts;
}

async function recordFailure(pool: Pool, row: Request, err: unknown): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 1_000);
  const { rows } = await pool.query<{ attempts: number }>(
    `UPDATE outbox_message
        SET attempts = attempts + 1, last_error = $2, last_attempt_at = now()
      WHERE id = $1
      RETURNING attempts`,
    [row.id, message],
  );
  const attempts = rows[0]?.attempts ?? 0;
  const fields = { job: 'ocr.read', outboxId: row.id, attempts, error: message };
  if (attempts >= OCR_MAX_ATTEMPTS) {
    log.error('a photo could not be read; the bench types it in', fields);
    reportJobFailure('ocr.read', err);
  } else {
    log.warn('reading a photo failed; it will be retried', fields);
  }
}
