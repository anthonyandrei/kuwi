import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const sqliteRoot = dirname(require.resolve('@sqlite.org/sqlite-wasm/package.json'));
const assets = new Map([
  ['/', [join(root, 'index.html'), 'text/html']],
  ...['index.html', 'app.js', 'db-worker.js', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'].map((name) => [
    `/${name}`, [join(root, name), name.endsWith('.js') ? 'text/javascript' : name.endsWith('.png') ? 'image/png' : name.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html'],
  ]),
  ['/vendor/sqlite3.mjs', [join(sqliteRoot, 'dist/index.mjs'), 'text/javascript']],
  ['/vendor/sqlite3.wasm', [join(sqliteRoot, 'dist/sqlite3.wasm'), 'application/wasm']],
]);

/**
 * Serve only the scratch assets on loopback.
 * @param {number} [port=4173] - Listening port; zero asks the OS for a free test port.
 * @returns {Promise<http.Server>} Listening server, which the caller must close.
 * Binding errors reject startup; asset read failures return HTTP 500.
 */
export async function startServer(port = 4173) {
  const server = http.createServer(async (request, response) => {
    const asset = assets.get(new URL(request.url, 'http://localhost').pathname);
    if (!asset || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404).end('Not found');
      return;
    }
    try {
      const body = await readFile(asset[0]);
      response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      console.error('Cannot serve prototype asset:', asset[0], error.code);
      response.writeHead(500).end('Cannot read prototype file');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer(Number(process.env.PORT || 4173));
  console.log(`Kuwi scratch storage test: http://127.0.0.1:${server.address().port}`);
}
