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
}

export class SandboxStorageAdapter implements StorageAdapter {
  async putObject(req: PutObjectRequest): Promise<{ key: string }> {
    return { key: req.key };
  }
  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return `http://localhost:9000/bault-images/${key}?X-Expires=${expiresInSeconds}`;
  }
}
