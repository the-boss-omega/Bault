import { describe, it, expect } from 'vitest';
import { SEED, SEED_USERNAME, signIn } from '../../tests/integration/helpers/http';

/**
 * The receiving bench: one workflow, a stack of boxes at a time, with photographs.
 *
 * Three things were wrong with the inbound half of the warehouse, and they were
 * the same thing three times over — the product described the work rather than
 * fitting it.
 *
 *   1. PARCELS AND INTAKE WERE TWO TABS. Every intake begins with a parcel: a box
 *      is received, opened, and its contents booked in. "Book contents" switched
 *      tabs to a form on another screen and the box was closed out over there, so
 *      an operator moved back and forth between two places to work through one
 *      box.
 *   2. ARRIVALS WERE BOOKED IN ONE AT A TIME. A courier drops a dozen; the form
 *      took one and cleared itself, so the facility and the carrier were
 *      re-entered for every box in the run.
 *   3. NOTHING COULD BE PHOTOGRAPHED. `StorageAdapter.putObject` has existed
 *      since T020 and `item_image` since custody was built, and no route in the
 *      API ever accepted image bytes — the photography service records a key for
 *      a shoot it never receives. A box that arrived crushed was a sentence with
 *      nothing attached, and a booked-in card wore a generated placeholder until
 *      somebody paid for a professional shoot.
 */

/** A 1×1 PNG — the smallest thing that is genuinely an image. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type Client = Awaited<ReturnType<typeof signIn>>;

async function upload(client: Client, purpose: 'parcel' | 'item_intake'): Promise<string> {
  const res = await client.post('/media/uploads', {
    contentType: 'image/png',
    dataBase64: PNG,
    purpose,
  });
  expect(res.status).toBe(201);
  return res.body.objectKey as string;
}

const facilityCode = async (client: Client) =>
  ((await client.get('/me/inbound-addresses')).body as { code: string }[])[0]!.code;

describe('uploading an image', () => {
  it('stores it and hands back a key, never the bytes again', async () => {
    const operator = await signIn(SEED.operator);
    const res = await operator.post('/media/uploads', {
      contentType: 'image/png',
      dataBase64: PNG,
      purpose: 'parcel',
    });
    expect(res.status).toBe(201);
    expect(res.body.objectKey).toMatch(/^parcels\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(res.body.bytes).toBeGreaterThan(0);
  });

  it('accepts a data URL, which is what a file picker produces', async () => {
    const operator = await signIn(SEED.operator);
    const res = await operator.post('/media/uploads', {
      contentType: 'image/png',
      dataBase64: `data:image/png;base64,${PNG}`,
      purpose: 'item_intake',
    });
    expect(res.status).toBe(201);
    expect(res.body.objectKey).toMatch(/^intake\//);
  });

  it('refuses something that is not an image, and says what it got', async () => {
    const operator = await signIn(SEED.operator);
    const res = await operator.post('/media/uploads', {
      contentType: 'application/pdf',
      dataBase64: PNG,
      purpose: 'parcel',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/JPEG, PNG, WebP or HEIC/);
    expect(res.body.error.message).toMatch(/application\/pdf/);
  });

  it('keys each upload separately, so two photos never collide', async () => {
    const operator = await signIn(SEED.operator);
    const [a, b] = await Promise.all([upload(operator, 'parcel'), upload(operator, 'parcel')]);
    expect(a).not.toBe(b);
  });
});

describe('booking in a stack of arrivals', () => {
  it('receives several in one call', async () => {
    const operator = await signIn(SEED.operator);
    const code = await facilityCode(operator);
    const stamp = Date.now();

    const res = await operator.post('/parcels/receive/batch', {
      parcels: [
        { facilityCode: code, addressedTo: SEED_USERNAME.collector, trackingNumber: `RUN-A-${stamp}` },
        { facilityCode: code, addressedTo: SEED_USERNAME.collector2, trackingNumber: `RUN-B-${stamp}` },
        { facilityCode: code, addressedTo: SEED_USERNAME.collector, trackingNumber: `RUN-C-${stamp}` },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(3);
    // Each is a real parcel with its own code, not three references to one.
    const codes = (res.body as { code: string }[]).map((p) => p.code);
    expect(new Set(codes).size).toBe(3);
  });

  it('refuses the whole run when one row is bad, and names the row', async () => {
    /**
     * All or nothing on purpose. A partial success would leave the operator
     * reading a list of results to work out which four of seven boxes are now on
     * the system, which is worse than fixing one row and pressing the button
     * again.
     */
    const operator = await signIn(SEED.operator);
    const code = await facilityCode(operator);
    const before = ((await operator.get('/parcels')).body as unknown[]).length;

    const res = await operator.post('/parcels/receive/batch', {
      parcels: [
        { facilityCode: code, addressedTo: SEED_USERNAME.collector },
        { facilityCode: 'NOT-A-FACILITY', addressedTo: SEED_USERNAME.collector },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Parcel 2 of 2/);

    const after = ((await operator.get('/parcels')).body as unknown[]).length;
    expect(after).toBe(before);
  });

  it('will not receive an empty run', async () => {
    const operator = await signIn(SEED.operator);
    const res = await operator.post('/parcels/receive/batch', { parcels: [] });
    expect(res.status).toBe(400);
  });

  it('is staff-only, like every other bench route', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/parcels/receive/batch', { parcels: [] });
    expect(res.status).toBe(403);
  });
});

describe('photographs on a parcel', () => {
  it('records how the box turned up and what the check found, separately', async () => {
    const operator = await signIn(SEED.operator);
    const code = await facilityCode(operator);

    const received = await operator.post('/parcels/receive/batch', {
      parcels: [
        {
          facilityCode: code,
          addressedTo: SEED_USERNAME.collector,
          trackingNumber: `PHOTO-${Date.now()}`,
          photoKeys: [await upload(operator, 'parcel')],
        },
      ],
    });
    const parcel = (received.body as { id: string }[])[0]!;

    const arrival = (await operator.get(`/parcels/${parcel.id}/photos`)).body as { kind: string }[];
    expect(arrival).toHaveLength(1);
    expect(arrival[0]!.kind).toBe('arrival');

    await operator.post(`/parcels/${parcel.id}/open`, {
      condition: 'packaging_damaged',
      conditionNotes: 'Corner crushed in transit',
      photoKeys: [await upload(operator, 'parcel')],
    });

    const both = (await operator.get(`/parcels/${parcel.id}/photos`)).body as {
      kind: string;
      url: string;
    }[];
    expect(both).toHaveLength(2);
    // "This is how it turned up" and "this is what the check found" answer
    // different questions, so the kind is recorded rather than inferred from
    // when the photo was taken.
    expect(new Set(both.map((p) => p.kind))).toEqual(new Set(['arrival', 'condition']));
    // Every row comes back readable — a stored key is no use to a browser.
    expect(both.every((p) => p.url.length > 0)).toBe(true);
  });

  it('shows them to the parcel’s owner and to nobody else', async () => {
    // The point of photographing a damaged box is that the person whose property
    // it is can see it.
    const operator = await signIn(SEED.operator);
    const code = await facilityCode(operator);
    const received = await operator.post('/parcels/receive/batch', {
      parcels: [
        {
          facilityCode: code,
          addressedTo: SEED_USERNAME.collector,
          trackingNumber: `OWNER-${Date.now()}`,
          photoKeys: [await upload(operator, 'parcel')],
        },
      ],
    });
    const parcel = (received.body as { id: string }[])[0]!;

    const owner = await signIn(SEED.collector);
    expect((await owner.get(`/parcels/${parcel.id}/photos`)).status).toBe(200);

    const stranger = await signIn(SEED.collector2);
    const refused = await stranger.get(`/parcels/${parcel.id}/photos`);
    // `notFound`, not `forbidden`: telling a stranger that somebody else's
    // parcel id exists is itself a leak.
    expect(refused.status).toBe(404);
  });
});

describe('photographs on an item', () => {
  it('puts the bench’s picture in the owner’s vault immediately', async () => {
    /**
     * `item_image` has existed since custody was built and nothing outside the
     * seed ever wrote a row into it, so a collector's card wore a generated
     * placeholder until somebody paid for a professional shoot. These are type
     * `intake`, which is exactly the pipeline the vault drawer already reads.
     */
    const operator = await signIn(SEED.operator);
    const key = await upload(operator, 'item_intake');

    const created = await operator.post('/intake/items', {
      ownerUsername: SEED_USERNAME.collector,
      typeClass: 'trading_card',
      description: 'Photographed at the bench',
      autoStow: true,
      photoKeys: [key],
    });
    expect(created.status).toBe(201);

    const owner = await signIn(SEED.collector);
    const card = (await owner.get(`/vault/items/${created.body.id}`)).body as {
      images: { type: string; url: string; objectKey: string }[];
    };
    expect(card.images).toHaveLength(1);
    expect(card.images[0]!.type).toBe('intake');
    expect(card.images[0]!.objectKey).toBe(key);
    expect(card.images[0]!.url).toContain(key);
  });

  it('gives every copy of a bulk intake the same photographs', async () => {
    // One shot of a run of twelve identical commons describes all twelve.
    const operator = await signIn(SEED.operator);
    const key = await upload(operator, 'item_intake');

    const created = await operator.post('/intake/items', {
      ownerUsername: SEED_USERNAME.collector,
      typeClass: 'trading_card',
      description: 'Commons run',
      autoStow: true,
      quantity: 3,
      photoKeys: [key],
    });
    expect(created.status).toBe(201);
    expect(created.body).toHaveLength(3);

    const owner = await signIn(SEED.collector);
    for (const made of created.body as { id: string }[]) {
      const card = (await owner.get(`/vault/items/${made.id}`)).body as { images: unknown[] };
      expect(card.images).toHaveLength(1);
    }
  });

  it('books a card in without photographs, which is still the common case', async () => {
    const operator = await signIn(SEED.operator);
    const created = await operator.post('/intake/items', {
      ownerUsername: SEED_USERNAME.collector,
      typeClass: 'trading_card',
      description: 'No camera today',
      autoStow: true,
    });
    expect(created.status).toBe(201);
  });
});

describe('one box, worked start to finish in one place', () => {
  it('receives, opens, books contents and closes out without a detour', async () => {
    /**
     * The sequence the merged bench performs top to bottom. It used to cross a
     * tab boundary twice: once to book the contents, and once more because the
     * close-out lived on the far side with the count of what had come out.
     */
    const operator = await signIn(SEED.operator);
    const code = await facilityCode(operator);

    const received = await operator.post('/parcels/receive/batch', {
      parcels: [
        {
          facilityCode: code,
          addressedTo: SEED_USERNAME.collector,
          trackingNumber: `FLOW-${Date.now()}`,
          photoKeys: [await upload(operator, 'parcel')],
        },
      ],
    });
    const parcel = (received.body as { id: string; code: string }[])[0]!;

    expect((await operator.post(`/parcels/${parcel.id}/open`, {
      condition: 'sound',
      conditionNotes: 'Sealed, no damage',
    })).status).toBe(201);

    await operator.post('/intake/items', {
      ownerUsername: SEED_USERNAME.collector,
      typeClass: 'trading_card',
      description: 'Out of the box',
      autoStow: true,
      parcelId: parcel.id,
      quantity: 2,
      photoKeys: [await upload(operator, 'item_intake')],
    });

    // The count the operator sees before closing the box — the reconciliation
    // that made the close-out safe to move next to the work.
    const queued = ((await operator.get('/parcels')).body as { id: string; itemCount: number }[]).find(
      (p) => p.id === parcel.id,
    );
    expect(queued?.itemCount).toBe(2);

    const closed = await operator.post(`/parcels/${parcel.id}/process`, {});
    expect(closed.status).toBe(201);
    expect(closed.body.itemCount).toBe(2);
  });
});

/* ============================================================
   A box of different units, in one submission
   ============================================================ */

describe('booking a box of different units in at once', () => {
  /**
   * `quantity` books N copies of ONE description — right for a run of identical
   * commons, wrong for the ordinary case, which is a Rayquaza ex, a sealed pack
   * and a graded Gold Star in the same carton. The multi-row form moved off the parcel
   * bench (where receiving a box is one scan) and onto the intake bench, where
   * each unit genuinely needs its own class, condition, serial and photographs.
   */
  it('gives every unit its own class, description, serial and photographs', async () => {
    const operator = await signIn(SEED.operator);
    const key = await upload(operator, 'item_intake');
    const shared = { ownerUsername: SEED_USERNAME.collector, autoStow: true };

    const res = await operator.post('/intake/items/batch', {
      units: [
        { ...shared, typeClass: 'trading_card', description: '2003 EX Dragon Rayquaza ex #97/97', conditionGrade: 'NM', photoKeys: [key] },
        { ...shared, typeClass: 'sealed_pack', description: '2021 Evolving Skies sealed pack — the Rayquaza V/VMAX set' },
        { ...shared, typeClass: 'graded_slab', description: '2005 EX Deoxys Rayquaza Gold Star #107/107', conditionGrade: 'PSA 8' },
      ],
    });
    expect(res.status).toBe(201);

    const made = res.body as { id: string; typeClass: string; description: string; serialNumber: string }[];
    expect(made).toHaveLength(3);
    expect(made.map((u) => u.typeClass)).toEqual(['trading_card', 'sealed_pack', 'graded_slab']);
    expect(new Set(made.map((u) => u.serialNumber)).size).toBe(3);

    // The photograph is on the unit it was taken of, and on no other.
    const owner = await signIn(SEED.collector);
    const first = (await owner.get(`/vault/items/${made[0]!.id}`)).body as { images: unknown[] };
    const second = (await owner.get(`/vault/items/${made[1]!.id}`)).body as { images: unknown[] };
    expect(first.images).toHaveLength(1);
    expect(second.images).toHaveLength(0);
  });

  it('books nothing at all when one unit is bad, and names the unit', async () => {
    /**
     * This was broken when it was first written, in exactly the way the parcel
     * batch had been: a loop over `intakeItem`, which opens its own transaction
     * per unit, so a bad row nine deep left the first eight on the shelves — and
     * the refusal invited the operator to fix row nine and press again, which
     * would have booked those eight in twice.
     *
     * `intakeItem` cannot be wrapped in one transaction from outside (it resolves
     * a shelf, bills through the billing port and writes custody events, each
     * owning its own boundary), so the guarantee is bought by rejecting
     * everything rejectable BEFORE anything is written.
     */
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const before = ((await owner.get('/vault/items')).body as unknown[]).length;

    const res = await operator.post('/intake/items/batch', {
      units: [
        { ownerUsername: SEED_USERNAME.collector, autoStow: true, typeClass: 'trading_card', description: 'Good' },
        { ownerUsername: SEED_USERNAME.collector, autoStow: true, typeClass: 'moon_rock', description: 'Bad' },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Unit 2 of 2/);
    expect(res.body.error.message).toMatch(/moon_rock/);

    const after = ((await owner.get('/vault/items')).body as unknown[]).length;
    expect(after).toBe(before);
  });

  it('catches an unknown owner before writing any unit', async () => {
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const before = ((await owner.get('/vault/items')).body as unknown[]).length;

    const res = await operator.post('/intake/items/batch', {
      units: [
        { ownerUsername: SEED_USERNAME.collector, autoStow: true, typeClass: 'trading_card', description: 'Good' },
        { ownerUsername: 'nobody-at-all', autoStow: true, typeClass: 'trading_card', description: 'Orphan' },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Unit 2 of 2/);
    expect(((await owner.get('/vault/items')).body as unknown[]).length).toBe(before);
  });

  it('refuses an empty run', async () => {
    const operator = await signIn(SEED.operator);
    expect((await operator.post('/intake/items/batch', { units: [] })).status).toBe(400);
  });

  it('is staff-only', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/intake/items/batch', {
      units: [{ ownerUsername: SEED_USERNAME.collector, autoStow: true, typeClass: 'trading_card' }],
    });
    expect(res.status).toBe(403);
  });

  it('still books units out of the parcel they came from', async () => {
    const operator = await signIn(SEED.operator);
    const code = await facilityCode(operator);
    const received = await operator.post('/parcels/receive/batch', {
      parcels: [{ facilityCode: code, addressedTo: SEED_USERNAME.collector, trackingNumber: `UNITS-${Date.now()}` }],
    });
    const parcel = (received.body as { id: string }[])[0]!;
    await operator.post(`/parcels/${parcel.id}/open`, { condition: 'sound', conditionNotes: 'Sealed' });

    const res = await operator.post('/intake/items/batch', {
      units: [
        { ownerUsername: SEED_USERNAME.collector, autoStow: true, typeClass: 'trading_card', description: 'One', parcelId: parcel.id },
        { ownerUsername: SEED_USERNAME.collector, autoStow: true, typeClass: 'sealed_pack', description: 'Two', parcelId: parcel.id },
      ],
    });
    expect(res.status).toBe(201);

    const queued = ((await operator.get('/parcels')).body as { id: string; itemCount: number }[]).find(
      (p) => p.id === parcel.id,
    );
    expect(queued?.itemCount).toBe(2);
  });
});
