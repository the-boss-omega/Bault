import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
