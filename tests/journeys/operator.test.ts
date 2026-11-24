import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { SandboxOcrProvider, createStorageAdapter } from '@bault/adapters';
import { loadEnv } from '@bault/config';
import { readRequestedPhotos } from '../../apps/worker/src/jobs/ocr-read';
import { SEED, SEED_USERNAME, binIds, signIn, type Client } from '../integration/helpers/http';
import { closeDb } from '../integration/helpers/db';
import { startOcrApi, type OcrApi } from '../integration/helpers/ocr-api';
import {
  WEB_PORT,
  aShelf,
  activeCollector,
  fund,
  gone,
  openPage,
  panel,
  says,
  shows,
  signInAs,
  stack,
  type Collector,
  type Stack,
} from './helpers/journey';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const OCR_WEB_PORT = WEB_PORT + 1;

let api: OcrApi | null = null;
let base = '';
let s: Stack;
let pool: Pool;
let collector: Collector;
let shipment: { id: string; code: string };
let shipped: { id: string; serialNumber: string };

async function shipmentReadyToPack(operator: Client): Promise<void> {
  const [bin] = await binIds(operator);
  const card = await operator.post('/intake/items', {
    ownerUsername: collector.username,
    typeClass: 'trading_card',
    binId: bin,
    description: `Rayquaza ex 97/97 for ${collector.username}`,
  });
  expect(card.status, JSON.stringify(card.body)).toBe(201);
  shipped = card.body;
  const address = await collector.client.post('/me/addresses', {
    label: 'Home',
    recipient: 'Journey Operator',
    line1: '12 Vine St',
    city: 'Trenton',
    region: 'NJ',
    country: 'US',
    postalCode: '08608',
  });
  expect(address.status, JSON.stringify(address.body)).toBe(201);
  const created = await collector.client.post('/shipping/shipments', {
    itemIds: [shipped.id],
    addressId: address.body.id,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  shipment = created.body;
  const rates = (await collector.client.get(`/shipping/shipments/${shipment.id}/rates`)).body as {
    carrier: string;
    serviceLevel: string;
  }[];
  const chosen = await collector.client.post(`/shipping/shipments/${shipment.id}/select-rate`, {
    carrier: rates[0]!.carrier,
    serviceLevel: rates[0]!.serviceLevel,
  });
  expect(chosen.status, JSON.stringify(chosen.body)).toBe(201);
}

async function theWorkerReadsThePhotos(): Promise<void> {
  const env = loadEnv();
  await readRequestedPhotos(pool, { storage: createStorageAdapter(env), ocr: new SandboxOcrProvider() });
}

beforeAll(async () => {
  api = await startOcrApi({ CORS_ORIGINS: `http://localhost:${OCR_WEB_PORT}` });
  base = api.base;
  s = await stack(base, OCR_WEB_PORT);
  pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL, max: 2 });
  collector = await activeCollector('operated', base);
  await fund(collector, 20_000, base);
  await shipmentReadyToPack(await signIn(SEED.operator, undefined, base));
});

afterAll(async () => {
  await s?.close();
  await pool?.end();
  api?.stop();
  await closeDb();
});

async function addPhoto(page: import('playwright-core').Page, scope: import('playwright-core').Locator, name: string) {
  const chooser = page.waitForEvent('filechooser');
  await scope.getByRole('button', { name: 'Add a photo' }).first().click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: PNG });
}

describe('journey: a warehouse operator, from the dock to the carrier', () => {
  it('receives a parcel, books it in with the photo read, prints the label, shelves it and dispatches a shipment', async () => {
    const page = await openPage(s, 'operator');
    const tracking = `94${String(Date.now()).padStart(14, '0')}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;

    await signInAs(page, SEED_USERNAME.operator);
    await page.getByRole('tab', { name: 'Receiving' }).click();
    const arrival = panel(page, 'Receive an arrival');
    await arrival.getByRole('textbox', { name: 'Username on the parcel' }).fill(collector.username);
    await addPhoto(page, arrival, 'label.png');
    await shows(arrival.getByRole('list', { name: 'Arrival photos' }).getByRole('img'));
    await arrival.getByRole('button', { name: 'Receive parcel' }).click();
    const next = page.getByText(/^Next: open and check PKG-[A-Z0-9]+ in Inbound parcels below\.$/);
    await shows(next);
    const parcelCode = /PKG-[A-Z0-9]+/.exec((await next.textContent()) ?? '')![0];

    await theWorkerReadsThePhotos();
    const labelRead = page.getByRole('region', { name: 'Read from the label photo' });
    await says(labelRead, 'Check every field against the photo.');
    await says(labelRead, 'Read from the photo · 90% sure');
    await labelRead.getByRole('textbox', { name: 'Tracking number' }).fill(tracking);
    for (const field of ['Carrier', 'Sender', 'Sender address']) {
      await labelRead.getByRole('checkbox', { name: `Matches the photo · ${field}`, exact: true }).check();
    }
    await labelRead.getByRole('button', { name: 'Save the checked details' }).click();
    await says(page.getByRole('status').filter({ hasText: 'Read from the label photo' }), 'Saved. What was read from the photo is used up.');

    const row = page.getByRole('row', { name: new RegExp(parcelCode) });
    await says(row, `@${collector.username}`);
    await row.getByRole('button', { name: 'Open and check' }).click();
    await row.getByRole('textbox', { name: 'What you found' }).fill('Sound. One graded slab, bubble-wrapped.');
    await row.getByRole('button', { name: 'Open and check' }).click();
    await says(page.getByRole('status').filter({ hasText: `Parcel ${parcelCode} opened` }), 'Next: book what is inside on the Receive bench.');
    await says(row, tracking);
    await row.getByRole('button', { name: 'Book contents' }).click();

    const bench = panel(page, 'Receive bench');
    await bench.getByLabel('Where it goes').selectOption({ label: 'Decide the shelf later' });
    await bench.getByLabel('Why later').selectOption({ label: 'Waiting for grading' });
    await bench.getByLabel('Type / class').selectOption({ label: 'Graded slab' });
    await bench.getByRole('textbox', { name: 'Description' }).fill('Typed at the bench');
    await addPhoto(page, bench, 'slab.png');
    await shows(bench.getByRole('list', { name: 'Item photos' }).getByRole('img'));
    await bench.getByRole('button', { name: 'Intake', exact: true }).click();
    await says(page.getByRole('status').filter({ hasText: 'Booked in' }), '1 → Later');

    await theWorkerReadsThePhotos();
    const itemRead = page.getByRole('region', { name: 'Read from the item photo' });
    await says(itemRead, 'Read from the photo · 90% sure');
    await itemRead.getByRole('textbox', { name: 'Name', exact: true }).fill('Rayquaza');
    await itemRead.getByRole('textbox', { name: 'Set', exact: true }).fill('EX Deoxys');
    for (const field of ['Number in the set', 'Year', 'Grading body', 'Grade', 'Certificate number']) {
      await itemRead.getByRole('checkbox', { name: `Matches the photo · ${field}`, exact: true }).check();
    }
    await itemRead.getByRole('button', { name: 'Save the checked details' }).click();
    await says(page.getByRole('status').filter({ hasText: 'Read from the item photo' }), 'Saved. What was read from the photo is used up.');

    const labels = page.getByRole('heading', { name: 'Labels for what you just booked in' });
    await shows(labels);
    const pdf = page.getByRole('link', { name: 'Open the label PDF (1)' });
    const href = await pdf.getAttribute('href');
    const printed = await page.request.get(new URL(href!, s.web.url).toString());
    expect(printed.status()).toBe(200);
    expect(printed.headers()['content-type']).toContain('application/pdf');

    await page.getByRole('tab', { name: 'Inventory' }).click();
    const toShelve = panel(page, 'To shelve');
    const waiting = toShelve.getByRole('row', { name: /Rayquaza · EX Deoxys/ });
    await says(waiting, parcelCode);
    await says(waiting, 'Waiting for grading');
    await says(waiting, 'PSA cert 12345678');
    await waiting.getByRole('button', { name: /^Stow SN-/ }).click();
    await toShelve.getByRole('textbox', { name: 'Scan shelf' }).fill(await aShelf());
    await toShelve.getByRole('button', { name: 'Relocate' }).click();
    await gone(waiting);

    await page.getByRole('tab', { name: 'Shipments' }).click();
    const fulfil = panel(page, 'Fulfill shipment');
    const queue = fulfil.getByRole('region', { name: /^Waiting to be packed/ });
    const ready = queue.getByRole('listitem').filter({ hasText: shipment.code });
    await shows(ready);
    await says(ready, `for @${collector.username}`);
    await ready.getByRole('button', { name: `Pack ${shipment.code}` }).click();
    const pickList = fulfil.getByRole('region', { name: 'Pick list' });
    await says(pickList, 'Journey Operator, 12 Vine St, Trenton, NJ 08608, US');
    await says(pickList, 'Not scanned yet');
    await says(fulfil, 'This is the box the customer paid for.');
    await fulfil.getByRole('textbox', { name: 'Scan each item' }).fill(shipped.serialNumber);
    await fulfil.getByRole('button', { name: 'Add', exact: true }).click();
    await says(pickList, '1 / 1');
    await fulfil.getByRole('spinbutton', { name: 'Package weight (grams)' }).fill('120');
    await fulfil.getByRole('textbox', { name: 'Notes' }).fill('Top-loader in a rigid mailer.');
    await fulfil.getByRole('button', { name: 'Complete', exact: true }).click();
    await says(pickList.getByRole('status'), `Dispatched ${shipment.code} · `);
    await gone(ready);
    await shows(page.getByRole('listitem').filter({ hasText: `Dispatched ${shipment.code} · tracking ` }));

    const track = await collector.client.get(`/shipping/shipments/${shipment.id}`);
    expect(['shipped', 'in_transit', 'delivered']).toContain(track.body.status);
  });
});
