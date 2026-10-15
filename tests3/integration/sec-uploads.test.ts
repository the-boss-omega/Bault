import { afterAll, describe, expect, it } from 'vitest';
import { SEED, SEED_USERNAME, fundWallet, signIn } from '../../tests/integration/helpers/http';
import { closeDb, sql } from '../../tests/integration/helpers/db';

/**
 * Uploads, from the wrong side (E9, E10, F428, N17, F453).
 *
 * `POST /media/uploads` let ANY signed-in account put up to ten megabytes of
 * anything in the private bucket: the only check on the content was the
 * `contentType` string the client chose to send. A failure in the store came
 * back as the same opaque 500 as a bug. The routes that attach a key stored
 * whatever string they were handed — a key minted for some other purpose,
 * somebody else's key, or one with a `..` segment that the storage adapter's
 * URL parser resolved into another bucket before signing a link to it.
 */

type Client = Awaited<ReturnType<typeof signIn>>;

afterAll(closeDb);

const b64 = (bytes: Buffer) => bytes.toString('base64');

/** A 1×1 PNG — the smallest thing that is genuinely an image. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** The first bytes of a JFIF file; a signature is all the check reads. */
const JPEG = b64(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]));
const WEBP = b64(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]));
/** An ISO-BMFF `ftyp` box whose major brand is `heic`, as an iPhone writes it. */
const HEIC = b64(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic')]));
/** The same box shape with an AVIF brand: an image, but not one of the four. */
const AVIF = b64(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypavif'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1miaf')]));
const TEXT = b64(Buffer.from('This is a shopping list, not a photograph of a card.'));

async function upload(client: Client, purpose: 'parcel' | 'item_intake', dataBase64 = PNG, contentType = 'image/png') {
  return client.post('/media/uploads', { contentType, dataBase64, purpose });
}

async function uploadedKey(client: Client, purpose: 'parcel' | 'item_intake'): Promise<string> {
  const res = await upload(client, purpose);
  expect(res.status).toBe(201);
  return res.body.objectKey as string;
}

/** Move an upload's timestamp back, which is the only way to make one old. */
async function age(objectKey: string, minutes: number): Promise<void> {
  await sql(`UPDATE media_upload SET created_at = now() - make_interval(mins => $2) WHERE object_key = $1`, [
    objectKey,
    minutes,
  ]);
}

const intakeWith = (operator: Client, photoKeys: string[]) =>
  operator.post('/intake/items', {
    ownerUsername: SEED_USERNAME.collector,
    typeClass: 'trading_card',
    description: 'Provenance check',
    autoStow: true,
    photoKeys,
  });

const facilityCode = async (client: Client) =>
  ((await client.get('/me/inbound-addresses')).body as { code: string }[])[0]!.code;

/* ============================================================
   E9 — who may upload
   ============================================================ */

describe('who may put bytes in the bucket', () => {
  it('refuses a customer: no screen a customer sees uploads anything', async () => {
    const collector = await signIn(SEED.collector);
    const res = await upload(collector, 'item_intake');
    expect(res.status).toBe(403);
  });

  it('still lets both staff roles upload, which is what the benches need', async () => {
    for (const who of [SEED.operator, SEED.admin]) {
      const staff = await signIn(who);
      expect((await upload(staff, 'parcel')).status).toBe(201);
    }
  });
});

/* ============================================================
   E9 — what counts as an image
   ============================================================ */

describe('an upload is judged by its bytes, not by its label', () => {
  it('refuses text that calls itself a PNG', async () => {
    const operator = await signIn(SEED.operator);
    const res = await upload(operator, 'parcel', TEXT, 'image/png');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.message).toMatch(/JPEG, PNG, WebP or HEIC/);
  });

  it('refuses an image format outside the four', async () => {
    const operator = await signIn(SEED.operator);
    const res = await upload(operator, 'parcel', AVIF, 'image/heic');
    expect(res.status).toBe(400);
  });

  it('stores the type the bytes are, whatever the label said', async () => {
    // A `.png` that is really a JPEG is common — a browser names the type from
    // the extension. The stored type is the one an image viewer will need.
    const operator = await signIn(SEED.operator);
    const res = await upload(operator, 'item_intake', JPEG, 'image/png');
    expect(res.status).toBe(201);
    expect(res.body.contentType).toBe('image/jpeg');
    expect(res.body.objectKey).toMatch(/\.jpg$/);
  });

  it('recognises WebP and HEIC by their signatures', async () => {
    const operator = await signIn(SEED.operator);
    const webp = await upload(operator, 'parcel', WEBP, 'image/webp');
    expect(webp.status).toBe(201);
    expect(webp.body.contentType).toBe('image/webp');

    const heic = await upload(operator, 'parcel', HEIC, 'image/heic');
    expect(heic.status).toBe(201);
    expect(heic.body.contentType).toBe('image/heic');
  });
});

/* ============================================================
   N17 — the size limit, in words a person reads
   ============================================================ */

describe('an oversized photograph', () => {
  it('is refused with the limit in megabytes, not a count of characters', async () => {
    // 11 MB of bytes is ~14.7 million base64 characters: under the 16 MB body
    // cap, so the refusal has to come from the media rules rather than Express.
    const operator = await signIn(SEED.operator);
    const big = Buffer.alloc(11 * 1024 * 1024, 0);
    big.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const res = await upload(operator, 'parcel', big.toString('base64'));

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/10 MB/);
    expect(res.body.error.message).not.toMatch(/characters/);
  });
});

/* ============================================================
   E10 — a store that is down says so
   ============================================================ */

describe('when the store cannot be reached', () => {
  it('answers with storage_unavailable, never a bare 500', async () => {
    // Against the sandbox store this stores and answers 201. Against an S3
    // endpoint nobody is listening on — the way `receiving-bench.test.ts` fails
    // with no bucket — it has to be a 503 that names the cause, because a 500
    // tells the operator "bug" and tells them nothing about trying again.
    const operator = await signIn(SEED.operator);
    const res = await upload(operator, 'parcel');
    expect([201, 503]).toContain(res.status);
    if (res.status === 503) expect(res.body.error.code).toBe('storage_unavailable');
  });
});

/* ============================================================
   F428 — a key is a name, never a path
   ============================================================ */

describe('a key with a dot segment', () => {
  const TRAVERSAL = ['intake/../other-bucket/secret.png', './intake/x.png', 'intake/2026/../../x.png', '..'];

  it('is refused on the intake bench', async () => {
    const operator = await signIn(SEED.operator);
    for (const key of TRAVERSAL) {
      const res = await intakeWith(operator, [key]);
      expect(res.status, key).toBe(400);
      expect(res.body.error.message, key).toMatch(/segment/);
    }
  });

  it('is refused on the parcel bench', async () => {
    const operator = await signIn(SEED.operator);
    const res = await operator.post('/parcels/receive/batch', {
      parcels: [
        {
          facilityCode: await facilityCode(operator),
          addressedTo: SEED_USERNAME.collector,
          trackingNumber: `DOT-${Date.now()}`,
          photoKeys: ['parcels/../intake/x.png'],
        },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/segment/);
  });

  it('is refused as a supporting document on a wallet request', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 1_000,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `dot-${Date.now()}`,
      documentKey: 'receipts/../../labels/somebody-else.pdf',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/segment/);
  });

  it('still accepts an ordinary file name with dots in it', async () => {
    // Only a WHOLE segment of `.` or `..` moves a path. `receipt.v2.pdf` is a name.
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/finance/wallet-requests', {
      type: 'cash_in',
      amountMinor: 1_000,
      currency: 'USD',
      fundingSource: 'bank_transfer',
      reference: `dots-${Date.now()}`,
      documentKey: 'receipts/2026/receipt.v2.pdf',
    });
    expect(res.status).toBe(201);
  });
});

/* ============================================================
   F453 — an attached key has to be one this API minted, for this
   ============================================================ */

describe('attaching a photograph', () => {
  it('refuses a key this API never minted', async () => {
    const operator = await signIn(SEED.operator);
    const res = await intakeWith(operator, ['intake/2026/01/00000000-0000-4000-8000-000000000000.png']);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not uploaded|was not uploaded/i);
  });

  it('refuses a parcel photograph on an item', async () => {
    const operator = await signIn(SEED.operator);
    const key = await uploadedKey(operator, 'parcel');
    const res = await intakeWith(operator, [key]);
    expect(res.status).toBe(400);
  });

  it('refuses an unminted key on the parcel bench, and books nothing', async () => {
    const operator = await signIn(SEED.operator);
    const tracking = `FAKE-KEY-${Date.now()}`;
    const res = await operator.post('/parcels/receive/batch', {
      parcels: [
        {
          facilityCode: await facilityCode(operator),
          addressedTo: SEED_USERNAME.collector,
          trackingNumber: tracking,
          photoKeys: ['parcels/2026/01/00000000-0000-4000-8000-000000000000.png'],
        },
      ],
    });
    expect(res.status).toBe(400);
    const parcels = (await operator.get('/parcels')).body as { trackingNumber: string | null }[];
    expect(parcels.some((p) => p.trackingNumber === tracking)).toBe(false);
  });

  it('accepts a colleague’s photograph taken moments ago', async () => {
    // Two people at one bench: one photographs, the other books the card in.
    const admin = await signIn(SEED.admin);
    const operator = await signIn(SEED.operator);
    const key = await uploadedKey(admin, 'item_intake');
    expect((await intakeWith(operator, [key])).status).toBe(201);
  });

  it('refuses somebody else’s photograph from hours ago', async () => {
    // The key of a card photographed this morning, lifted from a vault response
    // or a log, and attached to a different card this afternoon.
    const admin = await signIn(SEED.admin);
    const operator = await signIn(SEED.operator);
    const key = await uploadedKey(admin, 'item_intake');
    await age(key, 120);
    const res = await intakeWith(operator, [key]);
    expect(res.status).toBe(403);
  });

  it('accepts the operator’s own photograph however long the form sat open', async () => {
    const operator = await signIn(SEED.operator);
    const key = await uploadedKey(operator, 'item_intake');
    await age(key, 120);
    expect((await intakeWith(operator, [key])).status).toBe(201);
  });

  it('refuses an unminted key when a store order is shelved', async () => {
    const admin = await signIn(SEED.admin);
    const listing = await admin.post('/marketplace/house/listings', {
      typeClass: 'trading_card',
      description: 'Provenance check copy',
      conditionGrade: 'Raw',
      photoRef: 'SN-CL10-0005',
      askingPrice: 1_000,
      stock: 1,
    });
    expect(listing.status).toBe(201);
    await fundWallet(SEED.collector2, 2_000);
    const buyer = await signIn(SEED.collector2);
    const bought = await buyer.post(`/marketplace/house/listings/${listing.body.id}/purchase`);
    expect(bought.status).toBe(201);

    const operator = await signIn(SEED.operator);
    const queue = (await operator.get('/marketplace/house/orders/queue')).body as { id: string; itemId: string }[];
    const order = queue.find((o) => o.itemId === bought.body.itemId)!;

    const refused = await operator.post(`/marketplace/house/orders/${order.id}/stow`, {
      autoStow: true,
      photoKeys: ['intake/2026/01/00000000-0000-4000-8000-000000000000.png'],
    });
    expect(refused.status).toBe(400);

    // Still waiting for a shelf, and shelving it properly still works.
    const ok = await operator.post(`/marketplace/house/orders/${order.id}/stow`, {
      autoStow: true,
      photoKeys: [await uploadedKey(operator, 'item_intake')],
    });
    expect(ok.status).toBe(201);
  });
});
