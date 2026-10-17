import { afterAll, describe, it, expect } from 'vitest';
import { SEED, intakeFor, signIn } from './helpers/http';
import { activeAccount } from './helpers/mfa';
import { closeDb, sql } from './helpers/db';

/**
 * What the admin console's Save buttons may and may not change on the server.
 *
 * A console row may send a field it did not change. These pin the server side:
 * a field that is sent but does not change does nothing beyond what it says.
 *
 * Requires a running API + a freshly seeded DB.
 */

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
  /** An account in the state the sweep leaves it: suspended, with its marker. */
  async function autoSuspended(label: string) {
    const account = await activeAccount(label);
    await sql(`UPDATE user_account SET status = 'suspended', auto_suspended_at = now() WHERE id = $1`, [account.id]);
    expect(await marker(account.id)).toEqual({ status: 'suspended', auto: true });
    return account;
  }

  it('keeps the sweep\'s marker when the status sent is the status it already has', async () => {
    const admin = await signIn(SEED.admin);
    const account = await autoSuspended('autosus');

    // A name correction, with the unchanged status alongside it.
    const res = await admin.patch(`/admin/users/${account.id}`, { firstName: 'Renamed', status: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Renamed');
    // Still the sweep's own suspension, so the sweep lifts it once the debt clears.
    expect(await marker(account.id)).toEqual({ status: 'suspended', auto: true });
  });

  it('clears the marker when an administrator actually changes the status', async () => {
    const admin = await signIn(SEED.admin);
    const account = await autoSuspended('autosu2');

    expect((await admin.patch(`/admin/users/${account.id}`, { status: 'active' })).status).toBe(200);
    expect(await marker(account.id)).toEqual({ status: 'active', auto: false });
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
    // The listing went with the previous owner, so the card is not `listed`.
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
