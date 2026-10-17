import { afterAll, describe, it, expect } from 'vitest';
import { SEED, signIn } from './helpers/http';
import { activeAccount } from './helpers/mfa';
import { closeDb, sql } from './helpers/db';

/**
 * What the admin console's Save buttons may and may not change on the server.
 *
 * The console's rows used to send every field on every save, so the server read
 * an unchanged field as a decision. These pin the server side: a field that is
 * sent but does not change does nothing beyond what it says.
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
