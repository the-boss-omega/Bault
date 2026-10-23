import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { sweepWalletSuspensions } from '../../apps/worker/src/jobs/wallet-suspension';
import { SEED, signIn } from '../integration/helpers/http';
import { createUser, ledger, testPool } from './helpers/db';

let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});

const account = async (pool: Pool, id: string) =>
  (
    await pool.query<{ status: string; auto: boolean }>(
      `SELECT status, auto_suspended_at IS NOT NULL AS auto FROM user_account WHERE id = $1`,
      [id],
    )
  ).rows[0]!;

describe('wallet suspension sweep', () => {
  it('suspends once and reinstates once, however often it runs', async () => {
    const debtor = await createUser(pool);
    await ledger(pool, debtor, 'debit', 5_000, 1);
    await sweepWalletSuspensions(pool);
    await sweepWalletSuspensions(pool);
    expect(await account(pool, debtor)).toEqual({ status: 'suspended', auto: true });

    await ledger(pool, debtor, 'credit', 5_000);
    await sweepWalletSuspensions(pool);
    await sweepWalletSuspensions(pool);
    expect(await account(pool, debtor)).toEqual({ status: 'active', auto: false });
  });

  it("does not lift an administrator's suspension of an account it once suspended itself (N7)", async () => {
    const admin = await signIn(SEED.admin);
    const debtor = await createUser(pool);
    await ledger(pool, debtor, 'debit', 5_000, 1);

    await sweepWalletSuspensions(pool);
    expect(await account(pool, debtor)).toEqual({ status: 'suspended', auto: true });

    expect((await admin.patch(`/admin/users/${debtor}`, { status: 'active' })).status).toBe(200);
    expect((await admin.patch(`/admin/users/${debtor}`, { status: 'suspended' })).status).toBe(200);
    expect(await account(pool, debtor)).toEqual({ status: 'suspended', auto: false });

    await ledger(pool, debtor, 'credit', 5_000);
    await sweepWalletSuspensions(pool);
    expect((await account(pool, debtor)).status).toBe('suspended');
  });

  it("does not lift a suspension an administrator kept, though the sweep imposed it", async () => {
    const admin = await signIn(SEED.admin);
    const debtor = await createUser(pool);
    await ledger(pool, debtor, 'debit', 5_000, 1);
    await sweepWalletSuspensions(pool);
    expect(await account(pool, debtor)).toEqual({ status: 'suspended', auto: true });

    expect((await admin.patch(`/admin/users/${debtor}`, { status: 'suspended' })).status).toBe(200);
    expect(await account(pool, debtor)).toEqual({ status: 'suspended', auto: false });

    await ledger(pool, debtor, 'credit', 5_000);
    await sweepWalletSuspensions(pool);
    expect(await account(pool, debtor)).toEqual({ status: 'suspended', auto: false });
  });
});
