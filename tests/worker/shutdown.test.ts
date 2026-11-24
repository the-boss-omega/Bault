import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { drainWithin } from '../../apps/worker/src/shutdown';

const WORKER_DIR = fileURLToPath(new URL('../../apps/worker', import.meta.url));

describe('worker shutdown', () => {
  it('stops pg-boss gracefully and exits 0 on SIGTERM', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: WORKER_DIR,
      env: { ...process.env, LOG_LEVEL: 'info' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));

    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.on('exit', (code, signal) => resolve({ code, signal })),
    );

    try {
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => reject(new Error(`worker never started:\n${output}`)), 30_000);
        const poll = setInterval(() => {
          if (/worker started|\[worker\] started/.test(output)) {
            clearTimeout(deadline);
            clearInterval(poll);
            resolve();
          }
        }, 100);
      });

      child.kill('SIGTERM');
      const started = Date.now();
      const result = await Promise.race([
        exited,
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 40_000)),
      ]);

      expect(result, output).toEqual({ code: 0, signal: null });
      expect(Date.now() - started).toBeLessThan(35_000);
      expect(output).toMatch(/worker stopped/);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });
});

describe('the drain on shutdown', () => {
  it('shares one budget between its steps, so a slow first step shortens the next instead of adding to it', async () => {
    const given: number[] = [];
    const hangs = (ms: number) => {
      given.push(ms);
      return new Promise<void>(() => undefined);
    };
    const started = Date.now();
    await drainWithin(400, [hangs, hangs, hangs]);
    const took = Date.now() - started;

    expect(took).toBeGreaterThanOrEqual(390);
    expect(took).toBeLessThan(700);
    expect(given[0]).toBeGreaterThan(350);
    expect(given[1]).toBeLessThan(50);
    expect(given[2]).toBeLessThan(50);
  });

  it('runs every step though one fails, and does not wait out the budget when the steps finish early', async () => {
    const ran: string[] = [];
    const started = Date.now();
    await drainWithin(5_000, [
      async () => {
        ran.push('ocr');
        throw new Error('the reader did not close');
      },
      async () => {
        ran.push('queue');
      },
    ]);
    expect(ran).toEqual(['ocr', 'queue']);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
