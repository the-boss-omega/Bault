import { afterAll, describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';
import { activeAccount } from './helpers/mfa';
import { closeDb, sql } from './helpers/db';

afterAll(async () => {
  await closeDb();
});

const marker = async (id: string) =>
  (
    await sql<{ status: string; auto: boolean }>(
      `SELECT status, auto_suspended_at IS NOT NULL AS auto FROM user_account WHERE id = $1`,
      [id],
    )
  )[0]!;

describe('saving a user the debt sweep suspended', () => {
  async function autoSuspended(label: string) {
    const account = await activeAccount(label);
    await sql(`UPDATE user_account SET status = 'suspended', auto_suspended_at = now() WHERE id = $1`, [account.id]);
    expect(await marker(account.id)).toEqual({ status: 'suspended', auto: true });
    return account;
  }

  it('keeps the sweep\'s marker on a save that sends no status', async () => {
    const admin = await signIn(SEED.admin);
    const account = await autoSuspended('autosus');

    const res = await admin.patch(`/admin/users/${account.id}`, { firstName: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ firstName: 'Renamed', status: 'suspended', autoSuspended: true });
    expect(await marker(account.id)).toEqual({ status: 'suspended', auto: true });
  });

  it("makes it an administrator's suspension when the status is sent, even unchanged", async () => {
    const admin = await signIn(SEED.admin);
    const account = await autoSuspended('autosu3');

    const res = await admin.patch(`/admin/users/${account.id}`, { status: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'suspended', autoSuspended: false });
    expect(await marker(account.id)).toEqual({ status: 'suspended', auto: false });
  });

  it('clears the marker when an administrator actually changes the status', async () => {
    const admin = await signIn(SEED.admin);
    const account = await autoSuspended('autosu2');

    expect((await admin.patch(`/admin/users/${account.id}`, { status: 'active' })).status).toBe(200);
    expect(await marker(account.id)).toEqual({ status: 'active', auto: false });
  });

  it("says in the users list which suspensions are the sweep's", async () => {
    const admin = await signIn(SEED.admin);
    const [before] = await sql<{ id: string; status: string; auto_suspended_at: Date | null }>(
      `SELECT id, status, auto_suspended_at FROM user_account WHERE email = $1`,
      [SEED.collector2],
    );
    try {
      await sql(`UPDATE user_account SET status = 'suspended', auto_suspended_at = now() WHERE id = $1`, [before!.id]);
      const users = (await admin.get('/admin/users')).body as { id: string; status: string; autoSuspended: boolean }[];
      expect(users.find((u) => u.id === before!.id)).toMatchObject({ status: 'suspended', autoSuspended: true });
      for (const u of users.filter((x) => x.id !== before!.id)) expect(typeof u.autoSuspended, u.id).toBe('boolean');
    } finally {
      await sql(`UPDATE user_account SET status = $2, auto_suspended_at = $3 WHERE id = $1`, [
        before!.id,
        before!.status,
        before!.auto_suspended_at,
      ]);
    }
  });
});

describe('an administrator editing their own account', () => {
  it('refuses to suspend, close or demote them however the id is written', async () => {
    const admin = await signIn(SEED.admin);
    const [me] = await sql<{ id: string; role: string; status: string }>(
      `SELECT id, role, status FROM user_account WHERE email = $1`,
      [SEED.admin],
    );
    try {
      for (const id of [me!.id, me!.id.toUpperCase()]) {
        for (const body of [{ status: 'suspended' }, { status: 'closed' }, { role: 'user' }]) {
          const res = await admin.patch(`/admin/users/${id}`, body);
          expect(res.status, `${id} ${JSON.stringify(body)} ${JSON.stringify(res.body)}`).toBe(400);
        }
      }
      expect((await admin.patch('/admin/users/not-a-uuid', { firstName: 'Nobody' })).status).toBe(400);
    } finally {
      await sql(`UPDATE user_account SET role = $2, status = $3 WHERE id = $1`, [me!.id, me!.role, me!.status]);
    }
    const [after] = await sql<{ role: string; status: string }>(`SELECT role, status FROM user_account WHERE id = $1`, [me!.id]);
    expect(after).toEqual({ role: me!.role, status: me!.status });
  });
});

describe("changing the owner of a listed card", () => {
  async function listedCard() {
    const operator = await signIn(SEED.operator);
    const item = await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' });
    const seller = await signIn(SEED.collector);
    const listing = await seller.post('/marketplace/listings', { itemId: item.id, askingPrice: 12_000 });
    expect(listing.status, JSON.stringify(listing.body)).toBe(201);
    const [row] = await sql<{ lifecycle_state: string }>(`SELECT lifecycle_state FROM item WHERE id = $1`, [item.id]);
    expect(row!.lifecycle_state).toBe('listed');
    return { itemId: item.id as string, listingId: listing.body.id as string };
  }

  const ownerAndState = async (itemId: string) =>
    (await sql<{ owner_id: string; lifecycle_state: string }>(`SELECT owner_id, lifecycle_state FROM item WHERE id = $1`, [itemId]))[0]!;
  const listingStatus = async (listingId: string) =>
    (await sql<{ status: string }>(`SELECT status FROM listing WHERE id = $1`, [listingId]))[0]!.status;

  async function newOwnerId() {
    const admin = await signIn(SEED.admin);
    const users = (await admin.get('/admin/users')).body as { id: string; email: string }[];
    return users.find((u) => u.email === SEED.collector2)!.id;
  }

  it("puts it back on the shelf even when the request repeats the state it had ('listed')", async () => {
    const admin = await signIn(SEED.admin);
    const { itemId, listingId } = await listedCard();
    const to = await newOwnerId();

    const res = await admin.patch(`/admin/items/${itemId}`, { ownerId: to, lifecycleState: 'listed' });
    expect(res.status).toBe(200);
    expect(await listingStatus(listingId)).toBe('removed');
    expect(await ownerAndState(itemId)).toEqual({ owner_id: to, lifecycle_state: 'stored' });
  });

  it('puts it back on the shelf when no state is sent', async () => {
    const admin = await signIn(SEED.admin);
    const { itemId } = await listedCard();
    const to = await newOwnerId();

    expect((await admin.patch(`/admin/items/${itemId}`, { ownerId: to })).status).toBe(200);
    expect(await ownerAndState(itemId)).toEqual({ owner_id: to, lifecycle_state: 'stored' });
  });

  it('honours another state the same edit asks for', async () => {
    const admin = await signIn(SEED.admin);
    const { itemId } = await listedCard();
    const to = await newOwnerId();

    expect((await admin.patch(`/admin/items/${itemId}`, { ownerId: to, lifecycleState: 'on-hold' })).status).toBe(200);
    expect(await ownerAndState(itemId)).toEqual({ owner_id: to, lifecycle_state: 'on-hold' });
  });
});

describe('moving a card to another owner from the console', () => {
  async function storedCard() {
    const operator = await signIn(SEED.operator);
    return (await intakeFor(operator, SEED.collector, { typeClass: 'trading_card' })).id as string;
  }
  const ownerOf = async (itemId: string) =>
    (await sql<{ owner_id: string }>(`SELECT owner_id FROM item WHERE id = $1`, [itemId]))[0]!.owner_id;

  it('refuses an owner id that names no account, with a plain 400', async () => {
    const admin = await signIn(SEED.admin);
    const itemId = await storedCard();
    const before = await ownerOf(itemId);

    const res = await admin.patch(`/admin/items/${itemId}`, { ownerId: '00000000-0000-0000-0000-000000000001' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.message).toBe('No account has that id.');
    expect((await admin.patch(`/admin/items/${itemId}`, { ownerId: 'nobody' })).status).toBe(400);
    expect(await ownerOf(itemId)).toBe(before);
  });

  it('refuses a closed or pending account as the new owner, and takes an active or suspended one', async () => {
    const admin = await signIn(SEED.admin);
    const itemId = await storedCard();
    const before = await ownerOf(itemId);
    const target = await activeAccount('newowner');

    for (const status of ['closed', 'pending'] as const) {
      await sql(`UPDATE user_account SET status = $2 WHERE id = $1`, [target.id, status]);
      const res = await admin.patch(`/admin/items/${itemId}`, { ownerId: target.id });
      expect(res.status, status).toBe(400);
      expect(res.body.error.message).toBe('The new owner has to be an active or suspended account.');
      expect(await ownerOf(itemId)).toBe(before);
    }
    await sql(`UPDATE user_account SET status = 'suspended' WHERE id = $1`, [target.id]);
    expect((await admin.patch(`/admin/items/${itemId}`, { ownerId: target.id.toUpperCase() })).status).toBe(200);
    expect(await ownerOf(itemId)).toBe(target.id);
  });
});

describe('a dispute moving through its steps', () => {
  async function openDispute() {
    const admin = await signIn(SEED.admin);
    const txns = (await admin.get('/admin/transactions')).body as { id: string }[];
    const opened = await admin.post('/admin/disputes', { transactionId: txns[0]!.id, note: 'Steps test' });
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    return { admin, id: opened.body.id as string };
  }

  it('only moves forward, needs a ruling to be ruled, and stays closed', async () => {
    const { admin, id } = await openDispute();
    const to = (body: Record<string, unknown>) => admin.patch(`/admin/disputes/${id}`, body);

    expect((await to({ status: 'investigating' })).status).toBe(200);
    const back = await to({ status: 'open' });
    expect(back.status).toBe(400);
    expect(back.body.error.message).toBe('A dispute that is investigating cannot go back to open.');

    const noRuling = await to({ status: 'ruled' });
    expect(noRuling.status).toBe(400);
    expect(noRuling.body.error.message).toBe('Write the ruling before marking the dispute ruled.');
    const blank = await to({ status: 'ruled', ruling: '   ' });
    expect(blank.status).toBe(400);
    const long = await to({ status: 'ruled', ruling: 'x'.repeat(2001) });
    expect(long.status).toBe(400);
    expect(long.body.error.message).toBe('The ruling can be at most 2000 characters.');

    const ruled = await to({ status: 'ruled', ruling: '  Refund the buyer.  ' });
    expect(ruled.status, JSON.stringify(ruled.body)).toBe(200);
    expect(ruled.body).toMatchObject({ status: 'ruled', ruling: 'Refund the buyer.' });
    expect((await to({ status: 'ruled', ruling: 'Refund the buyer in full.' })).status).toBe(200);
    expect((await to({ status: 'investigating' })).status).toBe(400);

    expect((await to({ status: 'closed' })).status).toBe(200);
    const reopened = await to({ status: 'closed', ruling: 'Changed my mind.' });
    expect(reopened.status).toBe(400);
    expect(reopened.body.error.message).toBe('This dispute is closed and cannot be changed.');
    expect((await admin.patch('/admin/disputes/not-a-uuid', { status: 'closed' })).status).toBe(400);
  });
});

describe("the console's sign-in log", () => {
  it('counts as failures only what the lockout counts: a wrong password or a wrong code', async () => {
    const stamp = Date.now();
    const refusedOnly = `refused-${stamp}`;
    const guessed = `guessed-${stamp}`;
    for (let i = 0; i < 5; i += 1) {
      await sql(
        `INSERT INTO login_attempt (identifier, outcome, ip) VALUES ($1, 'refused', '10.9.0.1'), ($1, 'unverified', '10.9.0.1'),
                ($2, $3, '10.9.0.2')`,
        [refusedOnly, guessed, i % 2 === 0 ? 'bad_credentials' : 'mfa_failed'],
      );
    }
    const log = await (await signIn(SEED.admin)).get('/admin/logins');
    expect(log.status).toBe(200);
    const flagged = (log.body.suspicious as { identifier: string }[]).map((s) => s.identifier);
    expect(flagged).toContain(guessed);
    expect(flagged).not.toContain(refusedOnly);
  });
});

