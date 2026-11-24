import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const DIST = resolve(__dirname, '..', '..', '..', 'apps', 'web', 'dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export interface WebApp {
  url: string;
  close: () => Promise<void>;
}

export async function serveWeb(apiOrigin: string, port: number): Promise<WebApp> {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error('No production build of the web app. Run `pnpm --filter @bault/web build` first.');
  }
  const api = new URL(apiOrigin);
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/api' || path.startsWith('/api/')) {
      const upstream = httpRequest(
        {
          hostname: api.hostname,
          port: api.port,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: api.host },
        },
        (answer) => {
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end('{"error":{"code":"api_unreachable","message":"The API is not answering."}}');
      });
      req.pipe(upstream);
      return;
    }
    const wanted = normalize(join(DIST, decodeURIComponent(path)));
    const file =
      wanted.startsWith(DIST) && existsSync(wanted) && statSync(wanted).isFile() ? wanted : join(DIST, 'index.html');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => done());
  });
  return {
    url: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
