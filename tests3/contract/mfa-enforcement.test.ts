import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'test';

type Guard = typeof import('../../apps/api/src/modules/acc/mfa/mfa-enrollment.guard');
type Decorators = typeof import('../../apps/api/src/modules/acc/mfa/allow-without-mfa.decorator');
type PublicDecorator = typeof import('../../apps/api/src/modules/acc/public.decorator');

let guardModule: Guard;
let decorators: Decorators;
let publicDecorator: PublicDecorator;
let Reflector: typeof import('../../apps/api/node_modules/@nestjs/core').Reflector;

beforeAll(async () => {
  await import('../../apps/api/node_modules/reflect-metadata/Reflect.js');
  guardModule = await import('../../apps/api/src/modules/acc/mfa/mfa-enrollment.guard');
  decorators = await import('../../apps/api/src/modules/acc/mfa/allow-without-mfa.decorator');
  publicDecorator = await import('../../apps/api/src/modules/acc/public.decorator');
  ({ Reflector } = await import('../../apps/api/node_modules/@nestjs/core'));
});

type Role = 'user' | 'warehouse_operator' | 'admin';
const STAFF: Role[] = ['admin', 'warehouse_operator'];

function handler(mark?: 'exempt' | 'public'): () => void {
  const fn = function route() {};
  if (mark === 'exempt') decorators.AllowWithoutMfa()({}, 'route', { value: fn });
  if (mark === 'public') publicDecorator.Public()({}, 'route', { value: fn });
  return fn;
}

class SomeController {}

function context(user: unknown, fn: () => void, cls: object = SomeController) {
  return {
    getHandler: () => fn,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function guard(requiredRoles: Role[]) {
  return new guardModule.MfaEnrollmentGuard(new Reflector(), { requiredRoles });
}

const person = (role: Role, mfaEnabled: boolean | undefined) => ({ id: 'u', role, status: 'active', mfaEnabled });

function refusal(run: () => unknown): { status: number; code: string } | null {
  try {
    run();
    return null;
  } catch (e) {
    const err = e as { getStatus(): number; code: string };
    return { status: err.getStatus(), code: err.code };
  }
}

describe('the enrolment guard, with staff required to enrol (production)', () => {
  it('refuses an administrator and an operator who have not enrolled, on an ordinary route', () => {
    for (const role of STAFF) {
      expect(refusal(() => guard(STAFF).canActivate(context(person(role, false), handler())))).toEqual({
        status: 403,
        code: 'mfa_enrollment_required',
      });
    }
  });

  it('treats an unknown enrolment state as not enrolled', () => {
    expect(refusal(() => guard(STAFF).canActivate(context(person('admin', undefined), handler()))))
      .toMatchObject({ code: 'mfa_enrollment_required' });
  });

  it('lets them through once enrolled', () => {
    for (const role of STAFF) expect(guard(STAFF).canActivate(context(person(role, true), handler()))).toBe(true);
  });

  it('lets them reach the routes marked for it — enrolment, sign-out, their own profile', () => {
    for (const role of STAFF) {
      expect(guard(STAFF).canActivate(context(person(role, false), handler('exempt')))).toBe(true);
    }
  });

  it('honours the mark on a whole controller as well as on one route', () => {
    class Exempt {}
    decorators.AllowWithoutMfa()(Exempt);
    expect(guard(STAFF).canActivate(context(person('admin', false), handler(), Exempt))).toBe(true);
  });

  it('asks nothing of a collector', () => {
    expect(guard(STAFF).canActivate(context(person('user', false), handler()))).toBe(true);
  });

  it('leaves public routes and anonymous requests to the guards that own them', () => {
    expect(guard(STAFF).canActivate(context(person('admin', false), handler('public')))).toBe(true);
    expect(guard(STAFF).canActivate(context(undefined, handler()))).toBe(true);
  });
});

describe('the enrolment guard, with nobody required (development and test default)', () => {
  it('lets an administrator without a second factor through', () => {
    expect(guard([]).canActivate(context(person('admin', false), handler()))).toBe(true);
  });

  it('requires it of collectors too when configured to', () => {
    expect(refusal(() => guard(['user', ...STAFF]).canActivate(context(person('user', false), handler()))))
      .toMatchObject({ code: 'mfa_enrollment_required' });
  });
});

describe('the routes exempt from enrolment', () => {
  const SRC = join(__dirname, '..', '..', 'apps', 'api', 'src');

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return path.endsWith('.ts') ? [path] : [];
    });
  }

  it('are exactly enrolment, sign-out and the profile probe', () => {
    const marked: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/^\s*@AllowWithoutMfa\(\)/.test(line)) return;
        for (let j = i + 1; j < lines.length; j += 1) {
          const method = /^\s+(?:async\s+)?(\w+)\s*\(/.exec(lines[j]!);
          const cls = /^export class (\w+)/.exec(lines[j]!);
          if (cls) {
            marked.push(`${relative(SRC, file)}#class ${cls[1]}`);
            break;
          }
          if (method && !lines[j]!.trim().startsWith('@')) {
            marked.push(`${relative(SRC, file)}#${method[1]}`);
            break;
          }
        }
      });
    }
    expect(marked.sort()).toEqual(
      [
        'modules/acc/auth.controller.ts#logout',
        'modules/acc/mfa/mfa.controller.ts#confirm',
        'modules/acc/mfa/mfa.controller.ts#setup',
        'modules/acc/mfa/mfa.controller.ts#status',
        'modules/acc/profile.controller.ts#get',
      ].sort(),
    );
  });
});

describe('the second sign-in step', () => {
  it('is public, and is metered by the credential bucket like the first', async () => {
    const { AuthController } = await import('../../apps/api/src/modules/acc/auth.controller');
    const { notAnAuthRoute } = await import('../../apps/api/src/shared/throttle/auth-bucket');
    const { IS_PUBLIC_KEY } = publicDecorator;
    const step = (AuthController.prototype as unknown as Record<string, () => void>).loginMfa;
    expect(step, 'AuthController.loginMfa').toBeTypeOf('function');
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, step!)).toBe(true);
    expect(notAnAuthRoute({ getHandler: () => step } as never)).toBe(false);
    const login = (AuthController.prototype as unknown as Record<string, () => void>).login!;
    expect(Reflect.getMetadata('THROTTLER:LIMITauth', step!)).toBe(Reflect.getMetadata('THROTTLER:LIMITauth', login));
  });
});

describe('where the guard runs', () => {
  it('is global, after the session guard that puts the user on the request', async () => {
    const { AppModule } = await import('../../apps/api/src/app.module');
    const { SessionAuthGuard } = await import('../../apps/api/src/modules/acc/session-auth.guard');
    const { APP_GUARD } = await import('../../apps/api/node_modules/@nestjs/core');
    const providers = (Reflect.getMetadata('providers', AppModule) as { provide?: unknown; useClass?: unknown }[])
      .filter((p) => p.provide === APP_GUARD)
      .map((p) => p.useClass);
    const session = providers.indexOf(SessionAuthGuard);
    const mfa = providers.indexOf(guardModule.MfaEnrollmentGuard);
    expect(session).toBeGreaterThanOrEqual(0);
    expect(mfa).toBeGreaterThan(session);
  }, 30_000);
});
