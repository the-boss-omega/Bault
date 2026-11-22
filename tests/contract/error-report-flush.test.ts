import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { SHUTDOWN_FLUSH_MS, flushReportsOnExit, flushWithin } from '@bault/adapters';

process.env.NODE_ENV = 'test';

const ROOT = join(__dirname, '..', '..');

function fakeProcess() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { exit: vi.fn() });
}

const never = () => new Promise<void>(() => {});

afterEach(() => {
  vi.useRealTimers();
});

describe('flushing error reports before the process goes', () => {
  it('bounds the flush by its own timeout even when the reporter never answers', async () => {
    vi.useFakeTimers();
    const flush = vi.fn(never);
    let done = false;
    const flushing = flushWithin(flush, 1_500).then(() => {
      done = true;
    });

    expect(flush).toHaveBeenCalledWith(1_500);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flushing;
    expect(done).toBe(true);
  });

  it('survives a reporter whose flush fails', async () => {
    await expect(flushWithin(async () => Promise.reject(new Error('ingest down')), 50)).resolves.toBeUndefined();
  });

  it('on an uncaught exception, logs it, flushes with the bounded timeout, then exits 1', async () => {
    const proc = fakeProcess();
    const flush = vi.fn(async () => {});
    const logged: string[] = [];
    flushReportsOnExit(proc, flush, (what) => logged.push(what));

    const failure = new Error('boom');
    proc.emit('uncaughtException', failure);
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(1));

    expect(flush).toHaveBeenCalledWith(SHUTDOWN_FLUSH_MS);
    expect(SHUTDOWN_FLUSH_MS).toBeLessThanOrEqual(5_000);
    expect(logged).toEqual(['uncaught exception']);
    expect(flush.mock.invocationCallOrder[0]!).toBeLessThan(proc.exit.mock.invocationCallOrder[0]!);
  });

  it('on an unhandled rejection whose flush hangs, still exits once the timeout passes, and only once', async () => {
    vi.useFakeTimers();
    const proc = fakeProcess();
    const flush = vi.fn(never);
    const logged: string[] = [];
    flushReportsOnExit(proc, flush, (what) => logged.push(what), 1_000);

    proc.emit('unhandledRejection', new Error('lost promise'));
    proc.emit('uncaughtException', new Error('and another'));
    await vi.advanceTimersByTimeAsync(999);
    expect(proc.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(proc.exit).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(1_000);
    expect(logged).toEqual(['unhandled rejection']);
  });

  it('flushes when the event loop empties, without forcing an exit', async () => {
    const proc = fakeProcess();
    const flush = vi.fn(async () => {});
    flushReportsOnExit(proc, flush, () => {});

    proc.emit('beforeExit', 0);
    proc.emit('beforeExit', 0);
    await Promise.resolve();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(SHUTDOWN_FLUSH_MS);
    expect(proc.exit).not.toHaveBeenCalled();
  });
});

describe('the API on SIGTERM or SIGINT', () => {
  let common: typeof import('../../apps/api/node_modules/@nestjs/common');
  let core: typeof import('../../apps/api/node_modules/@nestjs/core');
  let reporting: typeof import('../../apps/api/src/shared/observability/error-reporting');

  beforeAll(async () => {
    await import('../../apps/api/node_modules/reflect-metadata/Reflect.js');
    common = await import('../../apps/api/node_modules/@nestjs/common');
    core = await import('../../apps/api/node_modules/@nestjs/core');
    reporting = await import('../../apps/api/src/shared/observability/error-reporting');
  });

  it('flushes the reports with the bounded timeout as the application shuts down, after the modules it wraps have stopped', async () => {
    const order: string[] = [];
    const flush = vi.fn(async (timeoutMs: number) => {
      order.push(`flush ${timeoutMs}`);
    });
    class Inner {
      onModuleDestroy() {
        order.push('inner destroyed');
      }
      beforeApplicationShutdown() {
        order.push('inner shutting down');
      }
    }
    class InnerModule {}
    common.Module({ providers: [Inner] })(InnerModule);
    class Root {}
    common.Module({
      imports: [InnerModule],
      providers: [reporting.FlushReportsOnShutdown, { provide: reporting.REPORT_FLUSHER, useValue: flush }],
    })(Root);

    const app = await core.NestFactory.createApplicationContext(Root, { logger: false, abortOnError: false });
    await app.close();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['inner destroyed', 'inner shutting down', `flush ${SHUTDOWN_FLUSH_MS}`]);
  });

  it('does not hold the shutdown past the timeout when the reporter hangs', async () => {
    vi.useFakeTimers();
    const hook = new reporting.FlushReportsOnShutdown(never);
    let done = false;
    const closing = hook.onApplicationShutdown().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(SHUTDOWN_FLUSH_MS);
    await closing;
    expect(done).toBe(true);
  });

  it('is wired into the API and worker processes', () => {
    const api = readFileSync(join(ROOT, 'apps', 'api', 'src', 'main.ts'), 'utf8');
    expect(api).toContain('app.enableShutdownHooks()');
    expect(api).toMatch(/providers: \[FlushReportsOnShutdown\]/);
    expect(api).toMatch(/flushReportsOnExit\(process, flushErrorReporting,/);

    const worker = readFileSync(join(ROOT, 'apps', 'worker', 'src', 'index.ts'), 'utf8');
    expect(worker).toMatch(/flushReportsOnExit\(process, flushErrorReporting,/);
    expect(worker).not.toMatch(/await flushErrorReporting\(\)/);
  });
});
