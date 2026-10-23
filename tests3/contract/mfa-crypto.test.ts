import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  matchTotp,
  otpauthUri,
  timeStep,
  totp,
} from '../../apps/api/src/modules/acc/mfa/totp';
import { UnreadableSecretError, deriveSubkey, openSecret, sealSecret } from '../../apps/api/src/modules/acc/mfa/secret-box';
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from '../../apps/api/src/modules/acc/mfa/recovery-codes';

const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('HOTP (RFC 4226, Appendix D)', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  it.each(expected.map((code, counter) => [counter, code]))('counter %i gives %s', (counter, code) => {
    expect(hotp(RFC_SECRET, counter as number)).toBe(code);
  });
});

describe('TOTP (RFC 6238, Appendix B, SHA-1)', () => {
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];

  it.each(vectors)('at T=%i the 8-digit code is %s', (seconds, code) => {
    expect(totp(RFC_SECRET, seconds * 1000, 8)).toBe(code);
  });

  it.each(vectors)('at T=%i the 6-digit code is the last six digits', (seconds, code) => {
    expect(totp(RFC_SECRET, seconds * 1000)).toBe(code.slice(-6));
  });

  it('steps every thirty seconds', () => {
    expect(timeStep(59_000)).toBe(1);
    expect(timeStep(60_000)).toBe(2);
    expect(timeStep(1111111109_000)).toBe(37037036);
  });
});

describe('accepting a code', () => {
  const secret = generateTotpSecret();
  const now = Date.UTC(2026, 9, 15, 12, 0, 10);
  const step = timeStep(now);
  const at = (s: number) => totp(secret, s * 30_000);

  it('makes a 20-byte secret, as RFC 4226 recommends for SHA-1', () => {
    expect(secret).toHaveLength(20);
    expect(generateTotpSecret().equals(secret)).toBe(false);
  });

  it('accepts the current step and one either side, and says which step matched', () => {
    expect(matchTotp(secret, at(step), now)).toBe(step);
    expect(matchTotp(secret, at(step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, at(step + 1), now)).toBe(step + 1);
  });

  it('refuses a code two steps away', () => {
    const window = [at(step - 1), at(step), at(step + 1)];
    for (const far of [at(step - 2), at(step + 2)]) {
      if (!window.includes(far)) expect(matchTotp(secret, far, now)).toBeNull();
    }
  });

  it('refuses anything that is not six digits', () => {
    const code = at(step);
    for (const bad of ['', '12345', '1234567', 'abcdef', `${code} `, ` ${code}`, '12 345', '１２３４５６']) {
      expect(matchTotp(secret, bad, now)).toBeNull();
    }
  });
});

describe('base32 (RFC 4648 §10, unpadded)', () => {
  const vectors: [string, string][] = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];
  it.each(vectors)('"%s" encodes to "%s" and back', (plain, encoded) => {
    expect(base32Encode(Buffer.from(plain))).toBe(encoded);
    expect(base32Decode(encoded).toString()).toBe(plain);
  });

  it('reads what a person types: lower case, spaces, padding', () => {
    expect(base32Decode('mzxw 6ytb oi==').toString()).toBe('foobar');
  });

  it('refuses characters outside the alphabet', () => {
    expect(() => base32Decode('MZXW1')).toThrow();
  });

  it('round-trips a real secret', () => {
    const s = randomBytes(20);
    expect(base32Decode(base32Encode(s)).equals(s)).toBe(true);
  });
});

describe('the otpauth:// URI an authenticator scans', () => {
  it('names the issuer, the account and the parameters this server checks', () => {
    const secret = Buffer.from('12345678901234567890', 'ascii');
    const uri = new URL(otpauthUri({ issuer: 'Bault', account: 'eldar', secret }));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Bault:eldar');
    expect(uri.searchParams.get('secret')).toBe(base32Encode(secret));
    expect(uri.searchParams.get('issuer')).toBe('Bault');
    expect(uri.searchParams.get('algorithm')).toBe('SHA1');
    expect(uri.searchParams.get('digits')).toBe('6');
    expect(uri.searchParams.get('period')).toBe('30');
  });
});

describe('the secret at rest (AES-256-GCM)', () => {
  const key = randomBytes(32);
  const secret = randomBytes(20);

  it('opens what it sealed, for the same account', () => {
    const sealed = sealSecret(key, secret, 'user-1');
    expect(openSecret(key, sealed, 'user-1').equals(secret)).toBe(true);
  });

  it('never stores the same ciphertext twice, and never the secret itself', () => {
    const a = sealSecret(key, secret, 'user-1');
    const b = sealSecret(key, secret, 'user-1');
    expect(a).not.toBe(b);
    expect(a).not.toContain(secret.toString('base64url'));
    expect(a).not.toContain(base32Encode(secret));
  });

  it('refuses a ciphertext that was changed', () => {
    const sealed = sealSecret(key, secret, 'user-1');
    const parts = sealed.split('.');
    const body = Buffer.from(parts[3]!, 'base64url');
    body[0] = body[0]! ^ 1;
    parts[3] = body.toString('base64url');
    expect(() => openSecret(key, parts.join('.'), 'user-1')).toThrow();
  });

  it("refuses another account's ciphertext copied onto this one", () => {
    const sealed = sealSecret(key, secret, 'user-1');
    expect(() => openSecret(key, sealed, 'user-2')).toThrow();
  });

  it('refuses the wrong key', () => {
    const sealed = sealSecret(key, secret, 'user-1');
    expect(() => openSecret(randomBytes(32), sealed, 'user-1')).toThrow();
  });

  it('refuses every unreadable value with the one error the service maps to a clear answer', () => {
    const sealed = sealSecret(key, secret, 'user-1');
    expect(() => openSecret(randomBytes(32), sealed, 'user-1')).toThrow(UnreadableSecretError);
    expect(() => openSecret(key, sealed, 'user-2')).toThrow(UnreadableSecretError);
    expect(() => openSecret(key, 'v0.garbage', 'user-1')).toThrow(UnreadableSecretError);
  });

  it('derives independent subkeys for independent purposes', () => {
    const a = deriveSubkey(key, 'recovery-codes');
    expect(a).toHaveLength(32);
    expect(a.equals(deriveSubkey(key, 'recovery-codes'))).toBe(true);
    expect(a.equals(deriveSubkey(key, 'something-else'))).toBe(false);
    expect(a.equals(key)).toBe(false);
  });
});

describe('recovery codes', () => {
  const key = randomBytes(32);

  it(`makes ${RECOVERY_CODE_COUNT} distinct codes a person can copy down`, () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}-[0-9a-hjkmnp-tv-z]{4}$/);
  });

  it('reads a code however it was typed back', () => {
    const [code] = generateRecoveryCodes(1);
    const normal = normalizeRecoveryCode(code!);
    expect(normal).not.toBeNull();
    expect(normalizeRecoveryCode(code!.toUpperCase())).toBe(normal);
    expect(normalizeRecoveryCode(` ${code!.replace(/-/g, ' ')} `)).toBe(normal);
    expect(normalizeRecoveryCode(code!.replace(/-/g, ''))).toBe(normal);
    expect(normalizeRecoveryCode('oiL0-1111-2222')).toBe(normalizeRecoveryCode('0110-1111-2222'));
  });

  it('refuses something that cannot be a code', () => {
    expect(normalizeRecoveryCode('')).toBeNull();
    expect(normalizeRecoveryCode('123456')).toBeNull();
    expect(normalizeRecoveryCode('abcd-efgh-ijk!')).toBeNull();
  });

  it('hashes under a key, so a leaked table cannot be guessed against offline', () => {
    const normal = normalizeRecoveryCode('abcd-efgh-jkmn')!;
    const h = hashRecoveryCode(key, normal);
    expect(h).toBe(hashRecoveryCode(key, normal));
    expect(h).not.toBe(hashRecoveryCode(randomBytes(32), normal));
    expect(h).not.toContain(normal);
  });
});
