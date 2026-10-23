import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function sealSecret(key: Buffer, plaintext: Buffer, accountId: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(accountId, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), body.toString('base64url')].join('.');
}

export class UnreadableSecretError extends Error {
  override readonly name = 'UnreadableSecretError';
}

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
    throw new UnreadableSecretError(`Sealed secret does not open: ${(e as Error).message}`);
  }
}

export function deriveSubkey(key: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), `bault-mfa:${purpose}`, 32));
}

export function keyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}
