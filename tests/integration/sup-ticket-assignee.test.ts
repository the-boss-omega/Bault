import { afterAll, describe, expect, it } from 'vitest';
import { SEED, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

async function aTicket(): Promise<string> {
  const collector = await signIn(SEED.collector);
  const res = await collector.post('/support/tickets', {
    category: 'other',
    subject: `Assignee key ${Date.now()}`,
    body: 'Checking who a ticket can be assigned to.',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body.id ?? res.body.ticket?.id) as string;
}

describe('SUP a ticket is assigned to an account', () => {
  it('stores the assignee as a key to an account, so only a real account can be assigned', async () => {
    const [column] = await sql<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'support_ticket' AND column_name = 'assigned_to'`,
    );
    expect(column!.data_type).toBe('uuid');

    const ticketId = await aTicket();
    await expect(
      sql(`UPDATE support_ticket SET assigned_to = '00000000-0000-0000-0000-000000000000' WHERE id = $1`, [ticketId]),
    ).rejects.toThrow(/foreign key/);
    await expect(sql(`UPDATE support_ticket SET assigned_to = 'someone' WHERE id = $1`, [ticketId])).rejects.toThrow(
      /uuid/,
    );
  });

  it('still lets a staff member take a ticket', async () => {
    const ticketId = await aTicket();
    const operator = await signIn(SEED.operator);
    const taken = await operator.post(`/support/tickets/${ticketId}/assign`, {});
    expect(taken.status, JSON.stringify(taken.body)).toBe(201);
    const [row] = await sql<{ assigned_to: string }>(`SELECT assigned_to FROM support_ticket WHERE id = $1`, [ticketId]);
    const [me] = await sql<{ id: string }>(`SELECT id FROM user_account WHERE email = $1`, [SEED.operator]);
    expect(row!.assigned_to).toBe(me!.id);
  });
});
