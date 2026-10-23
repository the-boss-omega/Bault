import { afterAll, describe, it, expect } from 'vitest';
import { SEED, signIn, type Client } from '../integration/helpers/http';
import { activeAccount, passwordOnly, type Account } from '../integration/helpers/mfa';
import { closeDb, openTransaction, sql, waitForLockWaiters } from '../integration/helpers/db';

afterAll(closeDb);

type Res = Awaited<ReturnType<Client['post']>>;

async function memberWithListing(label: string, admin: Client, operator: Client) {
  const account = await activeAccount(label);
  const c = await passwordOnly(account);
  const cashIn = await c.post('/finance/wallet-requests', {
    type: 'cash_in',
    amountMinor: 60_000,
    currency: 'USD',
    fundingSource: 'bank_transfer',
    reference: `${label}-${Date.now()}`,
  });
  expect(cashIn.status).toBe(201);
  expect((await admin.post(`/admin/wallet-requests/${cashIn.body.id}/approve`, {})).status).toBe(201);
  expect((await admin.post(`/admin/wallet-requests/${cashIn.body.id}/complete`, {})).status).toBe(201);
  expect([200, 201]).toContain((await c.post('/membership/subscribe', { tier: 'registry' })).status);

  const bins = (await operator.get('/custody/bins')).body as { id: string }[];
  const card = await operator.post('/intake/items', {
    ownerUsername: account.username,
    typeClass: 'trading_card',
    binId: bins[0]!.id,
    description: `Cross purchase: ${label}`,
  });
  expect(card.status).toBe(201);
  const listing = await c.post('/marketplace/listings', { itemId: card.body.id, askingPrice: 10_000 });
  expect(listing.status).toBe(201);
  const [period] = await sql<{ id: string }>(
    `select p.id from membership_period p join membership m on m.id = p.membership_id
      where m.user_id = $1 and p.period_start = m.current_period_start`,
    [account.id],
  );
  expect(period).toBeTruthy();
  return { account, client: c, listingId: listing.body.id as string, periodId: period!.id };
}

async function payment(member: Account) {
  const t = await openTransaction();
  await t.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`wallet:${member.id}`]);
  return t;
}

describe('concurrency: two collectors buying from each other', () => {
  it('both sales complete while both are paying for something else', async () => {
    const admin = await signIn(SEED.admin);
    const operator = await signIn(SEED.operator);
    const a = await memberWithListing('xbuya', admin, operator);
    const b = await memberWithListing('xbuyb', admin, operator);

    const payA = await payment(a.account);
    const payB = await payment(b.account);
    let sales: Promise<Res>[] = [];
    const periodWrites: Promise<unknown>[] = [];
    try {
      sales = [
        a.client.post(`/marketplace/listings/${b.listingId}/purchase`),
        b.client.post(`/marketplace/listings/${a.listingId}/purchase`),
      ];
      await waitForLockWaiters(2);
      for (const [t, periodId] of [
        [payA, a.periodId],
        [payB, b.periodId],
      ] as const) {
        periodWrites.push(
          t.query('update membership_period set updated_at = now() where id = $1', [periodId]).catch((e: Error) => e),
        );
      }
      await new Promise((r) => setTimeout(r, 1_800));
    } finally {
      await Promise.all([payA.rollback(), payB.rollback()]);
    }
    await Promise.all(periodWrites);
    const res = await Promise.all(sales);

    expect(res.map((r) => r.status)).toEqual([201, 201]);
  }, 30_000);
});
