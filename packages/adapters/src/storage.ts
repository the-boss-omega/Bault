/**
 * Object-storage adapter (T020) — S3-compatible (MinIO locally, Hetzner in prod).
 * Item images are immutable versioned objects served via time-limited signed URLs
 * (Principle IX). The DB stores only the object key; bytes live in storage.
 */
export interface PutObjectRequest {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface StorageAdapter {
  putObject(req: PutObjectRequest): Promise<{ key: string }>;
  /** Time-limited signed URL so private images are readable without a public bucket. */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /**
   * The bytes, read server-side. Null when there is no such object. This is what
   * lets the API serve an image from its own origin when the store itself is not
   * reachable by the browser (see {@link ProxiedStorageAdapter}).
   */
  getObject(key: string): Promise<StoredObject | null>;
}

/**
 * Sandbox: a development sink that keeps the most recent photographs in memory.
 *
 * It used to keep nothing and hand back `http://localhost:9000/...` — a URL for a
 * store it never wrote to — so every photograph screen in development showed a
 * broken image. It now keeps the last {@link SANDBOX_MAX_OBJECTS} objects for the
 * life of the process, which is enough to exercise those screens and is still
 * not storage: a restart loses them, which is why production refuses it.
 */
const SANDBOX_MAX_OBJECTS = 200;

export class SandboxStorageAdapter implements StorageAdapter {
  private readonly objects = new Map<string, StoredObject>();

  async putObject(req: PutObjectRequest): Promise<{ key: string }> {
    this.objects.delete(req.key);
    this.objects.set(req.key, { body: req.body, contentType: req.contentType });
    while (this.objects.size > SANDBOX_MAX_OBJECTS) {
      const oldest = this.objects.keys().next().value;
      if (oldest === undefined) break;
      this.objects.delete(oldest);
    }
    return { key: req.key };
  }

  /** Not a signed URL: the sandbox is only ever read through the API's own route. */
  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return `sandbox://${key}?expires=${expiresInSeconds}`;
  }

  async getObject(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }
}

/**
 * Serves every object through the API's own origin.
 *
 * A presigned URL is only useful if the browser can reach the store it points
 * at. MinIO on `localhost:9000` cannot be reached from a phone on a tunnel, and
 * the sandbox has no URL at all — so the vault drawer, intake and parcel photos
 * all rendered as broken images. Wrapped in this, `getSignedUrl` returns a path
 * on the API (`/api/v1/media/object?key=…&exp=…&sig=…`) signed by the caller's
 * `sign` function, and the API streams the bytes back with `getObject`. The
 * authorisation stays where it was: whoever was allowed to receive the URL may
 * read the object until it expires, exactly as with a presigned S3 URL.
 */
export class ProxiedStorageAdapter implements StorageAdapter {
  constructor(
    private readonly inner: StorageAdapter,
    private readonly options: { basePath: string; sign: (key: string, expiresAt: number) => string },
  ) {}

  putObject(req: PutObjectRequest): Promise<{ key: string }> {
    return this.inner.putObject(req);
  }

  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + Math.max(1, Math.trunc(expiresInSeconds));
    const query = new URLSearchParams({
      key,
      exp: String(expiresAt),
      sig: this.options.sign(key, expiresAt),
    });
    return `${this.options.basePath}?${query.toString()}`;
  }

  getObject(key: string): Promise<StoredObject | null> {
    return this.inner.getObject(key);
  }
}
