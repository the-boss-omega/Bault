import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { S3StorageAdapter, createStorageAdapter } from '@bault/adapters';

const GCS = {
  endpoint: 'https://storage.googleapis.com',
  region: 'auto',
  bucket: 'bault-prod-bault-images',
  accessKey: 'GOOG1EEXAMPLEACCESSID',
  secretKey: 'gcs-hmac-secret-example',
};

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function capture(): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
        ),
      });
      return new Response(null, { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the storage adapter against Cloud Storage through its S3 interoperability API', () => {
  it('puts an object path-style on storage.googleapis.com, signed for the auto region', async () => {
    const calls = capture();
    await new S3StorageAdapter(GCS).putObject({
      key: 'intake/abc/front.png',
      body: Buffer.from('png'),
      contentType: 'image/png',
    });

    expect(calls).toHaveLength(1);
    const [put] = calls;
    expect(put.method).toBe('PUT');
    expect(put.url).toBe('https://storage.googleapis.com/bault-prod-bault-images/intake/abc/front.png');
    expect(put.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=GOOG1EEXAMPLEACCESSID\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('sends no header Cloud Storage would refuse: no SDK checksums, no MD5, no ACL, no storage class', async () => {
    const calls = capture();
    await new S3StorageAdapter(GCS).putObject({
      key: 'intake/abc/back.jpg',
      body: Buffer.from('jpg'),
      contentType: 'image/jpeg',
    });

    expect(Object.keys(calls[0].headers).sort()).toEqual([
      'authorization',
      'content-type',
      'host',
      'x-amz-content-sha256',
      'x-amz-date',
    ]);
    expect(calls[0].headers.host).toBe('storage.googleapis.com');
    expect(calls[0].headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs a read URL on the same host and path, readable for its expiry and carrying no secret', async () => {
    const url = new URL(await new S3StorageAdapter(GCS).getSignedUrl('intake/abc/front.png', 600));

    expect(url.origin).toBe('https://storage.googleapis.com');
    expect(url.pathname).toBe('/bault-prod-bault-images/intake/abc/front.png');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^GOOG1EEXAMPLEACCESSID\/\d{8}\/auto\/s3\/aws4_request$/);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.toString()).not.toContain(GCS.secretKey);
  });

  it('is what the production settings from infra/gcp/provision.sh select', () => {
    const adapter = createStorageAdapter({
      NODE_ENV: 'production',
      STORAGE_PROVIDER: 's3',
      STORAGE_ENDPOINT: GCS.endpoint,
      STORAGE_REGION: GCS.region,
      STORAGE_BUCKET: GCS.bucket,
      STORAGE_ACCESS_KEY: GCS.accessKey,
      STORAGE_SECRET_KEY: GCS.secretKey,
    });
    expect(adapter).toBeInstanceOf(S3StorageAdapter);
  });
});

describe('the auto region against a real S3 server', () => {
  const MINIO = {
    endpoint: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
    region: 'auto',
    bucket: process.env.STORAGE_BUCKET ?? 'bault-images',
    accessKey: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.STORAGE_SECRET_KEY ?? 'minioadmin',
  };
  let storeIsUp = false;

  beforeAll(async () => {
    try {
      const probe = await fetch(`${MINIO.endpoint}/minio/health/live`, { signal: AbortSignal.timeout(1500) });
      storeIsUp = probe.ok;
    } catch {
      storeIsUp = false;
    }
  });

  it('round-trips bytes with a signature scoped to auto, as Cloud Storage is configured', async ({ skip }) => {
    if (!storeIsUp) skip();
    const s3 = new S3StorageAdapter(MINIO);
    const key = `intake/test/${Date.now()}-auto-region.png`;
    const body = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 13) % 256));

    await s3.putObject({ key, body, contentType: 'image/png' });
    const res = await fetch(await s3.getSignedUrl(key, 60));

    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(body)).toBe(true);
  });
});
