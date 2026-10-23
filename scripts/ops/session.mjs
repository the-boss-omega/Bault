import { createInterface } from 'node:readline';

export function argValue(argv, name) {
  const i = argv.indexOf(name);
  if (i !== -1) return argv[i + 1];
  const prefix = `${name}=`;
  const inline = argv.find((a) => a.startsWith(prefix));
  return inline === undefined ? undefined : inline.slice(prefix.length);
}

export function hasFlag(argv, name) {
  return argv.includes(name);
}

export function apiBase(url) {
  if (!url) throw new Error('Give the site with --url, for example --url https://staging.example.com');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`--url ${url} is not a URL. Give the site's address, for example https://staging.example.com`);
  }
  return `${parsed.origin}/api/v1`;
}

export function prompt(question, { hidden = false } = {}) {
  if (!process.stdin.isTTY) {
    return Promise.reject(
      new Error(`"${question.replace(/:\s*$/, '')}" is needed. Set it in the environment, or run this in a terminal.`),
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    rl._writeToOutput = (text) => {
      if (text.startsWith(question)) process.stdout.write(question);
    };
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

export class Session {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  get signedIn() {
    return this.cookies.size > 0;
  }

  async request(method, path, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookies.size > 0) {
      headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '' || /max-age=0|expires=thu, 01 jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
    }
    return { status: res.status, body: json, text };
  }

  get(path) {
    return this.request('GET', path);
  }

  post(path, body) {
    return this.request('POST', path, body ?? {});
  }
}

function refusal(res) {
  const message = res.body?.message ?? res.body?.error?.message ?? res.text?.slice(0, 200) ?? '';
  return `${res.status}${message ? `: ${message}` : ''}`;
}

export async function credentials(env, ask, who) {
  const identifier = env[`BAULT_${who}_IDENTIFIER`] || (await ask(`${who === 'ADMIN' ? 'Admin' : 'Account'} e-mail or username: `));
  const password = env[`BAULT_${who}_PASSWORD`] || (await ask('Password: ', { hidden: true }));
  if (!identifier || !password) throw new Error('An e-mail or username and a password are both needed.');
  return { identifier, password };
}

export async function signInAdmin(base, { env = process.env, ask = prompt } = {}) {
  const { identifier, password } = await credentials(env, ask, 'ADMIN');
  const session = new Session(base);
  let res = await session.post('/auth/login', { identifier, password });
  if (res.status !== 200) throw new Error(`Sign-in refused (${refusal(res)}).`);
  if (res.body?.status === 'mfa_required') {
    const code = env.BAULT_ADMIN_TOTP || (await ask('Code from your authenticator app: '));
    res = await session.post('/auth/login/mfa', { challengeToken: res.body.challengeToken, code });
    if (res.status !== 200) throw new Error(`The two-factor code was refused (${refusal(res)}).`);
  }
  if (!session.signedIn) throw new Error('Sign-in answered but opened no session.');
  if (res.body?.role !== 'admin') throw new Error(`That account is not an administrator (its role is ${res.body?.role}).`);
  if (res.body?.mfaEnrollmentRequired) {
    throw new Error('This administrator has not enrolled two-factor yet. Sign in to the console, enrol, then run this again.');
  }
  return session;
}
