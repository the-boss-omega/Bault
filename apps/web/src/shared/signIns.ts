export type SignInOutcome = 'success' | 'bad_credentials' | 'unverified' | 'refused' | 'mfa_challenged' | 'mfa_failed';

export interface SignInAttempt {
  id: string;
  occurredAt: string;
  outcome: SignInOutcome;
  identifier: string;
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
  username: string | null;
  email: string | null;
  role: string | null;
}

export interface SignInLog {
  since: string;
  last24h: { successes: number; failures: number; failingAddresses: number };
  suspicious: { identifier: string; failures: number; addresses: number; lastAt: string }[];
  attempts: SignInAttempt[];
}

export function displayIp(ip: string | null | undefined): string {
  if (!ip) return '—';
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

export function isLocalAddress(ip: string | null | undefined): boolean {
  const v = displayIp(ip);
  return v === '127.0.0.1' || v === '::1' || v === 'localhost';
}

export function describeDevice(ua: string | null | undefined): string {
  if (!ua) return '—';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua) && /Version\//.test(ua)
            ? 'Safari'
            : null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;

  if (browser && os) return `${browser} · ${os}`;
  if (browser) return browser;
  return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
}
