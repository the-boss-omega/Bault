import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { loadEnv } from '@bault/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/errors/all-exceptions.filter';

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

  const app = await NestFactory.create(AppModule, {
    // Structured logs; full logger/Sentry wiring arrives in T022.
    logger: ['error', 'warn', 'log'],
  });

  // Single, versioned API surface. Every controller route is served under this.
  app.setGlobalPrefix('api/v1');

  // Uniform problem responses for every thrown error (contracts/README.md shape).
  app.useGlobalFilters(new AllExceptionsFilter());

  // Validate & strip request DTOs globally (whitelist drops unknown fields).
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

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
