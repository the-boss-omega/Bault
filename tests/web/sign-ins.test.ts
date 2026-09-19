import { describe, it, expect } from 'vitest';
import { describeDevice, displayIp, isLocalAddress } from '../../apps/web/src/shared/signIns';

/**
 * Reading the sign-in log as a person.
 *
 * The API stores the raw user agent and socket address, because a log that
 * rewrites its evidence is not evidence. These pin the translation into what an
 * administrator asks: what was it, and where from.
 */
describe('addresses', () => {
  it('drops the IPv6-mapping prefix so a repeat looks like a repeat', () => {
    expect(displayIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(displayIp('2001:db8::1')).toBe('2001:db8::1');
    expect(displayIp(null)).toBe('—');
  });

  it('knows the machine itself', () => {
    expect(isLocalAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLocalAddress('::1')).toBe(true);
    expect(isLocalAddress('203.0.113.7')).toBe(false);
  });
});

describe('devices', () => {
  it('tests the most specific browser first, because user agents lie cumulatively', () => {
    // Edge claims to be Chrome, and Chrome claims to be Safari.
    const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0';
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
    const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    expect(describeDevice(edge)).toBe('Edge · Windows');
    expect(describeDevice(chrome)).toBe('Chrome · Windows');
    expect(describeDevice(safari)).toBe('Safari · iOS');
  });

  it('shows a script as the script, because that is the thing worth noticing', () => {
    expect(describeDevice('curl/8.10.1')).toBe('curl/8.10.1');
    expect(describeDevice(null)).toBe('—');
  });
});
