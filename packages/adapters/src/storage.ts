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
