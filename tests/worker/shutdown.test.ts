import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Stopping the worker (E15).
 *
 * There was no SIGTERM handler. Outside a container Node's default is to die on
 * the spot; inside one, as PID 1, the signal is ignored outright and Docker
 * SIGKILLs the process ten seconds later. Either way a job that was half way
 * through — the nightly storage sweep, interest accrual — was cut off mid-run,
 * pg-boss never heard it stop, and the job sat `active` until its lease expired.
 *
 * This starts a real worker against the suite's database, waits for it to come
 * up, sends SIGTERM to THAT process only, and expects a clean exit.
 */
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
