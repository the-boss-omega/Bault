#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { assertStagingTarget, runStagingCheck } from './staging-check/run.mjs';

const USAGE = `Walks the launch plan's staging journeys and provider checks against a running staging.

  pnpm staging:check --url https://staging.example.com --target staging \\
    --admin you@example.com --email you@example.com \\
    --paypal-receiver sb-…@personal.example.com [--manual]

  --url              staging's address (or BAULT_STAGING_URL)
  --target staging   required: the check creates accounts and moves test money
  --production-host  production's host name, which the check refuses (or BAULT_PRODUCTION_HOST)
  --admin            the admin's email or username (or BAULT_ADMIN); the password is asked
                     for, or read from BAULT_ADMIN_PASSWORD, and never printed
  --second-admin     the administrator who completes cash-outs, if completing needs a second
                     person (or BAULT_SECOND_ADMIN; password BAULT_SECOND_ADMIN_PASSWORD or asked)
  --email            your inbox; test accounts use you+chk-…@ addresses (or BAULT_CHECK_EMAIL)
  --paypal-receiver  a PayPal sandbox personal account for the cash-out (or BAULT_PAYPAL_RECEIVER)
  --manual           also run the steps that need you in a provider's dashboard
  --providers        live (default) or sandbox, for a local API on the sandbox adapters
  --skip a,b         leave out checks by id
  --webhook-wait N   minutes to wait for PayPal's webhooks (default 5)`;

const BY_HAND = [
  "The verify and reset emails landed in the inbox, not in spam.",
  'Sentry shows the refused webhook the check sent (a WebhookVerificationError).',
  "A refused label: the operator re-rates it from the shipment drawer (it can't be forced from outside).",
  'A delivered parcel sends its notification: watch a test label in EasyPost until it reads delivered.',
  'The requeue drill: stop SMTP, let a message park, restore SMTP, requeue it from the console, see it arrive.',
];

function parseArgs(argv) {
  const out = { skip: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return v;
    };
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--manual') out.manual = true;
    else if (arg === '--url' || arg === '--base-url') out.baseUrl = value();
    else if (arg === '--target') out.target = value();
    else if (arg === '--production-host') out.productionHost = value();
    else if (arg === '--admin') out.admin = value();
    else if (arg === '--second-admin') out.secondAdmin = value();
    else if (arg === '--email') out.email = value();
    else if (arg === '--paypal-receiver') out.paypalReceiver = value();
    else if (arg === '--providers') out.providers = value();
    else if (arg === '--skip') out.skip = value().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--webhook-wait') out.webhookWait = Number(value());
    else throw new Error(`Unknown option ${arg}. Run with --help.`);
  }
  return out;
}

async function ask(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY) throw new Error(`"${question.trim()}" needs an answer, and stdin is not a terminal`);
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const pending = rl.question(question);
  muted = hidden;
  try {
    return (await pending).trim();
  } finally {
    rl.close();
    if (hidden) process.stdout.write('\n');
  }
}

function plusAddress(email, tag) {
  const at = email.lastIndexOf('@');
  if (at < 1) throw new Error(`${email} is not an email address`);
  return `${email.slice(0, at)}+${tag}${email.slice(at)}`;
}

const LABEL = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP', manual: 'BY HAND' };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const env = process.env;
  const baseUrl = args.baseUrl ?? env.BAULT_STAGING_URL;
  if (!baseUrl) throw new Error('Pass --url (or set BAULT_STAGING_URL). Run with --help.');
  const providers = args.providers ?? 'live';
  if (!['live', 'sandbox'].includes(providers)) throw new Error('--providers is live or sandbox');
  const paypalReceiver = args.paypalReceiver ?? env.BAULT_PAYPAL_RECEIVER;
  const apiBase = assertStagingTarget(baseUrl, {
    target: args.target,
    productionHost: args.productionHost ?? env.BAULT_PRODUCTION_HOST,
    paypalReceiver: providers === 'live' && paypalReceiver ? paypalReceiver : undefined,
  });
  if (providers === 'live' && !paypalReceiver) {
    throw new Error('Pass --paypal-receiver (or set BAULT_PAYPAL_RECEIVER) with a PayPal sandbox personal account.');
  }
  const host = new URL(apiBase).hostname;

  const typed = await ask(`This creates test accounts and moves test money on ${host}. Type the host name to go on: `);
  if (typed.toLowerCase() !== host) throw new Error('The host name did not match. Nothing was done.');

  const identifier = args.admin ?? env.BAULT_ADMIN ?? (await ask('Admin email or username: '));
  const password = env.BAULT_ADMIN_PASSWORD ?? (await ask('Admin password (not shown): ', { hidden: true }));
  const inboxEmail = args.email ?? env.BAULT_CHECK_EMAIL ?? (await ask('Your inbox, for the test accounts: '));
  const second = args.secondAdmin ?? env.BAULT_SECOND_ADMIN;
  const secondAdmin = second
    ? {
        identifier: second,
        password: env.BAULT_SECOND_ADMIN_PASSWORD ?? (await ask(`Password for ${second} (not shown): `, { hidden: true })),
      }
    : undefined;
  const run = Date.now().toString(36);

  console.log('');
  const results = await runStagingCheck({
    apiBase,
    providers,
    admin: { identifier, password },
    paypalReceiver,
    skip: args.skip,
    webhookWaitMs: (Number.isFinite(args.webhookWait) && args.webhookWait > 0 ? args.webhookWait : 5) * 60_000,
    totp: () => ask('Code from your authenticator app: '),
    secondAdmin,
    secondTotp: () => ask(`Code from ${second}'s authenticator app: `),
    inbox: (label) => plusAddress(inboxEmail, `chk-${run}-${label}`),
    link: (kind, email) =>
      ask(`Paste the ${kind === 'verify' ? 'verification' : 'password reset'} link sent to ${email} (Enter to do it by hand): `).then(
        (v) => v || null,
      ),
    manual: args.manual
      ? (instruction) => ask(`${instruction} (type skip to leave it) `).then((v) => (v.toLowerCase() === 'skip' ? null : true))
      : async () => null,
    log: (r) => console.log(`  ${LABEL[r.status].padEnd(8)}${r.title}${r.detail ? ` — ${r.detail}` : ''}`),
  });

  const count = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped, ${count('manual')} by hand.`);
  console.log('\nStill by hand (README, "Check staging"):');
  for (const line of BY_HAND) console.log(`  - ${line}`);
  return count('fail') > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.message);
    process.exit(2);
  },
);
