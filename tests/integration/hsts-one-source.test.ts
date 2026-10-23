import { describe, it, expect } from 'vitest';
import { BASE } from './helpers/http';

describe('Strict-Transport-Security', () => {
  it('comes from the TLS edge only, never from the API process', async () => {
    const res = await fetch(`${BASE}/healthz`);
    expect(res.status).toBe(200);
    const hsts = res.headers.get('strict-transport-security');

    if (BASE.startsWith('https://')) {
      expect(hsts, 'the edge sends HSTS').not.toBeNull();
      expect(hsts!.match(/max-age/gi), `one HSTS value, got: ${hsts}`).toHaveLength(1);
    } else {
      expect(hsts, 'the API process sends no HSTS of its own').toBeNull();
    }
  });
});
