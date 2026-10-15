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

/**
 * Whether a key is a NAME in the bucket rather than a path that moves around it.
 *
 * An object key is opaque to S3, but the URL it is sent in is not: the WHATWG
 * URL parser resolves `.` and `..` segments before the request is signed, so
 * `intake/../other-bucket/x.png` was signed — and served — as a different
 * bucket on the same endpoint (F428). Only a WHOLE segment of `.` or `..` does
 * that; `receipt.v2.pdf` is a name with dots in it and stays allowed.
 *
 * Exported so the API's DTOs refuse exactly what the adapter refuses, rather
 * than a second, slightly different idea of a safe key.
 */
export function isSafeObjectKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0) return false;
  return key.split('/').every((segment) => segment !== '.' && segment !== '..');
}

export interface StorageAdapter {
  putObject(req: PutObjectRequest): Promise<{ key: string }>;
  /** Time-limited signed URL so private images are readable without a public bucket. */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

/** Sandbox: pretends to store and returns a fake signed URL. */
export class SandboxStorageAdapter implements StorageAdapter {
  async putObject(req: PutObjectRequest): Promise<{ key: string }> {
    return { key: req.key };
  }
  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return `http://localhost:9000/bault-images/${key}?X-Expires=${expiresInSeconds}`;
  }
}
