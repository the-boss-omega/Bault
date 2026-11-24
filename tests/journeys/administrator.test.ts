import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { SEED, SEED_PASSWORD, SEED_USERNAME, binIds, signIn, type Client } from '../integration/helpers/http';
import { closeDb } from '../integration/helpers/db';
import {
  PASSWORD,
  activeCollector,
  fund,
  openPage,
  panel,
  pressAndSettle,
  says,
  shows,
  signInAs,
  signOut,
  stack,
  type Collector,
  type Stack,
} from './helpers/journey';

const VIDEO_REVIEW = 'service_fee:video_review';

let s: Stack;
let admin: Client;
let collector: Collector;
let cashIn: string;
let cashOut: { id: string; code: string };
let card: { id: string; description: string };
let videoReviewBefore: { model: string; value: number; billingTrigger: string; description: string } | undefined;

beforeAll(async () => {
  s = await stack();
  admin = await signIn(SEED.admin, SEED_PASSWORD);
  const rules = (await admin.get('/pricing/rules')).body as {
    actionType: string;
    itemClass: string | null;
    model: string;
    value: number;
    billingTrigger: string;
    description: string;
    effectiveTo: string | null;
  }[];
  videoReviewBefore = rules.find((r) => r.actionType === VIDEO_REVIEW && r.itemClass === null && !r.effectiveTo);

  collector = await activeCollector('silver');
  cashIn = await fund(collector, 30_000);
  await fund(collector, 50_000);
  const operator = await signIn(SEED.operator);
  const [bin] = await binIds(operator);
  const ten = await operator.post('/intake/items', {
    ownerUsername: collector.username,
    typeClass: 'trading_card',
    binId: bin,
    quantity: 10,
    description: `Rayquaza commons for ${collector.username}`,
  });
  expect(ten.status, JSON.stringify(ten.body)).toBe(201);
  card = (ten.body as { id: string; description: string }[])[0]!;
  const tier = await collector.client.get('/tiers/me');
  expect(tier.body.tier).toBe('silver');

  const out = await collector.client.post('/finance/wallet-requests', {
    type: 'cash_out',
    amountMinor: 15_000,
    currency: 'USD',
    destinationAccount: 'IL62 0108 0000 0009 9999 999',
    beneficiaryName: 'Journey Silver',
    reference: `journey-out-${Date.now()}`,
  });
  expect(out.status, JSON.stringify(out.body)).toBe(201);
  cashOut = out.body;
});

afterAll(async () => {
  if (videoReviewBefore) {
    await admin.post('/pricing/rules', {
      actionType: VIDEO_REVIEW,
      description: videoReviewBefore.description,
      model: videoReviewBefore.model,
      value: videoReviewBefore.value,
      billingTrigger: videoReviewBefore.billingTrigger,
    });
  }
  await s?.close();
  await closeDb();
});

const cents = (text: string): number => {
  const m = /\$([\d,]+\.\d{2})/.exec(text);
  if (!m) throw new Error(`no dollar amount in "${text}"`);
  return Math.round(Number(m[1]!.replace(/,/g, '')) * 100);
};

async function monthlySummary(page: Page): Promise<{ reversedFees: number; reversedByPayer: number }> {
  await page.getByRole('tab', { name: 'Accounting' }).click();
  const month = new Date().toISOString().slice(0, 7);
  const form = panel(page, 'Monthly summary');
  await form.getByRole('textbox', { name: 'Month' }).fill(month);
  await pressAndSettle(page, form.getByRole('button', { name: 'Show summary' }), '/admin/accounting/summary');
  const summary = form.getByRole('region', { name: 'Monthly summary' });
  await says(summary, 'Card Embassy revenue');
  await says(summary, 'Customer balances held');
  const fees = summary.getByRole('term').filter({ hasText: /^Reversed-payment handling fees$/ });
  const reversedFees = cents((await fees.locator('xpath=following-sibling::dd[1]').textContent()) ?? '');
  const out = /reversed by the payer: (\$[\d,]+\.\d{2})/.exec((await summary.textContent()) ?? '');
  if (!out) throw new Error('the summary does not say what payers reversed');
  return { reversedFees, reversedByPayer: cents(out[1]!) };
}

async function standing(page: Page): Promise<{ charges: number; spent: number }> {
  await page.getByRole('button', { name: 'Your tier', exact: true }).click();
  await shows(page.getByRole('heading', { name: 'You are Silver' }));
  await says(page.getByRole('main'), 'Every price you are shown is already 10% under the list price.');
  const value = async (label: RegExp) =>
    (await page.getByRole('term').filter({ hasText: label }).locator('xpath=following-sibling::dd[1]').textContent()) ?? '';
  return {
    charges: Number(await value(/^Charges in the last 90 days$/)),
    spent: cents(await value(/^Spent in the last 90 days$/)),
  };
}

describe('journey: an administrator, from the payout desk to the price list', () => {
  it('approves a cash-out, records a chargeback, reads the month, changes a price, and the collector sees it', async () => {
    const page = await openPage(s, 'administrator');
    await signInAs(page, SEED_USERNAME.admin);
    await page.getByRole('button', { name: 'Management', exact: true }).click();

    await page.getByRole('tab', { name: 'Wallet requests' }).click();
    const request = page.getByRole('row', { name: new RegExp(cashOut.code) });
    await says(request, '$150.00');
    await says(request, 'Submitted');
    await request.getByRole('button', { name: cashOut.code }).click();
    const drawer = page.getByRole('dialog', { name: cashOut.code });
    await says(drawer, 'Journey Silver');
    await drawer.getByRole('button', { name: 'Approve' }).click();
    await says(drawer.getByRole('status'), `Request ${cashOut.code}: Approved.`);
    await says(drawer, 'Approved, not yet carried out.');
    await says(request, 'Approved');
    await drawer.getByRole('button', { name: 'Close' }).first().click();

    const before = await monthlySummary(page);
    const recall = await page.request.post(`/api/v1/finance/chargebacks/wallet-requests/${cashIn}`, {
      data: { reason: 'The bank recalled the transfer.', providerCaseRef: `CASE-${collector.username}` },
    });
    expect(recall.status(), await recall.text()).toBe(201);
    const after = await monthlySummary(page);
    expect(after.reversedFees - before.reversedFees).toBe(2_500);
    expect(after.reversedByPayer - before.reversedByPayer).toBe(30_000);

    await page.getByRole('tab', { name: 'Pricing' }).click();
    const newRule = panel(page, 'New rule');
    await newRule.getByRole('textbox', { name: 'Description' }).fill('A short video of the card turned under a light');
    await newRule.getByRole('combobox', { name: 'Action', exact: true }).selectOption(VIDEO_REVIEW);
    await newRule.getByRole('combobox', { name: 'Model' }).selectOption({ label: 'Flat amount' });
    await newRule.getByRole('textbox', { name: 'Flat amount' }).fill('12.00');
    await newRule.getByRole('combobox', { name: 'Billing' }).selectOption({ label: 'Per event' });
    await says(newRule.getByRole('region', { name: 'New rule' }), '$12.00');
    await newRule.getByRole('button', { name: 'Add rule' }).click();
    await shows(page.getByText('Pricing rule added. It is listed under Pricing rules below and is charged from now on.'));
    await signOut(page);

    await signInAs(page, collector.email, PASSWORD);
    await shows(page.getByRole('heading', { name: 'My vault', level: 1 }));
    await page.getByRole('button', { name: 'Wallet', exact: true }).click();
    await shows(page.getByRole('row', { name: /^Chargeback/ }));
    const was = await standing(page);

    await page.getByRole('button', { name: 'Vault', exact: true }).click();
    await page.getByRole('listitem').filter({ hasText: card.description }).first().getByRole('button').first().click();
    const item = page.getByRole('dialog');
    const video = item.getByRole('button', { name: 'Video review' });
    await says(video, 'Silver price $10.80');
    await says(video, '$12.00');
    await video.click();
    await shows(page.getByText('Video request sent. The warehouse films it next; follow it under Shipping & Services, Service requests.'));

    const now = await standing(page);
    expect(now.charges).toBe(was.charges + 1);
    expect(now.spent).toBe(was.spent + 1_080);
    await signOut(page);
  });
});
