import { describe, it, expect, beforeAll } from 'vitest';
import { S3StorageAdapter, SandboxStorageAdapter } from '@bault/adapters';

/**
 * The storage adapter contract.
 *
 * This suite exists because the platform shipped with only one implementation —
 * `SandboxStorageAdapter`, which returns the key and WRITES NOTHING — bound
 * unconditionally in `AdaptersModule`. Every intake photograph and every
 * arrival-condition photograph was accepted, acknowledged and discarded, while
 * `item_image` and `parcel_photo` rows recorded keys that resolved to nothing.
 *
 * So the contract is stated as the thing the sandbox cannot do: bytes put in
 * come back out. The sandbox is tested for what it actually promises, and is
 * explicitly asserted NOT to satisfy the round trip — because the day somebody
 * "simplifies" the wiring back to it, this is what says so.
 */

const CONFIG = {
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.STORAGE_REGION ?? 'eu-central',
  bucket: process.env.STORAGE_BUCKET ?? 'bault-images',
  accessKey: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
  secretKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
};

/**
 * Whether there is a bucket to talk to.
 *
 * The S3 round trip needs the object store up (`docker compose -f
 * infra/docker-compose.yml up -d minio`). Skipping is right rather than failing:
 * a developer with no MinIO should not see a red suite for a dependency the
 * other suites do not need — but the skip is LOUD, so nobody mistakes it for a
 * pass.
 */
let storeIsUp = false;

beforeAll(async () => {
  try {
    const probe = await fetch(`${CONFIG.endpoint}/minio/health/live`, {
      signal: AbortSignal.timeout(1500),
    });
    storeIsUp = probe.ok;
  } catch {
    storeIsUp = false;
  }
  if (!storeIsUp) {
    // eslint-disable-next-line no-console
    console.warn(
      `\n  [storage-adapter] SKIPPED the S3 round trip — no object store at ${CONFIG.endpoint}.` +
        `\n  Start one with: docker compose -f infra/docker-compose.yml up -d minio\n`,
    );
  }
});

describe('the storage contract', () => {
  it('round-trips the exact bytes it was given', async ({ skip }) => {
    if (!storeIsUp) skip();
    const s3 = new S3StorageAdapter(CONFIG);

    // Binary, not text: a signing bug that mangles high bytes passes a UTF-8
    // test and corrupts every photograph.
    const body = Buffer.from(
      Array.from({ length: 2048 }, (_, i) => (i * 37 + 11) % 256),
    );
    const key = `intake/test/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;

    await s3.putObject({ key, body, contentType: 'image/png' });

    const url = await s3.getSignedUrl(key, 120);
    const res = await fetch(url);
    expect(res.status).toBe(200);

    const returned = Buffer.from(await res.arrayBuffer());
    expect(returned.length).toBe(body.length);
    expect(returned.equals(body)).toBe(true);
  });

  it('signs a URL that is readable without credentials and names its expiry', async ({ skip }) => {
    if (!storeIsUp) skip();
    const s3 = new S3StorageAdapter(CONFIG);
    const key = `intake/test/${Date.now()}-signed.png`;
    await s3.putObject({ key, body: Buffer.from('x'), contentType: 'image/png' });

    const url = await s3.getSignedUrl(key, 300);
    // The URL goes into an <img src>, which cannot carry an Authorization
    // header — so everything the request needs has to be in the query string.
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Expires=300');
    expect(url).toContain('X-Amz-Signature=');

    /**
     * The SECRET must never appear — only the access key, which is public by
     * design and belongs in `X-Amz-Credential`.
     *
     * Asserted against a sentinel rather than `CONFIG.secretKey`, because
     * MinIO's default access key and secret are the SAME string (`minioadmin`)
     * — so checking the real config cannot tell "the secret leaked" apart from
     * "the access key is present, correctly".
     */
    const sentinel = 'sk-this-must-never-be-in-a-url';
    const signed = await new S3StorageAdapter({
      ...CONFIG,
      accessKey: 'ak-public',
      secretKey: sentinel,
    }).getSignedUrl(key, 300);
    expect(signed).toContain('ak-public');
    expect(signed).not.toContain(sentinel);
  });

  it('refuses an unsigned request for the same object', async ({ skip }) => {
    if (!storeIsUp) skip();
    const s3 = new S3StorageAdapter(CONFIG);
    const key = `intake/test/${Date.now()}-private.png`;
    await s3.putObject({ key, body: Buffer.from('private'), contentType: 'image/png' });

    // The bucket must not be public: a collector's card is private property.
    const res = await fetch(`${CONFIG.endpoint}/${CONFIG.bucket}/${key}`);
    expect(res.ok).toBe(false);
  });

  it('reports a failed upload instead of returning a key for bytes it did not store', async ({ skip }) => {
    if (!storeIsUp) skip();
    const s3 = new S3StorageAdapter({ ...CONFIG, bucket: 'bucket-that-does-not-exist' });
    await expect(
      s3.putObject({ key: 'a/b.png', body: Buffer.from('x'), contentType: 'image/png' }),
    ).rejects.toThrow(/Storage upload failed/);
  });

  it('rejects a half-configured adapter at construction, not at first upload', () => {
    expect(() => new S3StorageAdapter({ ...CONFIG, accessKey: '', secretKey: '' })).toThrow(
      /access key/i,
    );
    expect(() => new S3StorageAdapter({ ...CONFIG, bucket: '' })).toThrow(/bucket/i);
  });
});

describe('the sandbox adapter', () => {
  /**
   * Stated as a fact about the sandbox rather than a complaint: it is a
   * perfectly good development sink AND it cannot satisfy the contract above.
   * Both halves matter — the second is why the env schema and `AdaptersModule`
   * refuse it in production.
   */
  it('accepts bytes and keeps none of them', async () => {
    const sandbox = new SandboxStorageAdapter();
    const result = await sandbox.putObject({
      key: 'intake/2026/09/whatever.png',
      body: Buffer.from('a photograph of somebody else’s property'),
      contentType: 'image/png',
    });

    // It answers as though it stored the object…
    expect(result.key).toBe('intake/2026/09/whatever.png');

    // …and the URL it hands back is a fixed local string, not a signed one, so
    // nothing it returns can be fetched by anybody.
    const url = await sandbox.getSignedUrl('intake/2026/09/whatever.png');
    expect(url).not.toContain('X-Amz-Signature');
  });
});
