import { afterAll, describe, expect, it } from 'vitest';
import { Client, SEED, signIn } from './helpers/http';
import { closeDb, sql } from './helpers/db';

afterAll(closeDb);

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const PDF = PDF_BYTES.toString('base64');
const TEXT = Buffer.from('Paid on Monday, honest. No statement attached.').toString('base64');

let counter = 0;
const reference = (label: string) => `receipt-${label}-${Date.now()}-${counter++}`;

async function uploadReceipt(client: Client, dataBase64 = PDF, contentType = 'application/pdf') {
  return client.post('/media/uploads', { purpose: 'cash_in_receipt', contentType, dataBase64 });
}

async function receiptKey(client: Client, dataBase64 = PDF, contentType = 'application/pdf'): Promise<string> {
  const res = await uploadReceipt(client, dataBase64, contentType);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.objectKey as string;
}

const cashIn = (client: Client, extra: Record<string, unknown> = {}) =>
  client.post('/finance/wallet-requests', {
    type: 'cash_in',
    amountMinor: 12_34,
    currency: 'USD',
    fundingSource: 'bank_transfer',
    reference: reference('ci'),
    ...extra,
  });

async function userIdOf(client: Client): Promise<string> {
  return (await client.get('/me/profile')).body.id as string;
}

describe('a collector uploads a receipt', () => {
  it('takes a PDF or an image, judged by its bytes, and keeps it under the collector’s own prefix', async () => {
    const red = await signIn(SEED.collector);
    const id = await userIdOf(red);

    const pdf = await uploadReceipt(red);
    expect(pdf.status).toBe(201);
    expect(pdf.body.contentType).toBe('application/pdf');
    expect(pdf.body.objectKey).toMatch(new RegExp(`^receipts/${id}/\\d{4}/\\d{2}/[0-9a-f-]+\\.pdf$`));

    const png = await uploadReceipt(red, PNG, 'image/png');
    expect(png.status).toBe(201);
    expect(png.body.contentType).toBe('image/png');

    const labelledWrong = await uploadReceipt(red, PDF, 'image/jpeg');
    expect(labelledWrong.status).toBe(201);
    expect(labelledWrong.body.contentType).toBe('application/pdf');
  });

  it('refuses text that calls itself a PDF', async () => {
    const red = await signIn(SEED.collector);
    const res = await uploadReceipt(red, TEXT, 'application/pdf');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/PDF/);
  });

  it('refuses a receipt larger than 5 MB, with the limit in megabytes', async () => {
    const red = await signIn(SEED.collector);
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(5 * 1024 * 1024 + 10, 0x20)]);
    const res = await uploadReceipt(red, big.toString('base64'));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/5 MB/);
  });

  it('still refuses a collector the staff purposes, and refuses staff the receipt purpose', async () => {
    const red = await signIn(SEED.collector);
    expect((await red.post('/media/uploads', { purpose: 'item_intake', contentType: 'image/png', dataBase64: PNG })).status).toBe(403);
    expect((await red.post('/media/uploads', { purpose: 'parcel', contentType: 'image/png', dataBase64: PNG })).status).toBe(403);
    const operator = await signIn(SEED.operator);
    expect((await uploadReceipt(operator)).status).toBe(403);
  });
});

describe('a receipt on a cash-in request', () => {
  it('is attached when the request is made, read by its owner and by staff through a signed link, and by no other collector', async () => {
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);
    const admin = await signIn(SEED.admin);

    const key = await receiptKey(red);
    const created = await cashIn(red, { documentKey: key });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.receiptAttached).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain(key);
    const id = created.body.id as string;

    const mine = await red.get(`/finance/wallet-requests/${id}/receipt`);
    expect(mine.status).toBe(200);
    expect(mine.body.contentType).toBe('application/pdf');
    expect(mine.body.expiresInSeconds).toBeGreaterThan(0);
    expect(mine.body.url).toMatch(/X-Amz-Expires=/);
    const fetched = await fetch(mine.body.url as string);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(PDF_BYTES)).toBe(true);

    const theirs = await golden.get(`/finance/wallet-requests/${id}/receipt`);
    expect([403, 404]).toContain(theirs.status);
    expect(JSON.stringify(theirs.body)).not.toContain(key);
    expect((await golden.get(`/finance/wallet-requests/${id}`)).status).toBe(404);

    const staff = await admin.get(`/admin/wallet-requests/${id}`);
    expect(staff.status).toBe(200);
    expect(staff.body.documentKey).toBe(key);
    expect(staff.body.receipt.contentType).toBe('application/pdf');
    expect(staff.body.receipt.expiresInSeconds).toBeGreaterThan(0);
    const staffFetch = await fetch(staff.body.receipt.url as string);
    expect(staffFetch.status).toBe(200);
  });

  it('cannot carry another collector’s receipt, even one uploaded a moment ago', async () => {
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);
    const goldensKey = await receiptKey(golden);
    const res = await cashIn(red, { documentKey: goldensKey });
    expect(res.status).toBe(403);
  });

  it('cannot carry a key this API never minted, nor a staff photograph', async () => {
    const red = await signIn(SEED.collector);
    const operator = await signIn(SEED.operator);
    const unminted = await cashIn(red, { documentKey: 'receipts/2026/receipt.v2.pdf' });
    expect(unminted.status).toBe(400);
    expect(unminted.body.error.message).not.toMatch(/segment/);

    const photo = await operator.post('/media/uploads', { purpose: 'parcel', contentType: 'image/png', dataBase64: PNG });
    expect(photo.status).toBe(201);
    const staffKey = photo.body.objectKey as string;
    await sql(`UPDATE media_upload SET uploaded_by = (SELECT id FROM user_account WHERE email = $1) WHERE object_key = $2`, [
      SEED.collector,
      staffKey,
    ]);
    const wrongPurpose = await cashIn(red, { documentKey: staffKey });
    expect(wrongPurpose.status).toBe(400);
  });

  it('is not taken on a cash-out', async () => {
    const red = await signIn(SEED.collector);
    const key = await receiptKey(red);
    const res = await red.post('/finance/wallet-requests', {
      type: 'cash_out',
      amountMinor: 20_00,
      currency: 'USD',
      destinationAccount: 'GB29NWBK60161331926819',
      beneficiaryName: 'Red Ashwood',
      reference: reference('co'),
      documentKey: key,
    });
    expect(res.status).toBe(400);
  });

  it('is not shared by two requests', async () => {
    const red = await signIn(SEED.collector);
    const key = await receiptKey(red);
    expect((await cashIn(red, { documentKey: key })).status).toBe(201);
    const second = await cashIn(red, { documentKey: key, amountMinor: 13_00 });
    expect(second.status).toBe(409);
  });

  it('is said to be missing where there is none', async () => {
    const red = await signIn(SEED.collector);
    const created = await cashIn(red);
    expect(created.status).toBe(201);
    expect(created.body.receiptAttached).toBe(false);
    expect((await red.get(`/finance/wallet-requests/${created.body.id}/receipt`)).status).toBe(404);
    const admin = await signIn(SEED.admin);
    expect((await admin.get(`/admin/wallet-requests/${created.body.id}`)).body.receipt).toBeNull();
  });
});

describe('attaching or replacing a receipt later', () => {
  it('works for the owner while the request is submitted or under review', async () => {
    const red = await signIn(SEED.collector);
    const admin = await signIn(SEED.admin);
    const created = await cashIn(red);
    const id = created.body.id as string;

    const first = await receiptKey(red);
    const attached = await red.put(`/finance/wallet-requests/${id}/receipt`, { documentKey: first });
    expect(attached.status, JSON.stringify(attached.body)).toBe(200);
    expect(attached.body.receiptAttached).toBe(true);
    expect(JSON.stringify(attached.body)).not.toContain(first);

    expect((await admin.post(`/admin/wallet-requests/${id}/review`, {})).status).toBe(201);
    const second = await receiptKey(red, PNG, 'image/png');
    const replaced = await red.put(`/finance/wallet-requests/${id}/receipt`, { documentKey: second });
    expect(replaced.status).toBe(200);

    const staff = await admin.get(`/admin/wallet-requests/${id}`);
    expect(staff.body.documentKey).toBe(second);
    expect(staff.body.receipt.contentType).toBe('image/png');

    const audits = await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_record WHERE action = 'wallet_request.receipt' AND target_id = $1`,
      [id],
    );
    expect(audits[0]!.n).toBe(2);
  });

  it('is refused once the request is completed, and leaves the receipt as it was', async () => {
    const red = await signIn(SEED.collector);
    const admin = await signIn(SEED.admin);
    const first = await receiptKey(red);
    const created = await cashIn(red, { documentKey: first });
    const id = created.body.id as string;
    expect((await admin.post(`/admin/wallet-requests/${id}/approve`, {})).status).toBe(201);
    expect((await admin.post(`/admin/wallet-requests/${id}/complete`, {})).status).toBe(201);

    const late = await receiptKey(red);
    const res = await red.put(`/finance/wallet-requests/${id}/receipt`, { documentKey: late });
    expect(res.status).toBe(409);
    expect((await admin.get(`/admin/wallet-requests/${id}`)).body.documentKey).toBe(first);
  });

  it('is refused to anyone but the owner', async () => {
    const red = await signIn(SEED.collector);
    const golden = await signIn(SEED.collector2);
    const created = await cashIn(red);
    const goldensKey = await receiptKey(golden);
    const res = await golden.put(`/finance/wallet-requests/${created.body.id}/receipt`, { documentKey: goldensKey });
    expect(res.status).toBe(404);
  });
});
