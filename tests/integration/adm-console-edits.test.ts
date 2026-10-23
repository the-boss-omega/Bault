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
