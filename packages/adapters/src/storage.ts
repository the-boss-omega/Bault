export interface PutObjectRequest {
  key: string;
  body: Buffer;
  contentType: string;
}

export function isSafeObjectKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0) return false;
  return key.split('/').every((segment) => segment !== '.' && segment !== '..');
}

export interface StorageAdapter {
  putObject(req: PutObjectRequest): Promise<{ key: string }>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getObject(key: string): Promise<Buffer>;
}

export const SANDBOX_STORAGE_KEEPS = 50;

export const SANDBOX_PLACEHOLDER_BYTES = Buffer.from('sandbox placeholder for a photograph this process never kept');

export class SandboxStorageAdapter implements StorageAdapter {
  private readonly kept = new Map<string, Buffer>();

  async putObject(req: PutObjectRequest): Promise<{ key: string }> {
    this.kept.delete(req.key);
    this.kept.set(req.key, Buffer.from(req.body));
    while (this.kept.size > SANDBOX_STORAGE_KEEPS) {
      const oldest = this.kept.keys().next().value;
      if (oldest === undefined) break;
      this.kept.delete(oldest);
    }
    return { key: req.key };
  }

  async getObject(key: string): Promise<Buffer> {
    if (!isSafeObjectKey(key)) throw new Error(`Object key "${key}" has a "." or ".." segment`);
    const body = this.kept.get(key);
    return Buffer.from(body ?? SANDBOX_PLACEHOLDER_BYTES);
  }

  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return `http://localhost:9000/bault-images/${key}?X-Expires=${expiresInSeconds}`;
  }
}
