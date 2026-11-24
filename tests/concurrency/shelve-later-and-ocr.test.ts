import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SANDBOX_OCR_CONFIDENCE, SANDBOX_OCR_TEXT } from '../../packages/adapters/src/ocr';
import { SEED, SEED_PASSWORD, SEED_USERNAME, signIn, type Client } from '../integration/helpers/http';
import { closeDb, holdRowLock, sql, waitForLockWaiters } from '../integration/helpers/db';
import { startOcrApi, type OcrApi } from '../integration/helpers/ocr-api';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Res = Awaited<ReturnType<Client['post']>>;

let ocrApi: OcrApi;
let secondOperatorEmail: string;

async function secondOperator(): Promise<string> {
  const tag = randomBytes(4).toString('hex');
  const email = `operator-${tag}@fixture.bault.test`;
  await sql(
    `INSERT INTO user_account (email, username, password_hash, status, role, first_name, last_name)
     SELECT $1, $2, password_hash, 'active', 'warehouse_operator', 'Second', 'Operator'
       FROM user_account WHERE email = $3`,
    [email, `op${tag}`, SEED.operator],
  );
  return email;
}

async function openParcelFor(operator: Client, username: string, photoKeys: string[] = []) {
  const facilities = (await operator.get('/me/inbound-addresses')).body as { code: string }[];
  const received = await operator.post('/parcels/receive', {
    facilityCode: facilities[0]!.code,
    addressedTo: username,
    carrier: 'USPS',
    trackingNumber: `94${Date.now()}${randomBytes(3).toString('hex')}`,
    photoKeys,
  });
  expect(received.status, JSON.stringify(received.body)).toBe(201);
  return received.body as { id: string; code: string };
}

beforeAll(async () => {
  secondOperatorEmail = await secondOperator();
  ocrApi = await startOcrApi();
}, 90_000);

afterAll(async () => {
  ocrApi?.stop();
  await closeDb();
});

describe('concurrency: two operators booking one parcel in with the shelf left for later', () => {
  it('creates every unit once, each on the To shelve list once, whoever books first', async () => {
    const first = await signIn(SEED.operator, SEED_PASSWORD);
    const second = await signIn(secondOperatorEmail, SEED_PASSWORD);
    const parcel = await openParcelFor(first, SEED_USERNAME.collector);
    const opened = await first.post(`/parcels/${parcel.id}/open`, { condition: 'sound', conditionNotes: 'Two operators at one bench.' });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);

    const unit = (who: string, n: number) => ({
      ownerUsername: SEED_USERNAME.collector,
      typeClass: 'trading_card',
      parcelId: parcel.id,
      placement: 'later',
      placementReason: 'Shelf full',
      description: `${who} unit ${n}`,
    });
    const rounds = 4;
    const answers: Res[] = [];
    for (let round = 0; round < rounds; round += 1) {
      answers.push(
        ...(await Promise.all([
          first.post('/intake/items', unit('first', round)),
          second.post('/intake/items', unit('second', round)),
          first.post('/intake/items/batch', { units: [unit('first-batch', round), unit('first-batch', round + 100)] }),
          second.post('/intake/items/batch', { units: [unit('second-batch', round), unit('second-batch', round + 100)] }),
        ])),
      );
    }
    for (const a of answers) expect(a.status, JSON.stringify(a.body)).toBe(201);
    const booked = answers.flatMap((a) => (Array.isArray(a.body) ? a.body : [a.body])) as { id: string; serialNumber: string }[];
    expect(booked).toHaveLength(rounds * 6);

    const items = await sql<{ id: string; serial_number: string; barcode: string; description: string; bin_id: string | null }>(
      `SELECT id, serial_number, barcode, description, bin_id FROM item WHERE source_parcel_id = $1`,
      [parcel.id],
    );
    expect(items).toHaveLength(rounds * 6);
    expect(new Set(items.map((i) => i.serial_number)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.barcode)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.description)).size).toBe(items.length);
    expect(items.every((i) => i.bin_id === null)).toBe(true);
    expect(new Set(booked.map((b) => b.id))).toEqual(new Set(items.map((i) => i.id)));

    const queue = (await first.get('/custody/to-shelve')).body as { itemId: string; parcelCode: string | null }[];
    const mine = queue.filter((r) => r.parcelCode === parcel.code);
    expect(mine).toHaveLength(items.length);
    expect(new Set(mine.map((r) => r.itemId))).toEqual(new Set(items.map((i) => i.id)));

    const [charges] = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM charge WHERE action_type = 'intake' AND reference_id = ANY($1::text[])`,
      [items.map((i) => i.id)],
    );
    expect(charges!.n).toBe(items.length);
  });
});

describe('concurrency: two operators confirming the same reading of a label', () => {
  it('saves it once: one confirmation is taken, the other is told it was already saved', async () => {
    const first = await signIn(SEED.operator, SEED_PASSWORD, ocrApi.base);
    const second = await signIn(secondOperatorEmail, SEED_PASSWORD, ocrApi.base);
    const upload = await first.post('/media/uploads', { contentType: 'image/png', dataBase64: PNG, purpose: 'parcel' });
    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    const parcel = await openParcelFor(first, SEED_USERNAME.collector2, [upload.body.objectKey]);
    const [suggestion] = await sql<{ id: string }>(
      `INSERT INTO ocr_suggestion (subject_kind, subject_id, object_key, text, confidence)
       VALUES ('parcel', $1, $2, $3, $4::jsonb) RETURNING id`,
      [
        parcel.id,
        upload.body.objectKey,
        SANDBOX_OCR_TEXT.label,
        JSON.stringify({ lines: SANDBOX_OCR_TEXT.label.split('\n').map(() => SANDBOX_OCR_CONFIDENCE) }),
      ],
    );
    await sql(`UPDATE outbox_message SET dispatched_at = now() WHERE event_type = 'ocr_requested' AND aggregate_id = $1`, [parcel.id]);

    const tracking = (who: string) => `94${who}${Date.now()}${randomBytes(3).toString('hex')}`.slice(0, 30);
    const hold = await holdRowLock('ocr_suggestion', suggestion!.id);
    let both: Promise<Res>[] = [];
    try {
      both = [
        first.post(`/parcels/${parcel.id}/ocr/confirm`, { carrier: 'USPS', trackingNumber: tracking('1') }),
        second.post(`/parcels/${parcel.id}/ocr/confirm`, { carrier: 'UPS', trackingNumber: tracking('2') }),
      ];
      await waitForLockWaiters(2);
    } finally {
      await hold.release();
    }
    const answers = await Promise.all(both);

    expect(answers.map((a) => a.status).sort()).toEqual([201, 409]);
    const loser = answers.find((a) => a.status === 409)!;
    expect(JSON.stringify(loser.body)).toContain('already been saved');
    const winner = answers.indexOf(answers.find((a) => a.status === 201)!);

    const [row] = await sql<{ consumed_by: string; carrier: string }>(
      `SELECT s.consumed_by, p.carrier FROM ocr_suggestion s JOIN parcel p ON p.id = s.subject_id WHERE s.id = $1`,
      [suggestion!.id],
    );
    const [winnerId] = await sql<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [
      winner === 0 ? SEED.operator : secondOperatorEmail,
    ]);
    expect(row!.consumed_by).toBe(winnerId!.id);
    expect(row!.carrier).toBe(winner === 0 ? 'USPS' : 'UPS');
  });
});
