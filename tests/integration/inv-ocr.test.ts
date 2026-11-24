import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SANDBOX_OCR_CONFIDENCE, SANDBOX_OCR_TEXT } from '../../packages/adapters/src/ocr';
import { SEED, SEED_USERNAME, intakeFor, signIn, type Client } from './helpers/http';
import { closeDb, sql } from './helpers/db';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let child: ChildProcess | null = null;
let base = '';
let output = '';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}/api/v1`;
  child = spawn(process.execPath, [join(process.cwd(), 'apps/api/dist/main.js')], {
    cwd: process.cwd(),
    env: { ...process.env, OCR_ENABLED: 'true', OCR_PROVIDER: 'sandbox', API_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => (output += String(d)));
  child.stderr?.on('data', (d) => (output += String(d)));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/readyz`);
      if (res.ok) return;
    } catch {
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the API with OCR on did not start:\n${output.slice(-2000)}`);
}, 90_000);

afterAll(async () => {
  child?.kill('SIGTERM');
  await closeDb();
});

async function photo(operator: Client, purpose: 'parcel' | 'item_intake'): Promise<string> {
  const upload = await operator.post('/media/uploads', { contentType: 'image/png', dataBase64: PNG, purpose });
  expect(upload.status, JSON.stringify(upload.body)).toBe(201);
  return upload.body.objectKey as string;
}

async function receive(operator: Client, photoKeys: string[]) {
  const facilities = (await operator.get('/me/inbound-addresses')).body as { code: string }[];
  const res = await operator.post('/parcels/receive', {
    facilityCode: facilities[0]!.code,
    addressedTo: SEED_USERNAME.collector,
    carrier: 'Unknown',
    photoKeys,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; code: string };
}

const requests = (subjectId: string) =>
  sql<{ payload: { subjectKind: string; subjectId: string; objectKey: string; kind: string } }>(
    `SELECT payload FROM outbox_message WHERE event_type = 'ocr_requested' AND aggregate_id = $1`,
    [subjectId],
  );

async function workerReads(subjectKind: 'parcel' | 'item', subjectId: string, text: string): Promise<void> {
  const [request] = await requests(subjectId);
  const lines = text.split('\n');
  await sql(
    `INSERT INTO ocr_suggestion (subject_kind, subject_id, object_key, text, confidence)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [subjectKind, subjectId, request!.payload.objectKey, text, JSON.stringify({ lines: lines.map(() => SANDBOX_OCR_CONFIDENCE) })],
  );
  await sql(`UPDATE outbox_message SET dispatched_at = now() WHERE event_type = 'ocr_requested' AND aggregate_id = $1`, [
    subjectId,
  ]);
}

describe('INV reading a parcel label at intake, with OCR on', () => {
  let operator: Client;
  let collector: Client;
  let parcel: { id: string; code: string };
  let objectKey: string;

  beforeAll(async () => {
    operator = await signIn(SEED.operator, undefined, base);
    collector = await signIn(SEED.collector, undefined, base);
    objectKey = await photo(operator, 'parcel');
    parcel = await receive(operator, [objectKey]);
  });

  it('queues one read of the first label photo when the parcel is received', async () => {
    const queued = await requests(parcel.id);
    expect(queued.map((r) => r.payload)).toEqual([
      { subjectKind: 'parcel', subjectId: parcel.id, objectKey, kind: 'label' },
    ]);
  });

  it('tells the bench nothing has been read yet, then hands the operator what was read with its confidence', async () => {
    const before = await operator.get(`/parcels/${parcel.id}/ocr`);
    expect(before.status).toBe(200);
    expect(before.body).toEqual({ ready: false });

    await workerReads('parcel', parcel.id, SANDBOX_OCR_TEXT.label);

    const res = await operator.get(`/parcels/${parcel.id}/ocr`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ready: true,
      subjectKind: 'parcel',
      subjectId: parcel.id,
      consumedAt: null,
      fields: {
        trackingNumber: '9400100000000000000000',
        carrier: 'USPS',
        senderName: 'SAM SENDER',
        senderAddress: '12 MAPLE STREET\nSPRINGFIELD IL 62704',
      },
      confidence: { trackingNumber: 0.9, carrier: 0.9, senderName: 0.9, senderAddress: 0.9 },
    });
  });

  it('refuses a collector, and shows the collector nothing that was read', async () => {
    expect((await collector.get(`/parcels/${parcel.id}/ocr`)).status).toBe(403);
    expect((await collector.post(`/parcels/${parcel.id}/ocr/confirm`, { carrier: 'USPS' })).status).toBe(403);
    const detail = await collector.get(`/parcels/${parcel.id}`);
    expect(detail.status).toBe(200);
    const seen = JSON.stringify(detail.body);
    for (const read of ['9400100000000000000000', 'SAM SENDER', 'MAPLE STREET']) expect(seen).not.toContain(read);
    expect(JSON.stringify((await collector.get('/me/parcels')).body)).not.toContain('SAM SENDER');
  });

  it('saves what the operator confirmed, with their corrections winning, and marks the reading consumed', async () => {
    const corrected = `94${String(Date.now()).padStart(14, '0')}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
    const saved = await operator.post(`/parcels/${parcel.id}/ocr/confirm`, {
      trackingNumber: corrected,
      carrier: 'USPS',
      senderName: 'Sam Sender Jr',
      senderAddress: '12 Maple Street\nSpringfield IL 62704',
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body.changed).toEqual(['carrier', 'trackingNumber', 'sender']);

    const [row] = await sql<{ carrier: string; tracking_number: string; notes: string }>(
      `SELECT carrier, tracking_number, notes FROM parcel WHERE id = $1`,
      [parcel.id],
    );
    expect(row).toMatchObject({ carrier: 'USPS', tracking_number: corrected });
    expect(row!.notes).toContain('Sender: Sam Sender Jr, 12 Maple Street, Springfield IL 62704');

    const [suggestion] = await sql<{ consumed_by: string | null; consumed_at: Date | null; fields: Record<string, string> }>(
      `SELECT s.consumed_by, s.consumed_at, s.fields FROM ocr_suggestion s WHERE s.subject_id = $1`,
      [parcel.id],
    );
    const [me] = await sql<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [SEED.operator]);
    expect(suggestion!.consumed_by).toBe(me!.id);
    expect(suggestion!.consumed_at).not.toBeNull();
    expect(suggestion!.fields.trackingNumber).toBe('9400100000000000000000');

    expect((await operator.get(`/parcels/${parcel.id}/ocr`)).body.consumedAt).not.toBeNull();
    expect((await operator.post(`/parcels/${parcel.id}/ocr/confirm`, { carrier: 'UPS' })).status).toBe(409);
  });

  it('refuses a tracking number another parcel already carries', async () => {
    const other = await receive(operator, [await photo(operator, 'parcel')]);
    await workerReads('parcel', other.id, SANDBOX_OCR_TEXT.label);
    const [mine] = await sql<{ tracking_number: string }>(`SELECT tracking_number FROM parcel WHERE id = $1`, [parcel.id]);
    const clash = await operator.post(`/parcels/${other.id}/ocr/confirm`, { trackingNumber: mine!.tracking_number });
    expect(clash.status).toBe(409);
    const [still] = await sql<{ consumed_at: Date | null }>(`SELECT consumed_at FROM ocr_suggestion WHERE subject_id = $1`, [
      other.id,
    ]);
    expect(still!.consumed_at).toBeNull();
  });

  it('answers 404 for a parcel that does not exist', async () => {
    expect((await operator.get('/parcels/00000000-0000-4000-8000-000000000000/ocr')).status).toBe(404);
    expect((await operator.get('/parcels/not-a-uuid/ocr')).status).toBe(404);
  });
});

describe('INV reading a card at intake, with OCR on', () => {
  let operator: Client;
  let collector: Client;
  let item: { id: string };

  beforeAll(async () => {
    operator = await signIn(SEED.operator, undefined, base);
    collector = await signIn(SEED.collector, undefined, base);
    const objectKey = await photo(operator, 'item_intake');
    item = await intakeFor(operator, SEED.collector, { description: 'Typed at the bench', photoKeys: [objectKey] });
    expect((await requests(item.id)).map((r) => r.payload.kind)).toEqual(['item']);
    await workerReads('item', item.id, SANDBOX_OCR_TEXT.item);
  });

  it('hands the operator every field read from the card, and refuses a collector', async () => {
    const res = await operator.get(`/custody/items/${item.id}/ocr`);
    expect(res.status).toBe(200);
    expect(res.body.fields).toEqual({
      cardName: 'RAYQUAZA-HOLO',
      setName: 'POKEMON EX DEOXYS',
      cardNumber: '107',
      year: '2005',
      gradingBody: 'PSA',
      grade: '9',
      certNumber: '12345678',
    });
    expect((await collector.get(`/custody/items/${item.id}/ocr`)).status).toBe(403);
  });

  it('refuses a certificate number of the wrong shape for its grading body', async () => {
    const res = await operator.post(`/custody/items/${item.id}/ocr/confirm`, { gradingBody: 'PSA', certNumber: '1234567' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/8 digits/);
    const bgs = await operator.post(`/custody/items/${item.id}/ocr/confirm`, { gradingBody: 'BGS', certNumber: '12345678' });
    expect(bgs.status).toBe(400);
    expect((await operator.post(`/custody/items/${item.id}/ocr/confirm`, { gradingBody: 'XYZ' })).status).toBe(400);
  });

  it('writes the operator’s corrected values to the item, not the reading', async () => {
    const saved = await operator.post(`/custody/items/${item.id}/ocr/confirm`, {
      cardName: 'Rayquaza',
      setName: 'EX Deoxys',
      cardNumber: '107/107',
      year: '2005',
      gradingBody: 'PSA',
      grade: '10',
      certNumber: '87654321',
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    const [row] = await sql<{ description: string; condition_grade: string }>(
      `SELECT description, condition_grade FROM item WHERE id = $1`,
      [item.id],
    );
    expect(row).toEqual({
      description: 'Rayquaza · EX Deoxys · 107/107 · 2005 · PSA cert 87654321',
      condition_grade: 'PSA 10',
    });
    const history = await sql<{ field: string; old_value: string | null }>(
      `SELECT field, old_value FROM item_change_history WHERE item_id = $1 ORDER BY field`,
      [item.id],
    );
    expect(history).toEqual([
      { field: 'conditionGrade', old_value: null },
      { field: 'description', old_value: 'Typed at the bench' },
    ]);
    const [suggestion] = await sql<{ consumed_at: Date | null }>(`SELECT consumed_at FROM ocr_suggestion WHERE subject_id = $1`, [
      item.id,
    ]);
    expect(suggestion!.consumed_at).not.toBeNull();
  });
});

describe('INV with OCR off', () => {
  it('queues nothing when a photo is attached, and answers 404 on every reading route', async () => {
    const operator = await signIn(SEED.operator);
    const parcel = await receive(operator, [await photo(operator, 'parcel')]);
    const item = await intakeFor(operator, SEED.collector, { photoKeys: [await photo(operator, 'item_intake')] });
    expect(await requests(parcel.id)).toEqual([]);
    expect(await requests(item.id)).toEqual([]);

    expect((await operator.get(`/parcels/${parcel.id}/ocr`)).status).toBe(404);
    expect((await operator.post(`/parcels/${parcel.id}/ocr/confirm`, { carrier: 'UPS' })).status).toBe(404);
    expect((await operator.get(`/custody/items/${item.id}/ocr`)).status).toBe(404);
    expect((await operator.post(`/custody/items/${item.id}/ocr/confirm`, { grade: '9' })).status).toBe(404);
  });
});
