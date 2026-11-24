import { afterAll, describe, it, expect } from 'vitest';
import { SEED, signIn, type Client } from '../integration/helpers/http';
import { closeDb, openTransaction, sql, waitForLockWaiters } from '../integration/helpers/db';

afterAll(closeDb);

const idOf = async (email: string) =>
  (await sql<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [email]))[0]!.id;

async function openTicket(collector: Client, subject: string): Promise<string> {
  const opened = await collector.post('/support/tickets', {
    category: 'other',
    subject,
    body: 'Somebody will take this while somebody else answers it.',
  });
  expect(opened.status, JSON.stringify(opened.body)).toBe(201);
  return opened.body.id as string;
}

async function replyWhileTaken(replier: Client, ticketId: string, takerId: string) {
  const held = await openTransaction();
  try {
    await held.query(`SELECT 1 FROM support_ticket WHERE id = $1 FOR UPDATE`, [ticketId]);
    const reply = replier.post(`/support/tickets/${ticketId}/messages`, { body: 'An answer sent at the same moment.' });
    await waitForLockWaiters(1);
    await held.query(`UPDATE support_ticket SET assigned_to = $2 WHERE id = $1`, [ticketId, takerId]);
    await held.query('COMMIT');
    const res = await reply;
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  } finally {
    await held.rollback();
  }
  return (await sql<{ assigned_to: string | null }>(`SELECT assigned_to FROM support_ticket WHERE id = $1`, [ticketId]))[0]!
    .assigned_to;
}

describe('a reply that races somebody taking the ticket', () => {
  it("keeps the assignment when the customer replies", async () => {
    const collector = await signIn(SEED.collector);
    const operatorId = await idOf(SEED.operator);
    const ticketId = await openTicket(collector, 'Customer reply race');

    expect(await replyWhileTaken(collector, ticketId, operatorId)).toBe(operatorId);
  });

  it('keeps the winner of the assignment when another member of staff replies', async () => {
    const collector = await signIn(SEED.collector);
    const admin = await signIn(SEED.admin);
    const operatorId = await idOf(SEED.operator);
    const ticketId = await openTicket(collector, 'Staff reply race');

    expect(await replyWhileTaken(admin, ticketId, operatorId)).toBe(operatorId);
  });

  it('still claims an unassigned ticket for the member of staff who answers it', async () => {
    const collector = await signIn(SEED.collector);
    const admin = await signIn(SEED.admin);
    const ticketId = await openTicket(collector, 'Staff reply claims');

    const res = await admin.post(`/support/tickets/${ticketId}/messages`, { body: 'Taking this one.' });
    expect(res.status).toBe(201);
    const [row] = await sql<{ assigned_to: string }>(`SELECT assigned_to FROM support_ticket WHERE id = $1`, [ticketId]);
    expect(row!.assigned_to).toBe(await idOf(SEED.admin));
  });
});
