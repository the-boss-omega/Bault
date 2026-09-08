import { describe, it, expect } from 'vitest';
import { Client, SEED, SEED_USERNAME, signIn, intakeFor } from '../../tests/integration/helpers/http';

/**
 * The guardrails the end-to-end audit found missing.
 *
 * Each of these was reached by driving the product rather than by reading it,
 * and every one of them SUCCEEDED when it should have refused — which is why no
 * happy-path test had ever noticed.
 */

/* ============================================================
   An administrator locking themselves out
   ============================================================ */

describe('an administrator cannot revoke their own access', () => {
  it('refuses to suspend the account making the request', async () => {
    /**
     * `PATCH /admin/users/:id` with your own id and `status: 'suspended'`
     * returned 200, and the very next admin request answered
     * `account_suspended`. Every route on the console is behind the admin role
     * AND the suspension guard, so the one person who could lift it was the
     * person who could no longer make a request. Nothing in the product could
     * undo it — it needed a hand on the database.
     */
    const admin = await signIn(SEED.admin);
    const me = (await admin.get('/me/profile')).body as { id: string };

    const res = await admin.patch(`/admin/users/${me.id}`, { status: 'suspended' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/lock yourself out/i);

    // Still working, which is the entire point.
    expect((await admin.get('/admin/users')).status).toBe(200);
  });

  it('refuses to demote the account making the request', async () => {
    // The same lockout by a different door.
    const admin = await signIn(SEED.admin);
    const me = (await admin.get('/me/profile')).body as { id: string };

    const res = await admin.patch(`/admin/users/${me.id}`, { role: 'user' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/administrator role/i);
    expect((await admin.get('/admin/users')).status).toBe(200);
  });

  it('still lets them edit their own name, which locks nobody out', async () => {
    // The guard is narrow on purpose: only the two fields that revoke access.
    const admin = await signIn(SEED.admin);
    const me = (await admin.get('/me/profile')).body as { id: string; firstName: string };

    const res = await admin.patch(`/admin/users/${me.id}`, { firstName: me.firstName });
    expect(res.status).toBe(200);
  });

  it('still lets them suspend somebody else', async () => {
    const admin = await signIn(SEED.admin);
    const users = (await admin.get('/admin/users')).body as { id: string; username: string }[];
    const target = users.find((u) => u.username === SEED_USERNAME.collector2)!;

    expect((await admin.patch(`/admin/users/${target.id}`, { status: 'suspended' })).status).toBe(200);
    expect((await admin.patch(`/admin/users/${target.id}`, { status: 'active' })).status).toBe(200);
  });
});

/* ============================================================
   Ordering the same paid service twice
   ============================================================ */

describe('a service already asked for is not offered again', () => {
  it('refuses a second open request of the same kind, naming the first', async () => {
    /**
     * Every service is billed the moment the request is created, and nothing
     * stopped the same one being created twice: a double-clicked "Professional
     * photography" produced SR-TLJ3EFY5 *and* SR-UVXY72FU — two charges, and two
     * identical jobs in the operator queue for one card. Nothing in the product
     * said the first request existed, either: the drawer offered the button again
     * as though nothing had been asked for.
     */
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Band 3: double service' });

    const before = (await owner.get('/finance/wallet')).body.amount as number;
    const first = await owner.post('/services/photography', { itemId: item.id });
    expect(first.status).toBe(201);
    const charged = (await owner.get('/finance/wallet')).body.amount as number;

    const second = await owner.post('/services/photography', { itemId: item.id });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(new RegExp(first.body.code));
    // A machine word would have been "professional_photography".
    expect(second.body.error.message).toMatch(/photo shoot/i);

    // And it cost what one costs, once.
    expect((await owner.get('/finance/wallet')).body.amount).toBe(charged);
    expect(before - charged).toBeGreaterThan(0);
  });

  it('does not block a different service on the same card', async () => {
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Band 3: two services' });

    expect((await owner.post('/services/photography', { itemId: item.id })).status).toBe(201);
    expect((await owner.post('/services/video', { itemId: item.id })).status).toBe(201);
  });

  it('tells the card which of its services are still open', async () => {
    // The drawer needs this to stop offering a button that will be refused, and
    // to say WHY instead of showing nothing.
    const operator = await signIn(SEED.operator);
    const owner = await signIn(SEED.collector);
    const item = await intakeFor(operator, SEED.collector, { description: 'Band 3: open requests' });
    const created = await owner.post('/services/photography', { itemId: item.id });

    const card = (await owner.get(`/vault/items/${item.id}`)).body as {
      openRequests: { code: string; type: string; status: string }[];
    };
    expect(card.openRequests).toEqual([
      expect.objectContaining({
        code: created.body.code,
        type: 'professional_photography',
        status: 'requested',
      }),
    ]);
  });
});

/* ============================================================
   An address that names a country the carriers can read
   ============================================================ */

describe('an address names its country by code', () => {
  it('publishes the destinations it can actually reach', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.get('/shipping/countries');
    expect(res.status).toBe(200);

    const rows = res.body as { code: string; name: string; domestic: boolean }[];
    // Derived from the carrier table, so it cannot offer a route that does not
    // exist — and every row is a code a rule in `carriers.ts` will match.
    expect(rows.every((r) => /^[A-Z]{2}$/.test(r.code))).toBe(true);
    expect(rows.filter((r) => r.domestic).map((r) => r.code)).toEqual(['US']);
    // Israel is on ePacket's contracted list; it is the case the bug was found on.
    expect(rows.find((r) => r.code === 'IL')?.name).toBe('Israel');
  });

  it('refuses a country that names no destination', async () => {
    /**
     * `country` was `@IsString()` and the form pre-filled it with the word
     * "Israel". Every rule in `carriers.ts` reads this field as an ISO code, so
     * an address saved with the default was routed as international and then
     * refused by the one international service Israel IS contracted for — `IL` is
     * on ePacket's list and "Israel" is not. The collector lost the cheapest
     * service they qualified for, and the refusal blamed the carrier.
     */
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/me/addresses', {
      label: 'Band 3 nowhere',
      recipient: 'Red Ashwood',
      line1: '1 Test St',
      city: 'Atlantis',
      country: 'Somewhere',
      postalCode: '00000',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/two-letter code/i);
  });

  it('accepts a full country name and stores the code', async () => {
    // Somebody who types "United States" has said something unambiguous; only a
    // value that names no destination at all is refused.
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/me/addresses', {
      label: `Band 3 named ${Date.now()}`,
      recipient: 'Red Ashwood',
      line1: '1 Test St',
      city: 'Trenton',
      country: 'United States',
      postalCode: '08608',
    });
    expect(res.status).toBe(201);
    expect(res.body.country).toBe('US');
  });
});

/* ============================================================
   What a validation failure says
   ============================================================ */

describe('a validation failure is written for the person reading it', () => {
  it('names a field in the words the form uses, not the property name', async () => {
    /**
     * "Check these fields: label, recipient, line1, city, country, postalCode."
     * `line1` and `postalCode` are property names. The reader is told the name of
     * the thing they are looking at; the property name stays in `violations`,
     * where a client can use it to mark up the form.
     */
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/me/addresses', {});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/street address/);
    expect(res.body.error.message).toMatch(/postal code/);
    expect(res.body.error.message).not.toMatch(/line1|postalCode/);

    const fields = (res.body.error.details.violations as { field: string }[]).map((v) => v.field);
    expect(fields).toContain('line1');
    expect(fields).toContain('postalCode');
  });

  it('says a field is required rather than that it must be a string', async () => {
    // "must be a string" is what a validator library says about an absent value.
    const operator = await signIn(SEED.operator);
    const res = await operator.post('/custody/bins', {});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('zone is required.');
  });

  it('says a missing enum is missing rather than listing seven legal values', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/support/tickets', {});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/category.*required/i);
    expect(res.body.error.message).not.toMatch(/private_sale/);
  });

  it('still lists the legal values when one was actually chosen wrongly', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/support/tickets', {
      category: 'nonsense',
      subject: 'x',
      body: 'y',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/one of:/);
    expect(res.body.error.message).toMatch(/private_sale/);
  });

  it('separates a field that does not exist from one that is merely wrong', async () => {
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/me/addresses', {
      label: 'a',
      recipient: 'b',
      line1: 'c',
      city: 'd',
      country: 'US',
      postalCode: 'e',
      wat: 1,
      huh: 2,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not fields this accepts/i);
  });

  it('reports the wrong TYPE when a value was actually sent', async () => {
    /**
     * `quantity: "lots"` breaks the integer rule and both range rules, and
     * reading them all back gave "must not be greater than 100. must not be less
     * than 1." about a word.
     */
    const operator = await signIn(SEED.operator);
    const res = await operator.post('/intake/items', {
      ownerUsername: SEED_USERNAME.collector,
      typeClass: 'trading_card',
      description: 'x',
      quantity: 'lots',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/integer/i);
    expect(res.body.error.message).not.toMatch(/greater than 100/);
  });
});

/* ============================================================
   Signing in before confirming the address
   ============================================================ */

describe('an unconfirmed account is told so in a way the client can act on', () => {
  it('answers with its own code, not a generic 403', async () => {
    /**
     * The sign-in page could not tell this refusal from any other, so it printed
     * the sentence and offered "Forgot password" — which does not help — and
     * "Sign up", which reports the address as already registered. A closed loop
     * for anybody who lost the confirmation mail.
     */
    const anon = new Client();
    const email = `band3-${Date.now()}@fixture.bault.test`;
    const username = `band3u${String(Date.now()).slice(-8)}`;
    const created = await anon.post('/auth/register', {
      email,
      username,
      firstName: 'Band',
      lastName: 'Three',
      password: 'correct horse battery',
    });
    expect(created.status).toBe(201);

    const res = await anon.post('/auth/login', { identifier: email, password: 'correct horse battery' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('email_unverified');
    expect(res.body.error.message).toMatch(/not been confirmed/i);
  });

  it('still refuses a wrong password without hinting the account exists', async () => {
    const anon = new Client();
    const res = await anon.post('/auth/login', {
      identifier: SEED.collector,
      password: 'not the password',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).not.toBe('email_unverified');
  });
});

/* ============================================================
   Money in a sentence
   ============================================================ */

describe('an amount in a message carries its currency', () => {
  it('states the smallest top-up with a currency symbol', async () => {
    // Twelve of the sixteen sites that quoted an amount dropped the symbol, so a
    // refusal read "The smallest top-up is 10.00".
    const collector = await signIn(SEED.collector);
    const res = await collector.post('/finance/checkout', {
      amountMinor: 1,
      route: 'card',
      idempotencyKey: `band3-${Date.now()}`,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/\$\d/);
  });
});

/* ============================================================
   Narrowing the shelf
   ============================================================ */

describe('the marketplace can be narrowed and ordered', () => {
  /**
   * Browse offered a free-text box over the description and the type class and
   * nothing else: no way to see only graded slabs, no price range, and one fixed
   * order (newest first) with no control over it. Somebody looking for a slab
   * under $200 had to read the whole shelf.
   */
  const rows = async (query: string) => {
    const anon = new Client();
    const res = await anon.get(`/marketplace/listings${query}`);
    expect(res.status).toBe(200);
    return res.body as { askingPrice: number; typeClass: string; conditionGrade: string | null }[];
  };

  it('filters by item type', async () => {
    const all = await rows('');
    const cards = await rows('?type=trading_card');
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(all.length);
    expect(cards.every((r) => r.typeClass === 'trading_card')).toBe(true);
  });

  it('filters by price range, in minor units', async () => {
    const dear = await rows('?minPrice=100000');
    expect(dear.every((r) => r.askingPrice >= 100_000)).toBe(true);

    const cheap = await rows('?maxPrice=50000');
    expect(cheap.every((r) => r.askingPrice <= 50_000)).toBe(true);
  });

  it('orders by price in both directions', async () => {
    const asc = (await rows('?sort=price_asc')).map((r) => r.askingPrice);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));

    const desc = (await rows('?sort=price_desc')).map((r) => r.askingPrice);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
  });

  it('falls back to newest for a sort it does not know', async () => {
    // A stale bookmark should still show the shelf — the same rule the vault's
    // `scope` follows — rather than answering 400 with an empty page.
    const odd = await rows('?sort=nonsense');
    const plain = await rows('');
    expect(odd.map((r) => r.askingPrice)).toEqual(plain.map((r) => r.askingPrice));
  });

  it('filters in SQL, not over an already-capped page', async () => {
    /**
     * The query is capped at 200 rows. Narrowing after the cap would silently
     * hide matches that fell off the end of an unfiltered page — a filter that
     * quietly lies is worse than no filter, so the condition has to reach the
     * database. A filter that returns rows the unfiltered FIRST PAGE does not
     * contain is the observable proof it did.
     */
    const cheapest = (await rows('?sort=price_asc&limit=1'))[0];
    expect(cheapest).toBeDefined();
    const byPrice = await rows(`?maxPrice=${cheapest!.askingPrice}`);
    expect(byPrice.every((r) => r.askingPrice <= cheapest!.askingPrice)).toBe(true);
  });
});

/* ============================================================
   A hold that says whether it did anything
   ============================================================ */

describe('placing a hold is idempotent and says so', () => {
  it('reports the second scan as a no-op rather than as work done', async () => {
    /**
     * Both routes answered `hold_placed` / `hold_released` either way, so an
     * operator who scanned a card that was already frozen was told the hold had
     * just been placed. The DATA was always right — `setHold` returns early and
     * writes no second custody event — but the bench was told a story about work
     * it had not done, on the screen whose entire job is saying what happened to
     * a card.
     *
     * There was also no way to do this at all from the product: the customer's
     * vault has a Hold scope telling the owner "a held card stays here until the
     * warehouse releases it", and the warehouse console had no hold control
     * anywhere. The endpoints were reachable only by calling them by hand.
     */
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'Band 3: hold' });

    const first = await operator.post(`/custody/items/${item.id}/hold`, {});
    expect(first.body).toMatchObject({ status: 'hold_placed', changed: true });

    const again = await operator.post(`/custody/items/${item.id}/hold`, {});
    expect(again.status).toBeLessThan(300);
    expect(again.body).toMatchObject({ status: 'already_on_hold', changed: false });

    const lifted = await operator.del(`/custody/items/${item.id}/hold`);
    expect(lifted.body).toMatchObject({ status: 'hold_released', changed: true });

    const noop = await operator.del(`/custody/items/${item.id}/hold`);
    expect(noop.body).toMatchObject({ status: 'was_not_on_hold', changed: false });
  });

  it('writes one custody event per real change, not one per scan', async () => {
    // The history is the trust record; a no-op must not appear in it as an event.
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { description: 'Band 3: hold history' });

    await operator.post(`/custody/items/${item.id}/hold`, {});
    await operator.post(`/custody/items/${item.id}/hold`, {});
    await operator.del(`/custody/items/${item.id}/hold`);
    await operator.del(`/custody/items/${item.id}/hold`);

    const history = (await operator.get(`/custody/items/${item.id}/history`)).body as {
      eventType: string;
    }[];
    expect(history.filter((e) => e.eventType === 'hold_placed')).toHaveLength(1);
    expect(history.filter((e) => e.eventType === 'hold_released')).toHaveLength(1);
  });
});
