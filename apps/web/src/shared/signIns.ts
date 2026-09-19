/**
 * Reading a sign-in log as a person, not as a parser.
 *
 * The API stores what the client sent — the raw `User-Agent` and the socket
 * address — because a log that rewrites its evidence is not evidence. This file
 * turns those into the two things an administrator actually asks: *what was it*
 * ("Chrome on Windows") and *where from* (an address without the IPv6-mapping
 * prefix the network stack puts in front of every IPv4 one).
 *
 * Pure functions, so `tests/web/sign-ins.test.ts` can pin them without a
 * browser.
 */

export type SignInOutcome = 'success' | 'bad_credentials' | 'unverified' | 'refused';

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

/**
 * An IPv4 address as a person writes it.
 *
 * Node reports an IPv4 client on a dual-stack socket as `::ffff:203.0.113.7`.
 * That prefix is a transport detail, and leaving it in makes two identical
 * addresses look different to anyone scanning a column for a repeat.
 */
export function displayIp(ip: string | null | undefined): string {
  if (!ip) return '—';
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

/** True for the machine itself — a sign-in that never crossed a network. */
export function isLocalAddress(ip: string | null | undefined): boolean {
  const v = displayIp(ip);
  return v === '127.0.0.1' || v === '::1' || v === 'localhost';
}

/**
 * "Chrome on Windows", or the first part of whatever was sent.
 *
 * Order matters, because user agents lie cumulatively: Edge says it is Chrome,
 * Chrome says it is Safari, and every one of them says it is Mozilla. So the
 * most specific token is tested first. Anything unrecognised — a script, a
 * command-line tool — is shown as-is and shortened, because an administrator
 * seeing `curl/8.10.1` in a sign-in log has learned something important.
 */
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
