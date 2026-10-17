import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Two-factor secrets at rest: AES-256-GCM under `MFA_ENCRYPTION_KEY`.
 *
 * A TOTP secret is a password that never changes. Stored in clear, one leaked
 * database dump would let its holder produce every code every enrolled account
 * will ever accept. So the column holds ciphertext and the key lives in the
 * environment, which the dump does not contain.
 *
 * The account id is bound in as additional authenticated data, so a ciphertext
 * copied from one row to another no longer decrypts: "enrol on my own account,
 * then paste my secret onto the administrator's" is not a way in.
 *
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url. The version is
 * there so a later change of scheme can read old rows instead of guessing.
 */

const VERSION = 'v1';
const IV_BYTES = 12; // the GCM standard nonce size
const TAG_BYTES = 16;

export function sealSecret(key: Buffer, plaintext: Buffer, accountId: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(accountId, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), body.toString('base64url')].join('.');
}

/**
 * A sealed secret that does not open: altered, copied from another account, or
 * sealed under another key. Its own class so a caller can tell it from a bug.
 * Every case is the same to whoever holds the account (no code they type can
 * work), and the usual cause is `MFA_ENCRYPTION_KEY` changed or lost.
 */
export class UnreadableSecretError extends Error {
  override readonly name = 'UnreadableSecretError';
}

/** Throws `UnreadableSecretError` if the value was altered, belongs to another account, or was sealed under another key. */
export function openSecret(key: Buffer, sealed: string, accountId: string): Buffer {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || body === undefined) throw new UnreadableSecretError('Unrecognised sealed secret');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(Buffer.from(accountId, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
  } catch (e) {
    // Node says "Unsupported state or unable to authenticate data" for a wrong
    // key, a wrong account and a changed byte alike; GCM cannot tell them apart.
    throw new UnreadableSecretError(`Sealed secret does not open: ${(e as Error).message}`);
  }
}

/**
 * A key for one purpose, derived from the master key (HKDF-SHA256).
 *
 * The recovery codes are hashed under a key rather than plainly, and that key
 * must not be the encryption key itself: one key doing two jobs is one key
 * whose misuse in either place weakens the other.
 */
export function deriveSubkey(key: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), `bault-mfa:${purpose}`, 32));
}

/** `MFA_ENCRYPTION_KEY` as bytes. The config schema has already checked it is 32 of them. */
export function keyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}
