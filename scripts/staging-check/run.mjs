import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

export class CheckFailure extends Error {}

export class Client {
  cookie = '';

  constructor(base) {
    this.base = base;
  }

  async request(method, path, body, headers = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body: json };
  }

  get(path) {
    return this.request('GET', path);
  }

  post(path, body = {}, headers) {
    return this.request('POST', path, body, headers);
  }

  patch(path, body) {
    return this.request('PATCH', path, body);
  }
}

export function apiBaseOf(url) {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.origin}${path.endsWith('/api/v1') ? path : `${path}/api/v1`}`;
}

function hostOf(value) {
  const text = String(value).trim();
  return new URL(text.includes('://') ? text : `https://${text}`).hostname.toLowerCase();
}

export function assertStagingTarget(url, { target, productionHost, paypalReceiver } = {}) {
  if (target !== 'staging') {
    throw new Error(
      'Name the target with --target staging. The check creates accounts and moves test money, so it runs only where you have said it may.',
    );
  }
  if (!productionHost) {
    throw new Error(
      "Set BAULT_PRODUCTION_HOST (or pass --production-host) to production's host name, so the check can refuse to run there.",
    );
  }
  const host = new URL(url).hostname.toLowerCase();
  const production = hostOf(productionHost).replace(/^www\./, '');
  if (host === production || host === `www.${production}`) {
    throw new Error(`${host} is production. The staging check never runs there.`);
  }
  if (paypalReceiver !== undefined && !/@[^@\s]+\.example\.com$/i.test(String(paypalReceiver).trim())) {
    throw new Error(
      'The PayPal receiver has to be a PayPal sandbox account, whose address ends in .example.com (for example sb-…@personal.example.com). Find it under Sandbox accounts in the PayPal developer dashboard.',
    );
  }
  return apiBaseOf(url);
}

export function tokenOf(answer) {
  const text = String(answer ?? '').trim();
  const m = text.match(/[?&]token=([^&\s]+)/);
  return m ? decodeURIComponent(m[1]) : text;
}

function answer(res) {
  const err = res.body?.error;
  return [res.status, err?.code, err?.message].filter(Boolean).join(' ');
}

function ok(res, what, statuses = [200, 201]) {
  if (!statuses.includes(res.status)) throw new CheckFailure(`${what} answered ${answer(res)}`);
  return res.body;
}

function must(condition, message) {
  if (!condition) throw new CheckFailure(message);
}

const money = (minor) => `$${(minor / 100).toFixed(2)}`;

export const CHECKS = [
  ['api', 'The API answers and reaches its database'],
  ['worker', 'The worker is dispatching the outbox'],
  ['admin', 'The admin signs in with two-factor'],
  ['prices', 'Every billable action has a price'],
  ['bins', 'The warehouse has a bin to stow into'],
  ['signup', 'Sign up and verify the email'],
  ['reset', 'Reset the password from the emailed link'],
  ['accounts', 'Two collector accounts, activated by the admin'],
  ['cash-in', 'A cash-in request, approved and completed'],
  ['intake', 'Intake a card for the seller'],
  ['listing', 'List it, and the listing names its seller'],
  ['purchase', 'Buy it: money and ownership move together'],
  ['label-domestic', 'Ship it with a test label (domestic)'],
  ['label-international', 'An international label, with customs'],
  ['unrateable', "An address the carrier can't rate shows its reason"],
  ['escrow', 'Escrow from proposal to settlement'],
  ['cash-out', 'A cash-out is paid and its webhook applied'],
  ['payout-retry', 'Completing the same cash-out again pays nothing'],
  ['webhook-forged', 'A webhook that fails verification is refused'],
  ['payout-reversal', 'A paid payout refunded in PayPal is credited back once'],
];

const TITLE = new Map(CHECKS);

const DEPENDS = {
  admin: ['api'],
  prices: ['admin'],
  bins: ['admin'],
  signup: ['api'],
  reset: ['signup'],
  accounts: ['admin'],
  'cash-in': ['accounts'],
  intake: ['accounts', 'bins'],
  listing: ['intake'],
  purchase: ['listing', 'cash-in'],
  'label-domestic': ['purchase'],
  'label-international': ['cash-in', 'bins'],
  unrateable: ['accounts'],
  escrow: ['cash-in', 'bins'],
  'cash-out': ['purchase'],
  'payout-retry': ['cash-out'],
  'webhook-forged': ['api'],
  'payout-reversal': ['cash-out'],
};

const ADDRESSES = {
  domestic: { label: 'Staging check, home', recipient: 'Staging Check', line1: '417 Montgomery St', city: 'San Francisco', region: 'CA', country: 'US', postalCode: '94104' },
  international: { label: 'Staging check, abroad', recipient: 'Staging Check', line1: '290 Bremner Blvd', city: 'Toronto', region: 'ON', country: 'CA', postalCode: 'M5V 3L9' },
  unrateable: { label: 'Staging check, nowhere', recipient: 'Staging Check', line1: '1 Nowhere Rd', city: 'Nowhere', region: 'NY', country: 'US', postalCode: '00000' },
};

const FUNDING_MINOR = 150_000;
const LISTING_PRICE_MINOR = 2_500;
const CASH_OUT_MINOR = 2_500;

export async function runStagingCheck(options) {
  const opts = {
    providers: 'live',
    pollMs: 3_000,
    webhookWaitMs: 300_000,
    log: () => {},
    manual: async () => null,
    ...options,
  };
  const live = opts.providers === 'live';
  const skip = new Set(opts.skip ?? []);
  const stamp = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const results = [];
  const passed = new Set();
  const state = {};

  const record = (id, status, detail = '') => {
    results.push({ id, title: TITLE.get(id) ?? id, status, detail });
    if (status === 'pass') passed.add(id);
    opts.log({ id, title: TITLE.get(id) ?? id, status, detail });
  };

  const step = async (id, fn) => {
    if (skip.has(id)) return record(id, 'skip', 'skipped with --skip');
    const missing = (DEPENDS[id] ?? []).filter((d) => !passed.has(d));
    if (missing.length > 0) return record(id, 'skip', `needs ${missing.join(', ')} to pass first`);
    try {
      const out = await fn();
      record(id, out?.status ?? 'pass', out?.detail ?? '');
    } catch (err) {
      record(id, 'fail', err instanceof CheckFailure ? err.message : `${err?.name ?? 'Error'}: ${err?.message ?? err}`);
    }
  };

  const anonymous = () => new Client(opts.apiBase);

  const until = async (probe, waitMs) => {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const value = await probe();
      if (value) return value;
      if (Date.now() > deadline) return null;
      await sleep(opts.pollMs);
    }
  };

  const balance = async (c) => ok(await c.get('/finance/wallet'), 'GET /finance/wallet').amount;

  const signIn = async (identifier, password) => {
    const c = anonymous();
    const body = ok(await c.post('/auth/login', { identifier, password }), `signing in as ${identifier}`, [200]);
    must(body.status !== 'mfa_required', `${identifier} stopped at the second factor`);
    must(c.cookie, `signing in as ${identifier} opened no session`);
    return c;
  };

  const termsVersion = async () => {
    const res = await anonymous().post('/auth/register', {
      email: opts.inbox('probe'),
      username: `chk${stamp}probe`,
      firstName: 'Staging',
      lastName: 'Check',
      password: randomBytes(12).toString('base64url'),
      acceptedTermsVersion: 'staging-check-probe',
    });
    const version = res.body?.error?.details?.currentVersion;
    must(typeof version === 'string', `could not learn the terms version: the probe answered ${answer(res)}`);
    return version;
  };

  const register = async (label) => {
    state.terms ??= await termsVersion();
    const account = {
      label,
      email: opts.inbox(label),
      username: `chk${stamp}${label}`.slice(0, 32),
      password: randomBytes(15).toString('base64url'),
    };
    const body = ok(
      await anonymous().post('/auth/register', {
        email: account.email,
        username: account.username,
        firstName: 'Staging',
        lastName: 'Check',
        password: account.password,
        acceptedTermsVersion: state.terms,
      }),
      `registering ${account.username}`,
      [201],
    );
    must(body.status === 'pending_verification', `a new account should wait for its email, it is ${body.status}`);
    return account;
  };

  const activate = async (account) => {
    const users = ok(await state.admin.get('/admin/users'), 'GET /admin/users', [200]);
    const row = users.find((u) => u.username === account.username);
    must(row, `${account.username} is not in the admin's user list`);
    ok(await state.admin.patch(`/admin/users/${row.id}`, { status: 'active' }), `activating ${account.username}`, [200]);
    account.id = row.id;
    account.client = await signIn(account.username, account.password);
    return account;
  };

  const emailed = async (kind, email) => {
    const given = await opts.link(kind, email);
    if (given === null || given === undefined || String(given).trim() === '') return null;
    return tokenOf(given);
  };

  const intake = async (owner, description, typeClass = 'trading_card') =>
    ok(
      await state.admin.post('/intake/items', {
        ownerUsername: owner.username,
        typeClass,
        binId: state.binId,
        description,
      }),
      'intake',
      [201],
    );

  const ship = async (owner, item, where, extra = {}) => {
    const address = ok(await owner.client.post('/me/addresses', ADDRESSES[where]), `saving the ${where} address`, [201]);
    const shipment = ok(
      await owner.client.post('/shipping/shipments', { itemIds: [item.id], addressId: address.id, ...extra }),
      'creating the shipment',
      [201],
    );
    const rates = ok(await owner.client.get(`/shipping/shipments/${shipment.id}/rates`), 'GET rates', [200]);
    const pick = rates.find((r) => r.eligible !== false);
    must(pick, `no eligible rate for the ${where} parcel: ${rates.map((r) => `${r.carrier} ${r.serviceLevel}`).join(', ') || 'none at all'}`);
    const selected = ok(
      await owner.client.post(`/shipping/shipments/${shipment.id}/select-rate`, { carrier: pick.carrier, serviceLevel: pick.serviceLevel }),
      'selecting the rate',
      [201],
    );
    if (selected.status === 'awaiting_payment') {
      ok(await owner.client.post(`/shipping/shipments/${shipment.id}/pay`), 'paying for the shipment', [200, 201]);
    }
    const dispatched = ok(
      await state.admin.post(`/shipping/shipments/${shipment.id}/dispatch`, {
        scannedItemIds: [item.barcode],
        carrier: pick.carrier,
        packageWeightGrams: 220,
        fulfillmentNotes: 'Staging check: top-loader in a rigid mailer.',
      }),
      'dispatching (buying the label)',
      [201],
    );
    must(dispatched.trackingNumber, 'the dispatch bought no label: no tracking number came back');
    if (live) {
      must(
        !String(dispatched.trackingNumber).startsWith('SBX'),
        `the label came from the sandbox adapter (${dispatched.trackingNumber}): set SHIPPING_PROVIDER=easypost on staging`,
      );
    }
    const after = ok(await owner.client.get(`/shipping/shipments/${shipment.id}`), 'GET the shipment', [200]);
    must(['shipped', 'in_transit', 'delivered'].includes(after.status), `the shipment is ${after.status} after dispatch`);
    return { shipment, pick, rates, trackingNumber: dispatched.trackingNumber };
  };

  await step('api', async () => {
    const body = ok(await anonymous().get('/readyz'), 'GET /readyz', [200]);
    must(body.db === true, 'the API is up but cannot reach its database');
  });

  await step('worker', async () => {
    const res = await anonymous().get('/readyz/worker');
    must(
      res.status === 200,
      `the worker has not dispatched the outbox in the last five minutes (${answer(res)}): no email or notification goes out until it does`,
    );
  });

  const staffSignIn = async ({ identifier, password }, code) => {
    const c = anonymous();
    const first = ok(await c.post('/auth/login', { identifier, password }), `signing in as ${identifier}`, [200]);
    let session = first;
    if (first.status === 'mfa_required') {
      session = ok(
        await c.post('/auth/login/mfa', { challengeToken: first.challengeToken, code: String(await code()).trim() }),
        `the second factor for ${identifier}`,
        [200],
      );
    }
    must(session.role === 'admin', `${identifier} signed in as ${session.role}, not admin`);
    must(!session.mfaEnrollmentRequired, `${identifier} has no second factor yet: enrol it on the profile page first`);
    return { client: c, id: session.id, challenged: first.status === 'mfa_required' };
  };

  const completer = async (requestId) => {
    const res = await state.admin.post(`/admin/wallet-requests/${requestId}/complete`, {});
    if (res.status !== 403) return { res, by: state.admin };
    if (!opts.secondAdmin) {
      throw new CheckFailure(`completing it answered ${answer(res)}: pass --second-admin for the administrator who completes cash-outs`);
    }
    state.second ??= (await staffSignIn(opts.secondAdmin, opts.secondTotp)).client;
    return { res: await state.second.post(`/admin/wallet-requests/${requestId}/complete`, {}), by: state.second };
  };

  await step('admin', async () => {
    const signed = await staffSignIn(opts.admin, opts.totp);
    state.admin = signed.client;
    return { detail: signed.challenged ? 'with the code from the authenticator' : 'no second factor is required here' };
  });

  await step('prices', async () => {
    const cov = ok(await state.admin.get('/admin/pricing/coverage'), 'GET /admin/pricing/coverage', [200]);
    if (cov.ready) return { detail: `${cov.summary.priced} priced, ${cov.summary.codeConstant} fixed in code` };
    const open = cov.actions.filter((a) => a.status !== 'priced' && a.status !== 'code_constant');
    throw new CheckFailure(
      `${open.length} without a price: ${open.slice(0, 6).map((a) => `${a.actionType} (${a.status})`).join(', ')}${open.length > 6 ? ', …' : ''}. Load them in /admin/pricing/coverage first`,
    );
  });

  await step('bins', async () => {
    const bins = ok(await state.admin.get('/custody/bins'), 'GET /custody/bins', [200]);
    must(bins.length > 0, 'no bins: create the facility and at least one bin in the console first');
    state.binId = bins[0].id;
    return { detail: `${bins.length} bin${bins.length === 1 ? '' : 's'}` };
  });

  await step('signup', async () => {
    const account = await register('signup');
    const token = await emailed('verify', account.email);
    if (!token) return { status: 'manual', detail: `no link given: verify ${account.email} by hand` };
    ok(await anonymous().post('/auth/verify-email', { token }), 'verifying the email', [200]);
    const c = await signIn(account.username, account.password);
    const me = ok(await c.get('/me/profile'), 'GET /me/profile', [200]);
    must(me.username === account.username, `signed in as ${me.username}, expected ${account.username}`);
    state.signup = account;
    return { detail: account.email };
  });

  await step('reset', async () => {
    const account = state.signup;
    ok(await anonymous().post('/auth/password/reset-request', { email: account.email }), 'asking for a reset link', [202]);
    const token = await emailed('reset', account.email);
    if (!token) return { status: 'manual', detail: `no link given: reset ${account.email} by hand` };
    const fresh = randomBytes(15).toString('base64url');
    ok(await anonymous().post('/auth/password/reset', { token, newPassword: fresh }), 'resetting the password', [200]);
    await signIn(account.username, fresh);
    const old = await anonymous().post('/auth/login', { identifier: account.username, password: account.password });
    must(old.status === 401, `the old password still answers ${answer(old)}`);
  });

  await step('accounts', async () => {
    state.seller = await activate(await register('seller'));
    state.buyer = await activate(await register('buyer'));
    return { detail: `${state.seller.username}, ${state.buyer.username}` };
  });

  await step('cash-in', async () => {
    const buyer = state.buyer;
    const before = await balance(buyer.client);
    const request = ok(
      await buyer.client.post('/finance/wallet-requests', {
        type: 'cash_in',
        amountMinor: FUNDING_MINOR,
        currency: 'USD',
        fundingSource: 'bank_transfer',
        reference: `staging-check-${stamp}`,
      }),
      'the cash-in request',
      [201],
    );
    ok(await state.admin.post(`/admin/wallet-requests/${request.id}/approve`, {}), 'approving the cash-in', [201]);
    const done = ok((await completer(request.id)).res, 'completing the cash-in', [201]);
    must(done.status === 'completed', `the cash-in is ${done.status}, not completed`);
    const after = await balance(buyer.client);
    must(after === before + FUNDING_MINOR, `the wallet moved by ${money(after - before)}, expected ${money(FUNDING_MINOR)}`);
    return { detail: `${money(FUNDING_MINOR)} credited` };
  });

  await step('intake', async () => {
    state.card = await intake(state.seller, `Staging check card ${stamp}`);
    must(state.card.barcode, 'the intake answered with no barcode');
    return { detail: state.card.barcode };
  });

  await step('listing', async () => {
    const listing = ok(
      await state.seller.client.post('/marketplace/listings', { itemId: state.card.id, askingPrice: LISTING_PRICE_MINOR }),
      'creating the listing',
      [201],
    );
    state.listing = listing;
    const shown = ok(await state.buyer.client.get(`/marketplace/listings/${listing.id}`), 'GET the listing', [200]);
    must(shown.sellerUsername === state.seller.username, `the listing names ${shown.sellerUsername ?? 'no seller'}, expected ${state.seller.username}`);
    return { detail: `${money(LISTING_PRICE_MINOR)} by @${shown.sellerUsername}` };
  });

  await step('purchase', async () => {
    const buyer = state.buyer;
    const before = await balance(buyer.client);
    const sold = ok(await buyer.client.post(`/marketplace/listings/${state.listing.id}/purchase`), 'the purchase', [201]);
    must(sold.price === LISTING_PRICE_MINOR, `the sale recorded ${money(sold.price)}, expected ${money(LISTING_PRICE_MINOR)}`);
    const after = await balance(buyer.client);
    must(before - after === LISTING_PRICE_MINOR, `the buyer paid ${money(before - after)}, expected ${money(LISTING_PRICE_MINOR)}`);
    const vault = ok(await buyer.client.get('/vault/items'), 'GET /vault/items', [200]);
    must(vault.some((i) => i.id === state.card.id), 'the card is not in the buyer’s vault');
  });

  await step('label-domestic', async () => {
    const shipped = await ship(state.buyer, state.card, 'domestic');
    return { detail: `${shipped.pick.carrier} ${shipped.pick.serviceLevel}, ${shipped.trackingNumber}` };
  });

  await step('label-international', async () => {
    const card = await intake(state.buyer, `Staging check card abroad ${stamp}`);
    const shipped = await ship(state.buyer, card, 'international', { declaredValueMinor: 2_500 });
    const readiness = ok(
      await state.buyer.client.get(`/shipping/shipments/${shipped.shipment.id}/customs/readiness`),
      'GET customs readiness',
      [200],
    );
    must(readiness.international === true, 'the parcel to Canada was not treated as international');
    const offered = shipped.rates.map((r) => `${r.carrier} ${r.serviceLevel}`).join(', ');
    return { detail: `${shipped.pick.carrier} ${shipped.pick.serviceLevel}, ${shipped.trackingNumber}; offered: ${offered}` };
  });

  await step('unrateable', async () => {
    if (!live) return { status: 'skip', detail: 'needs live sandbox keys (EasyPost)' };
    const card = await intake(state.buyer, `Staging check unrateable ${stamp}`);
    const address = ok(await state.buyer.client.post('/me/addresses', ADDRESSES.unrateable), 'saving the address', [201]);
    const res = await state.buyer.client.post('/shipping/quote', { itemIds: [card.id], addressId: address.id });
    if (res.status === 200 || res.status === 201) {
      const eligible = (res.body?.rates ?? []).filter((r) => r.eligible !== false);
      if (eligible.length === 0) return { detail: 'no eligible rate, as expected' };
      return { status: 'manual', detail: `EasyPost rated ZIP 00000 (${eligible.length} rates): try an address it refuses by hand` };
    }
    must(res.body?.error?.code === 'provider_rejected', `expected provider_rejected with the carrier's reason, got ${answer(res)}`);
    must(String(res.body.error.message ?? '').length > 0, 'the refusal carries no reason');
    return { detail: res.body.error.message };
  });

  await step('escrow', async () => {
    const { seller, buyer } = state;
    const terms = ok(await buyer.client.get('/escrow/terms'), 'GET /escrow/terms', [200]);
    const value = terms.minimumValueMinor;
    const deal = ok(
      await seller.client.post('/escrow', {
        raiserRole: 'seller',
        counterpartyUsername: buyer.username,
        description: `Staging check slab ${stamp}`,
        valueMinor: value,
        settlement: 'buyer_vault',
      }),
      'proposing the deal',
      [201],
    );
    ok(await buyer.client.post(`/escrow/${deal.id}/agree`, {}), 'the buyer agreeing', [201]);
    const buyerBefore = await balance(buyer.client);
    ok(await buyer.client.post(`/escrow/${deal.id}/fund`, {}), 'funding the deal', [201]);
    must((await balance(buyer.client)) === buyerBefore - value, 'funding did not hold exactly the deal value');
    const slab = await intake(seller, `Staging check escrow slab ${stamp}`, 'graded_slab');
    ok(await state.admin.post(`/escrow/${deal.id}/receive-item`, { itemId: slab.id }), 'receiving the card', [201]);
    ok(
      await state.admin.post(`/escrow/${deal.id}/inspect`, { matches: true, notes: 'Staging check: matches the description.' }),
      'inspecting the card',
      [201],
    );
    ok(await buyer.client.post(`/escrow/${deal.id}/release`, {}), 'the buyer releasing', [201]);
    const sellerBefore = await balance(seller.client);
    const settled = ok(await seller.client.post(`/escrow/${deal.id}/release`, {}), 'the seller releasing', [201]);
    must(settled.status === 'settled', `the deal is ${settled.status}, not settled`);
    const paid = (await balance(seller.client)) - sellerBefore;
    must(paid === value - deal.feeMinor, `the seller received ${money(paid)}, expected ${money(value - deal.feeMinor)}`);
    return { detail: `${deal.code}: ${money(value)}, fee ${money(deal.feeMinor)}` };
  });

  await step('cash-out', async () => {
    const seller = state.seller;
    if (live && !opts.paypalReceiver) throw new CheckFailure('pass --paypal-receiver with a PayPal sandbox personal account');
    const destination = live ? opts.paypalReceiver : `chk+payout-pending@example.test`;
    const quote = ok(await seller.client.get(`/finance/cash-out-quote?amountMinor=${CASH_OUT_MINOR}`), 'the cash-out quote', [200]);
    const before = await balance(seller.client);
    const request = ok(
      await seller.client.post('/finance/wallet-requests', {
        type: 'cash_out',
        amountMinor: CASH_OUT_MINOR,
        currency: 'USD',
        destinationAccount: destination,
        beneficiaryName: 'Staging Check',
        reference: `staging-check-out-${stamp}`,
      }),
      'the cash-out request',
      [201],
    );
    state.cashOut = request.id;
    ok(await state.admin.post(`/admin/wallet-requests/${request.id}/approve`, {}), 'approving the cash-out', [201]);
    const completed = await completer(request.id);
    state.cashOutCompleter = completed.by;
    const done = ok(completed.res, 'completing the cash-out', [201]);
    const detail = async () => ok(await state.admin.get(`/admin/wallet-requests/${request.id}`), 'GET the cash-out', [200]);

    if (done.status === 'completed' && !(await detail()).payout) {
      return { status: 'manual', detail: 'PAYOUT_MODE=manual: nothing went to PayPal, so there is no webhook to check' };
    }
    must(done.status === 'paying' || done.status === 'completed', `the cash-out is ${done.status} after completing`);

    if (!live && done.status === 'paying') {
      const d = await detail();
      const res = await fetch(`${opts.apiBase}/webhooks/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: `WH-CHK-${stamp}`,
          type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED',
          data: {
            payout_batch_id: d.payout.externalRef,
            transaction_status: 'SUCCESS',
            payout_item: { sender_item_id: d.payout.providerRef },
          },
        }),
      });
      must(res.status === 201, `the sandbox webhook answered ${res.status}`);
    }

    const final = await until(async () => {
      const d = await detail();
      return d.status === 'completed' || d.status === 'payout_failed' ? d : null;
    }, opts.webhookWaitMs);
    must(final, `PayPal's webhook did not arrive within ${Math.round(opts.webhookWaitMs / 60_000)} minutes: check the webhook URL and PAYPAL_WEBHOOK_ID`);
    must(final.status === 'completed', `the payout failed (${final.payout?.status ?? 'no payout'}): check the receiver in the PayPal sandbox`);
    must(final.payout?.status === 'succeeded', `the payout is ${final.payout?.status}, not succeeded`);
    if (done.status === 'paying') must(final.payout?.webhookEventId, 'the cash-out completed without a webhook');
    const after = await balance(seller.client);
    must(before - after === quote.amountMinor, `the seller was debited ${money(before - after)}, quoted ${money(quote.amountMinor)}`);
    state.cashOutBalance = after;
    return { detail: `${money(quote.netMinor)} paid, fee ${money(quote.feeMinor)}${final.payout?.webhookEventId ? `, webhook ${final.payout.webhookEventId}` : ''}` };
  });

  await step('payout-retry', async () => {
    const again = await state.cashOutCompleter.post(`/admin/wallet-requests/${state.cashOut}/complete`, {});
    must(again.status === 409, `completing it again answered ${answer(again)}, expected 409`);
    if (live) await sleep(opts.pollMs);
    const ledger = ok(await state.seller.client.get('/finance/ledger'), 'GET /finance/ledger', [200]);
    const withdrawals = ledger.filter((r) => r.referenceId === state.cashOut && r.type === 'withdrawal');
    must(withdrawals.length === 1, `${withdrawals.length} withdrawals recorded for one cash-out`);
    must((await balance(state.seller.client)) === state.cashOutBalance, 'the balance moved after the retry');
  });

  await step('webhook-forged', async () => {
    const res = await fetch(`${opts.apiBase}/webhooks/payment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'paypal-transmission-id': randomBytes(16).toString('hex'),
        'paypal-transmission-time': new Date().toISOString(),
        'paypal-transmission-sig': 'invalid',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-staging-check',
        'paypal-auth-algo': 'SHA256withRSA',
      },
      body: JSON.stringify({ id: `WH-CHK-FORGED-${stamp}`, event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', data: {} }),
    });
    const body = await res.json().catch(() => null);
    must(res.status === 400, `a forged delivery answered ${res.status}, expected 400`);
    must(body?.error?.code === 'webhook_unverified', `a forged delivery was refused as ${body?.error?.code}, expected webhook_unverified`);
    return { detail: live ? 'refused; Sentry should show a WebhookVerificationError for it' : 'refused' };
  });

  await step('payout-reversal', async () => {
    if (!live) return { status: 'skip', detail: 'needs live sandbox keys (PayPal)' };
    const confirmed = await opts.manual(
      `In the PayPal sandbox, refund the payout to ${opts.paypalReceiver} (README, "Check staging"), then press Enter.`,
    );
    if (confirmed === null) return { status: 'skip', detail: 'by hand: run again with --manual, or follow the README' };
    const before = state.cashOutBalance;
    const final = await until(async () => {
      const d = ok(await state.admin.get(`/admin/wallet-requests/${state.cashOut}`), 'GET the cash-out', [200]);
      return d.status === 'payout_failed' ? d : null;
    }, opts.webhookWaitMs);
    must(final, 'no reversal arrived from PayPal within the wait');
    const ledger = ok(await state.seller.client.get('/finance/ledger'), 'GET /finance/ledger', [200]);
    const reversals = ledger.filter((r) => r.referenceId === state.cashOut && r.type === 'payout_reversal');
    must(reversals.length === 1, `${reversals.length} reversals recorded, expected one`);
    const after = await balance(state.seller.client);
    must(after - before === reversals[0].amount, `the wallet moved by ${money(after - before)}, the reversal says ${money(reversals[0].amount)}`);
    return { detail: `${money(reversals[0].amount)} credited back once` };
  });

  return results;
}
