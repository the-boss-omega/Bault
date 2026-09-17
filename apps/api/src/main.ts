import 'reflect-metadata';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { json } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { loadEnv } from '@bault/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/errors/all-exceptions.filter';
import { validationException } from './shared/errors/validation-error';
import { StructuredLogger, requestContext } from './shared/observability/logger';

/**
 * Application entry point.
 *
 * Boot sequence:
 *  1. Validate & load environment (fails fast if a required var is missing).
 *  2. Create the Nest application from the root module.
 *  3. Apply the versioned global route prefix `/api/v1` (matches contracts/openapi.yaml).
 *  4. Publish interactive OpenAPI docs at `/docs`.
 *  5. Listen on the configured port.
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();

  /**
   * Logging that an aggregator can read and a person can correlate.
   *
   * The old line here was `logger: ['error', 'warn', 'log']` with a note that
   * "full logger wiring arrives in T022". What arrived in T022 was the health
   * checks; the logger did not. `LOG_LEVEL` sat in the env schema unread, output
   * had no timestamps, no levels an aggregator could filter on, and nothing tied
   * a line to the request that produced it.
   */
  const app = await NestFactory.create(AppModule, {
    logger: new StructuredLogger('api'),
    bufferLogs: false,
  });

  /**
   * Before everything else, so every log line from this request — including the
   * ones written by helmet, the validation pipe and the exception filter — is
   * tagged with the same id, and the caller gets that id back on the response.
   */
  app.use(requestContext);

  /**
   * Security headers.
   *
   * There were none. `contentSecurityPolicy` is off because this process serves
   * a JSON API and an OpenAPI explorer, not the SPA — the CSP that matters
   * belongs on whatever serves the front end, and a default one here would
   * break the explorer while protecting nothing.
   */
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  /**
   * Room for a photograph.
   *
   * Express defaults to a 100 kB JSON body, which is fine for every route this
   * API had until images could be uploaded and is a hard wall for a phone
   * photograph — base64 of a 10 MB image is about 13.4 MB. The cap is set ABOVE
   * `MAX_IMAGE_BYTES` on purpose, so an oversized upload is refused by the
   * media service with a sentence naming the limit rather than by the body
   * parser with a bare 413 and no explanation.
   */
  app.use(json({ limit: '16mb' }));

  /**
   * CORS, named explicitly or not at all.
   *
   * The session is an httpOnly cookie, so credentials must be allowed for the
   * SPA to work across origins — which makes a permissive origin a
   * session-riding hole rather than a convenience. An empty CORS_ORIGINS means
   * same-origin only, which is what the Vite dev proxy provides locally.
   */
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  if (origins.length > 0) {
    app.enableCors({ origin: origins, credentials: true });
  }

  /**
   * A deploy must not cut an in-flight transaction.
   *
   * Nest closes the HTTP server and runs module shutdown hooks on SIGTERM, so a
   * request that has already opened a database transaction finishes rather than
   * being severed mid-write — which, on an append-only ledger, is the difference
   * between a clean rollback and a half-written custody trail.
   */
  app.enableShutdownHooks();

  // Single, versioned API surface. Every controller route is served under this.
  app.setGlobalPrefix('api/v1');

  // Uniform problem responses for every thrown error (contracts/README.md shape).
  app.useGlobalFilters(new AllExceptionsFilter());

  /**
   * Validate & strip request DTOs globally (whitelist drops unknown fields).
   *
   * `exceptionFactory` is the important part. Without it every field-validation
   * failure in the product answered with the literal string "Bad Request
   * Exception" — Nest's internal class name — naming no field and stating no
   * rule, on all 164 routes. The detail was always there; nothing was shaping
   * it. See `validation-error.ts`.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationException,
    }),
  );

  /**
   * The OpenAPI explorer, off unless somebody asks for it.
   *
   * It was served unconditionally at `/docs`, unauthenticated, in every
   * environment — a complete route map for anyone who asked. It is genuinely
   * useful, so it is a switch rather than a deletion, and in production the env
   * schema additionally requires a password before the switch can be on.
   */
  if (!env.EXPOSE_API_DOCS) {
    await app.listen(env.API_PORT);
    // eslint-disable-next-line no-console
    console.log(
      `bault-api listening on http://localhost:${env.API_PORT}/api/v1 ` +
        `(docs disabled; set EXPOSE_API_DOCS=true to serve them)`,
    );
    return;
  }

  /**
   * The password that was required and enforced nothing.
   *
   * `API_DOCS_PASSWORD` has been mandatory in production whenever the explorer
   * was switched on — and nothing read it. Setting it bought exactly the
   * confidence that the route map was protected, and none of the protection: a
   * complete list of all 164 routes was served to anyone who asked for `/docs`.
   *
   * Basic auth rather than a session check, because the caller is a person with
   * a browser and no account — the explorer's whole audience is somebody who is
   * not signed in yet. Compared in constant time, because a password compared
   * with `===` leaks its length and prefix to anyone patient enough to measure.
   */
  if (env.API_DOCS_PASSWORD) {
    app.use('/docs', (req: IncomingMessage & { headers: Record<string, string | undefined> }, res: ServerResponse, next: () => void) => {
      const header = req.headers.authorization ?? '';
      const supplied = header.startsWith('Basic ')
        ? Buffer.from(header.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':')
        : '';
      const expected = Buffer.from(env.API_DOCS_PASSWORD);
      const given = Buffer.from(supplied);
      const ok =
        given.length === expected.length && timingSafeEqual(given, expected);
      if (!ok) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Bault API docs"');
        res.end('Unauthorized');
        return;
      }
      next();
    });
  }

  const openApiConfig = new DocumentBuilder()
    .setTitle('Bault API')
    .setDescription('Collectibles vaulting & marketplace platform')
    .setVersion('0.1.0')
    .addCookieAuth(env.SESSION_COOKIE_NAME) // session cookie is the auth scheme (ACC)
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(env.API_PORT);
  // eslint-disable-next-line no-console
  console.log(`bault-api listening on http://localhost:${env.API_PORT}/api/v1 (docs: /docs)`);
}

void bootstrap();
