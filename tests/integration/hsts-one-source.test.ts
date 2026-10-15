import { describe, it, expect } from 'vitest';
import { BASE } from './helpers/http';

/**
 * Strict-Transport-Security has exactly one source: Caddy, where TLS ends.
 *
 * helmet sent its default (`max-age=31536000; includeSubDomains`) on every API
 * response, and the production Caddyfile sends its own with `preload`. Two
 * writers of one header is how a max-age gets lowered by accident: whichever
 * the browser saw last won, and the SPA's own document (served by nginx, not
 * the API) carried a different policy from the API calls it made.
 *
 * Against the API process itself (plain http, as every local run is) there must
 * be none. Through the edge (`API_URL=https://…`, the staging run) there must be
 * one value, not two joined together.
 */
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
