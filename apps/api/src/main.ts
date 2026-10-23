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
import { initErrorReporting } from './shared/observability/error-reporting';
import { jsonBodiesOnly, sameOriginWrites, writeOrigins } from './shared/csrf/cross-site';

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const reporting = initErrorReporting(env);

  const app = await NestFactory.create(AppModule, {
    logger: new StructuredLogger('api'),
    bufferLogs: false,
    bodyParser: false,
  });

  app.use(requestContext);

  app.getHttpAdapter().getInstance().set('trust proxy', env.TRUST_PROXY);

  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, strictTransportSecurity: false }),
  );

  app.use(
    sameOriginWrites(writeOrigins(env.APP_BASE_URL, env.CORS_ORIGINS, env.NODE_ENV), [
      '/api/v1/webhooks/payment',
    ]),
  );
  app.use(jsonBodiesOnly());

  app.use(json({ limit: '16mb' }));

  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  if (origins.length > 0) {
    app.enableCors({ origin: origins, credentials: true });
  }

  app.enableShutdownHooks();

  app.setGlobalPrefix('api/v1');

  app.useGlobalFilters(new AllExceptionsFilter());
  if (reporting) new StructuredLogger('api').log('error reporting enabled');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationException,
    }),
  );

  if (!env.EXPOSE_API_DOCS) {
    await app.listen(env.API_PORT);
    // eslint-disable-next-line no-console
    console.log(
      `bault-api listening on http://localhost:${env.API_PORT}/api/v1 ` +
        `(docs disabled; set EXPOSE_API_DOCS=true to serve them)`,
    );
    return;
  }

  if (env.API_DOCS_PASSWORD) {
    app.use(['/docs', '/docs-json', '/docs-yaml'], (req: IncomingMessage & { headers: Record<string, string | undefined> }, res: ServerResponse, next: () => void) => {
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
    .addCookieAuth(env.SESSION_COOKIE_NAME)
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(env.API_PORT);
  // eslint-disable-next-line no-console
  console.log(`bault-api listening on http://localhost:${env.API_PORT}/api/v1 (docs: /docs)`);
}

void bootstrap();
