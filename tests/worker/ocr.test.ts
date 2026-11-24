import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { loadEnv } from '@bault/config';
import {
  SANDBOX_OCR_TEXT,
  SandboxOcrProvider,
  SandboxStorageAdapter,
  type OcrKind,
  type OcrProvider,
  type StorageAdapter,
} from '@bault/adapters';
import { OCR_MAX_ATTEMPTS, OCR_REQUESTED, readRequestedPhotos } from '../../apps/worker/src/jobs/ocr-read';
import { dispatchOutbox } from '../../apps/worker/src/jobs/outbox-dispatch';
import { count, createItem, createUser, testPool } from './helpers/db';

let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

class RecordingReader implements OcrProvider {
  readonly name = 'sandbox' as const;
  readonly seen: { bytes: Buffer; kind: OcrKind }[] = [];
  private readonly inner = new SandboxOcrProvider();
  async read(bytes: Buffer, kind: OcrKind) {
    this.seen.push({ bytes, kind });
    return this.inner.read(bytes, kind);
  }
  async close() {}
}

const tag = () => randomBytes(5).toString('hex');

async function createParcel(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO parcel (code, facility_id, status, received_at)
     VALUES ($1, (SELECT id FROM facility ORDER BY created_at LIMIT 1), 'unclaimed', now())
     RETURNING id`,
    [`PCL-WK-${tag()}`],
  );
  return rows[0]!.id;
}

async function requestRead(subjectKind: 'parcel' | 'item', subjectId: string, objectKey: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO outbox_message (aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id`,
    [
      subjectKind,
      subjectId,
      OCR_REQUESTED,
      JSON.stringify({ subjectKind, subjectId, objectKey, kind: subjectKind === 'parcel' ? 'label' : 'item' }),
    ],
  );
  return rows[0]!.id;
}

async function stored(storage: StorageAdapter, prefix: string): Promise<{ key: string; body: Buffer }> {
  const key = `${prefix}/worker-test/${tag()}.png`;
  const body = randomBytes(64);
  await storage.putObject({ key, body, contentType: 'image/png' });
  return { key, body };
}

const suggestions = (subjectId: string) =>
  pool.query<{ subject_kind: string; object_key: string; text: string; confidence: { lines: number[] }; fields: object }>(
    `SELECT subject_kind, object_key, text, confidence, fields FROM ocr_suggestion WHERE subject_id = $1`,
    [subjectId],
  );

const outboxRow = async (id: string) =>
  (
    await pool.query<{ dispatched_at: Date | null; attempts: number; last_error: string | null }>(
      `SELECT dispatched_at, attempts, last_error FROM outbox_message WHERE id = $1`,
      [id],
    )
  ).rows[0]!;

describe('reading a photograph that was attached at intake', () => {
  it('reads the stored label through the storage adapter and writes the suggestion', async () => {
    const storage = new SandboxStorageAdapter();
    const ocr = new RecordingReader();
    const parcelId = await createParcel();
    const photo = await stored(storage, 'parcels');
    const message = await requestRead('parcel', parcelId, photo.key);

    await readRequestedPhotos(pool, { storage, ocr });

    const mine = ocr.seen.filter((s) => s.bytes.equals(photo.body));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.kind).toBe('label');
    const { rows } = await suggestions(parcelId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subject_kind: 'parcel', object_key: photo.key, text: SANDBOX_OCR_TEXT.label });
    expect(rows[0]!.confidence.lines).toHaveLength(SANDBOX_OCR_TEXT.label.split('\n').length);
    expect((await outboxRow(message)).dispatched_at).not.toBeNull();
  });

  it('reads an item photograph as a card', async () => {
    const storage = new SandboxStorageAdapter();
    const ocr = new RecordingReader();
    const itemId = await createItem(pool, await createUser(pool), 0);
    const photo = await stored(storage, 'intake');
    await requestRead('item', itemId, photo.key);

    await readRequestedPhotos(pool, { storage, ocr });

    expect(ocr.seen.find((s) => s.bytes.equals(photo.body))?.kind).toBe('item');
    const { rows } = await suggestions(itemId);
    expect(rows.map((r) => [r.subject_kind, r.text])).toEqual([['item', SANDBOX_OCR_TEXT.item]]);
  });

  it('is idempotent when the request is delivered again, or twice at once', async () => {
    const storage = new SandboxStorageAdapter();
    const ocr = new RecordingReader();
    const parcelId = await createParcel();
    const photo = await stored(storage, 'parcels');
    const message = await requestRead('parcel', parcelId, photo.key);
    await readRequestedPhotos(pool, { storage, ocr });

    await pool.query(`UPDATE outbox_message SET dispatched_at = NULL WHERE id = $1`, [message]);
    await requestRead('parcel', parcelId, photo.key);
    await Promise.all([readRequestedPhotos(pool, { storage, ocr }), readRequestedPhotos(pool, { storage, ocr })]);

    expect((await suggestions(parcelId)).rows).toHaveLength(1);
    expect(ocr.seen.filter((s) => s.bytes.equals(photo.body))).toHaveLength(1);
    expect(
      await count(pool, `SELECT 1 FROM outbox_message WHERE aggregate_id = $1 AND dispatched_at IS NULL`, [parcelId]),
    ).toBe(0);
  });

  it('retries a photograph it could not fetch, then gives up and leaves the bench to type it', async () => {
    const failing: StorageAdapter = {
      putObject: async (req) => ({ key: req.key }),
      getSignedUrl: async (key) => key,
      getObject: async () => {
        throw new Error('the object store is down');
      },
    };
    const parcelId = await createParcel();
    const message = await requestRead('parcel', parcelId, `parcels/worker-test/${tag()}.png`);

    for (let run = 0; run < OCR_MAX_ATTEMPTS + 1; run += 1) {
      await readRequestedPhotos(pool, { storage: failing, ocr: new RecordingReader() });
    }

    const row = await outboxRow(message);
    expect(row.attempts).toBe(OCR_MAX_ATTEMPTS);
    expect(row.dispatched_at).toBeNull();
    expect(row.last_error).toMatch(/object store is down/);
    expect((await suggestions(parcelId)).rows).toHaveLength(0);
  });

  it('is left alone by the notification dispatcher', async () => {
    const parcelId = await createParcel();
    const message = await requestRead('parcel', parcelId, `parcels/worker-test/${tag()}.png`);
    await dispatchOutbox(pool);
    const row = await outboxRow(message);
    expect(row.dispatched_at).toBeNull();
    expect(row.attempts).toBe(0);
  });
});

describe('a read slower than the worker role allows a transaction to sit idle', () => {
  it('lands, without the session being ended under it', async () => {
    const strict = new Pool({
      connectionString: loadEnv().DIRECT_DATABASE_URL,
      options: '-c idle_in_transaction_session_timeout=1000',
    });
    strict.on('error', () => undefined);
    const storage = new SandboxStorageAdapter();
    const photo = await stored(storage, 'parcels');
    const parcel = await createParcel();
    const id = await requestRead('parcel', parcel, photo.key);
    const inner = new SandboxOcrProvider();
    const slow: OcrProvider = {
      name: 'sandbox',
      async read(bytes, kind) {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        return inner.read(bytes, kind);
      },
      async close() {},
    };
    try {
      await readRequestedPhotos(strict, { storage, ocr: slow });
    } finally {
      await strict.end();
    }
    expect((await suggestions(parcel)).rows).toHaveLength(1);
    expect((await outboxRow(id)).dispatched_at).not.toBeNull();
  });
});
