import { createHash, createHmac } from 'node:crypto';
import type { PutObjectRequest, StorageAdapter } from './storage';

/**
 * A REAL S3-compatible storage adapter — the thing the product has been missing.
 *
 * `SandboxStorageAdapter` returns the key and writes nothing, and it was bound
 * unconditionally. So every photograph an operator took at the intake bench, and
 * every picture of a damaged arrival, was accepted, acknowledged and discarded,
 * while `item_image` and `parcel_photo` rows were written pointing at keys that
 * resolve to nothing. The loss was invisible until somebody opened a damage
 * claim and found the evidence gone. `STORAGE_ENDPOINT`, `STORAGE_BUCKET`,
 * `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY` were required by the env schema
 * and read by nothing; MinIO was in the compose file and never contacted.
 *
 * SIGNED BY HAND, and on purpose. `@aws-sdk/client-s3` is ~15 MB of dependency
 * to perform two operations — PUT an object, and presign a GET. AWS Signature
 * Version 4 is a published algorithm, it is stable, and the whole of it that
 * these two calls need is below: canonical request, string to sign, a chain of
 * four HMACs. The alternative is carrying the SDK's entire surface and its
 * transitive tree for two HTTP requests.
 *
 * S3-COMPATIBLE, not S3-specific. It speaks to MinIO locally and to any S3 API
 * in production, because it only ever issues signed HTTP against
 * `STORAGE_ENDPOINT`. Path-style addressing (`endpoint/bucket/key`) is used
 * throughout rather than virtual-host style, since MinIO and most non-AWS
 * implementations do not provide per-bucket DNS.
 */

export interface S3Config {
  /** e.g. `http://localhost:9000` or `https://s3.eu-central-1.amazonaws.com`. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

const sha256Hex = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');

const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

/**
 * Percent-encode one path segment per RFC 3986.
 *
 * `encodeURIComponent` leaves `!'()*` alone and S3 does not, so a key containing
 * any of them signs to a different canonical request than the one the server
 * computes and the request is rejected with a signature mismatch that names
 * nothing useful. Object keys here are minted (`intake/2026/09/<uuid>.jpg`) so
 * this should never fire — which is exactly why it would be a miserable bug to
 * find later.
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

const encodeKey = (key: string): string => key.split('/').map(encodeSegment).join('/');

/** `20260912T104500Z` and `20260912`, the two forms every signature needs. */
function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/** The four-step key derivation: date → region → service → request. */
function signingKey(secretKey: string, dateStamp: string, region: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), SERVICE), 'aws4_request');
}

export class S3StorageAdapter implements StorageAdapter {
  private readonly endpoint: URL;

  constructor(private readonly config: S3Config) {
    if (!config.endpoint) throw new Error('S3StorageAdapter needs an endpoint');
    if (!config.bucket) throw new Error('S3StorageAdapter needs a bucket');
    if (!config.accessKey || !config.secretKey) {
      throw new Error('S3StorageAdapter needs an access key and a secret key');
    }
    this.endpoint = new URL(config.endpoint);
  }

  /** `https://host/bucket/some/key.jpg`, path-style. */
  private urlFor(key: string): URL {
    const url = new URL(this.endpoint.toString());
    const base = url.pathname.replace(/\/+$/, '');
    url.pathname = `${base}/${encodeSegment(this.config.bucket)}/${encodeKey(key)}`;
    return url;
  }

  /** `host` for the signature, including a non-default port. */
  private get hostHeader(): string {
    return this.endpoint.host;
  }

  /**
   * PUT the bytes, signed with the payload hash.
   *
   * The body hash goes in `x-amz-content-sha256` and into the canonical request,
   * so a payload altered in flight fails the signature rather than being stored.
   * That is the whole reason not to use UNSIGNED-PAYLOAD here: these are the
   * only copy of a photograph of somebody else's property.
   */
  async putObject(req: PutObjectRequest): Promise<{ key: string }> {
    const url = this.urlFor(req.key);
    const { amzDate, dateStamp } = stamps(new Date());
    const payloadHash = sha256Hex(req.body);

    const headers: Record<string, string> = {
      host: this.hostHeader,
      'content-type': req.contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };

    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((h) => `${h}:${headers[h]}\n`)
      .join('');

    const canonicalRequest = [
      'PUT',
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${this.config.region}/${SERVICE}/aws4_request`;
    const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const signature = createHmac(
      'sha256',
      signingKey(this.config.secretKey, dateStamp, this.config.region),
    )
      .update(stringToSign, 'utf8')
      .digest('hex');

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...headers,
        authorization:
          `${ALGORITHM} Credential=${this.config.accessKey}/${scope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: new Uint8Array(req.body),
    });

    if (!response.ok) {
      // The body carries S3's own error code; without it the failure is a bare
      // status and the operator is left guessing between credentials, bucket
      // and clock skew — which are the three things that actually go wrong.
      const detail = await response.text().catch(() => '');
      throw new Error(
        `Storage upload failed (${response.status} ${response.statusText}) for key "${req.key}"` +
          (detail ? `: ${detail.slice(0, 400)}` : ''),
      );
    }

    return { key: req.key };
  }

  /**
   * A presigned GET, so a private bucket can be read by a browser without ever
   * being public and without the API proxying the bytes.
   *
   * Query-string signing (not a header) because the URL goes straight into an
   * `<img src>`, which cannot carry an Authorization header. UNSIGNED-PAYLOAD is
   * correct here and only here: a GET has no body to hash.
   */
  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const url = this.urlFor(key);
    const { amzDate, dateStamp } = stamps(new Date());
    const scope = `${dateStamp}/${this.config.region}/${SERVICE}/aws4_request`;

    // S3 caps a presigned URL at seven days and rejects anything longer with a
    // signature error rather than a clear message, so it is clamped here.
    const expires = Math.min(Math.max(1, Math.trunc(expiresInSeconds)), 604_800);

    const query = new URLSearchParams({
      'X-Amz-Algorithm': ALGORITHM,
      'X-Amz-Credential': `${this.config.accessKey}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expires),
      'X-Amz-SignedHeaders': 'host',
    });
    // The canonical query string must be sorted by key; URLSearchParams is not.
    const canonicalQuery = [...query.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`)
      .join('&');

    const canonicalRequest = [
      'GET',
      url.pathname,
      canonicalQuery,
      `host:${this.hostHeader}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const signature = createHmac(
      'sha256',
      signingKey(this.config.secretKey, dateStamp, this.config.region),
    )
      .update(stringToSign, 'utf8')
      .digest('hex');

    return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }
}
