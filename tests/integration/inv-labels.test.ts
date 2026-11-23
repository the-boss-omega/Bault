import { describe, it, expect, beforeAll } from 'vitest';
import { Client, SEED, intakeFor, signIn } from './helpers/http';

function pageCount(pdf: string): number {
  return Number(pdf.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)![1]);
}

describe('INV one barcode label for items and parcels', () => {
  let operator: Client;
  let collector: Client;
  let admin: Client;
  const items: { id: string; serialNumber: string; barcode: string }[] = [];
  let parcelId = '';
  let parcelCode = '';

  beforeAll(async () => {
    operator = await signIn(SEED.operator);
    collector = await signIn(SEED.collector);
    admin = await signIn(SEED.admin);
    for (let i = 0; i < 3; i += 1) {
      items.push(await intakeFor(operator, SEED.collector, { description: `Label check ${i}` }));
    }
    const facilities = (await operator.get('/me/inbound-addresses')).body as { code: string }[];
    const received = await operator.post('/parcels/receive', {
      facilityCode: facilities[0]!.code,
      notes: 'Label check parcel',
    });
    expect(received.status).toBe(201);
    parcelId = received.body.id as string;
    parcelCode = received.body.code as string;
  });

  it('gives staff one item label, a 50 by 25 mm PDF carrying the barcode and the serial', async () => {
    for (const who of [operator, admin]) {
      const res = await who.getText(`/custody/items/${items[0]!.id}/label.pdf`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/pdf');
      expect(res.text.startsWith('%PDF-1.4')).toBe(true);
      expect(res.text).toContain('/MediaBox [0 0 141.73 70.87]');
      expect(pageCount(res.text)).toBe(1);
      expect(res.text).toContain(`(${items[0]!.barcode}) Tj`);
      expect(res.text).toContain(`(${items[0]!.serialNumber}) Tj`);
    }
  });

  it('finds the item by its scanned code as well as by its id', async () => {
    const res = await operator.getText(`/custody/items/${encodeURIComponent(items[1]!.barcode)}/label.pdf`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`(${items[1]!.barcode}) Tj`);
  });

  it('gives staff a parcel label carrying the parcel code, by id or by code', async () => {
    for (const key of [parcelId, parcelCode]) {
      const res = await operator.getText(`/parcels/${encodeURIComponent(key)}/label.pdf`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/pdf');
      expect(res.text).toContain('/MediaBox [0 0 141.73 70.87]');
      expect(pageCount(res.text)).toBe(1);
      expect(res.text).toContain(`(${parcelCode}) Tj`);
    }
  });

  it('prints a batch as one PDF, one page per label, in the order asked', async () => {
    const ids = items.map((i) => i.id).join(',');
    const res = await operator.getText(`/custody/labels.pdf?ids=${ids}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    expect(pageCount(res.text)).toBe(3);
    const at = items.map((i) => res.text.indexOf(`(${i.barcode}) Tj`));
    expect(at.every((n) => n > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('refuses an empty batch, and answers 404 for an item or parcel that is not there', async () => {
    expect((await operator.getText('/custody/labels.pdf')).status).toBe(400);
    expect((await operator.getText('/custody/labels.pdf?ids=,')).status).toBe(400);
    expect((await operator.getText(`/custody/labels.pdf?ids=${items[0]!.id},SN-NOPE-0000`)).status).toBe(404);
    expect((await operator.getText('/custody/items/SN-NOPE-0000/label.pdf')).status).toBe(404);
    expect((await operator.getText('/parcels/PKG-NOPE0000/label.pdf')).status).toBe(404);
    expect((await operator.getText('/parcels/00000000-0000-4000-8000-000000000000/label.pdf')).status).toBe(404);
  });

  it('answers a collector 403 on all three, even for their own item and parcel', async () => {
    expect((await collector.getText(`/custody/items/${items[0]!.id}/label.pdf`)).status).toBe(403);
    expect((await collector.getText(`/custody/labels.pdf?ids=${items[0]!.id}`)).status).toBe(403);
    expect((await collector.getText(`/parcels/${parcelId}/label.pdf`)).status).toBe(403);
  });

  it('answers 401 to nobody signed in', async () => {
    const anonymous = new Client();
    expect((await anonymous.getText(`/custody/items/${items[0]!.id}/label.pdf`)).status).toBe(401);
    expect((await anonymous.getText(`/parcels/${parcelId}/label.pdf`)).status).toBe(401);
  });
});
