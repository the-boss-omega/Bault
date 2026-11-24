import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

export interface OcrApi {
  base: string;
  port: number;
  stop: () => void;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export async function startOcrApi(extraEnv: Record<string, string> = {}, port?: number): Promise<OcrApi> {
  const chosen = port ?? (await freePort());
  const base = `http://localhost:${chosen}/api/v1`;
  let output = '';
  const child: ChildProcess = spawn(process.execPath, [join(process.cwd(), 'apps/api/dist/main.js')], {
    cwd: process.cwd(),
    env: { ...process.env, OCR_ENABLED: 'true', OCR_PROVIDER: 'sandbox', API_PORT: String(chosen), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => (output += String(d)));
  child.stderr?.on('data', (d) => (output += String(d)));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/readyz`)).ok) return { base, port: chosen, stop: () => child.kill('SIGTERM') };
    } catch {
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill('SIGTERM');
  throw new Error(`the API with OCR on did not start:\n${output.slice(-2000)}`);
}
