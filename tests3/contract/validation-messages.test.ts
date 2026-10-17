import { beforeAll, describe, expect, it } from 'vitest';

/**
 * What a client is told about an unknown field and a malformed id
 * (apps/api/src/shared/errors/validation-error.ts).
 *
 * Driven through Nest's ValidationPipe with the options main.ts uses, so the
 * constraint names are the ones class-validator really produces: an unknown
 * field is `whitelistValidation` and `@IsUUID()` is `isUuid`, not `isUUID`.
 * Unit-level, no server.
 */
type Violation = { field: string; code: string; message: string };
type Problem = { code: string; message: string; details: { violations: Violation[] } };

let validate: (body: Record<string, unknown>) => Promise<Problem>;

beforeAll(async () => {
  await import('../../apps/api/node_modules/reflect-metadata/Reflect.js');
  const { ValidationPipe } = await import('../../apps/api/node_modules/@nestjs/common');
  const { IsUUID } = await import('../../apps/api/node_modules/class-validator');
  const { validationException } = await import('../../apps/api/src/shared/errors/validation-error');

  class Body {
    itemId?: string;
  }
  // `@IsUUID()`, applied without decorator syntax.
  IsUUID()(Body.prototype, 'itemId');

  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    exceptionFactory: validationException,
  });
  validate = async (body) => {
    try {
      await pipe.transform(body, { type: 'body', metatype: Body });
    } catch (e) {
      return (e as { getResponse(): Problem }).getResponse();
    }
    throw new Error('the body was accepted');
  };
});

const ID = '2f1c8a52-6a3e-4c55-9d7e-0b6f5f0e9a11';

describe('validation messages', () => {
  it('name a field the endpoint does not take', async () => {
    const problem = await validate({ itemId: ID, colour: 'red' });
    expect(problem.code).toBe('validation_failed');
    expect(problem.details.violations).toEqual([
      {
        field: 'colour',
        code: 'whitelistValidation',
        message: 'colour is not a field this accepts.',
      },
    ]);
    expect(problem.message).toBe('colour is not a field this accepts.');
  });

  it('say a malformed id is not in a valid format', async () => {
    const problem = await validate({ itemId: 'not-a-uuid' });
    expect(problem.details.violations).toEqual([
      { field: 'itemId', code: 'isUuid', message: 'item is not in a valid format.' },
    ]);
  });

  it('say an id nobody sent is required', async () => {
    const problem = await validate({});
    expect(problem.details.violations).toEqual([
      { field: 'itemId', code: 'isUuid', message: 'item is required.' },
    ]);
  });
});
