import { HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

/**
 * The two rules that keep another site from acting through a visitor's browser.
 *
 * An ordinary HTML form on any site can post to this API. `SameSite=Lax` holds
 * back the cookie on a cross-site POST, which protects the signed-in routes from
 * a foreign SITE; it does nothing for a route that needs no cookie (a form
 * posting to `POST /auth/login` would sign the visitor into a stranger's
 * account), and nothing against a page on another subdomain of the same site.
 *
 * Both rules are cheap and neither needs a token the SPA would have to carry:
 *
 *  1. A state-changing request with a body says it is JSON. A form can only
 *     send `application/x-www-form-urlencoded`, `multipart/form-data` or
 *     `text/plain`, and none of those can be sent cross-origin with a JSON
 *     type without a CORS preflight that this API does not grant.
 *  2. A state-changing request that carries an `Origin` carries ours. Browsers
 *     send `Origin` on every cross-site POST, so a request without one is not
 *     a browser being steered by another page; it is curl, a server, a test.
 */

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** `application/json`, or any `application/<something>+json`, with parameters. */
function isJson(contentType: string): boolean {
  const type = contentType.split(';')[0]!.trim().toLowerCase();
  return type === 'application/json' || (type.startsWith('application/') && type.endsWith('+json'));
}

/**
 * Rule 1: refuse a non-JSON body on a state-changing request with 415.
 *
 * Keyed on the declared type rather than on whether a body arrived, because a
 * form with no fields still declares one — and it is exactly the bodiless
 * routes (sign out everywhere, buy this listing) that no DTO would catch.
 * A request that declares no type at all passes: nothing parses its body, and
 * the route's own validation answers for what is missing.
 */
export function jsonBodiesOnly() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const declared = req.headers['content-type'];
    if (STATE_CHANGING.has(req.method) && declared && !isJson(declared)) {
      next(
        new AppError(
          ErrorCode.VALIDATION_FAILED,
          'This API accepts JSON only. Send the request with Content-Type: application/json.',
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        ),
      );
      return;
    }
    next();
  };
}

/**
 * The origins a browser may write from: the app itself, and whatever
 * `CORS_ORIGINS` names. Normalised through `URL` so a trailing slash or a
 * default port in the configuration cannot make the comparison miss.
 */
export function writeOrigins(appBaseUrl: string, corsOrigins: string): Set<string> {
  const out = new Set<string>();
  for (const raw of [appBaseUrl, ...corsOrigins.split(',')]) {
    const value = raw.trim();
    if (!value) continue;
    try {
      out.add(new URL(value).origin);
    } catch {
      // An unparseable entry names no origin a browser could send; skipping it
      // narrows the list, which is the safe direction.
    }
  }
  return out;
}

/**
 * Rule 2: refuse a state-changing request whose `Origin` is not ours, with 403.
 *
 * `Origin: null` — a sandboxed frame, a `data:` page — is present and is not
 * ours, so it is refused; it is the cheapest way for an attacker's page to post
 * without naming its own site. `exemptPaths` is for callers that are not
 * browsers and owe us no particular origin: the payment provider's webhook,
 * which is authenticated by its signature instead.
 */
export function sameOriginWrites(allowed: ReadonlySet<string>, exemptPaths: readonly string[]) {
  const exempt = new Set(exemptPaths.map(normalisePath));
  return (req: Request, _res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (
      origin === undefined ||
      !STATE_CHANGING.has(req.method) ||
      allowed.has(origin) ||
      exempt.has(normalisePath(req.path))
    ) {
      next();
      return;
    }
    next(AppError.forbidden('This request came from a page outside Bault, so it was refused.'));
  };
}

/** Express routes case-insensitively and ignores a trailing slash; so does this. */
function normalisePath(path: string): string {
  return path.toLowerCase().replace(/\/+$/, '');
}
