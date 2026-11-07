import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const destination = join(root, '.local/dist');
const require = createRequire(import.meta.url);
const sqliteRoot = dirname(require.resolve('@sqlite.org/sqlite-wasm/package.json'));
const files = ['index.html', 'app.js', 'db-worker.js', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const sources = [
  ...files.map((name) => [name, join(root, name)]),
  ['vendor/sqlite3.mjs', join(sqliteRoot, 'dist/index.mjs')],
  ['vendor/sqlite3.wasm', join(sqliteRoot, 'dist/sqlite3.wasm')],
  ['vendor/sqlite-wasm-README.md', join(sqliteRoot, 'README.md')],
];
await mkdir(join(destination, 'vendor'), { recursive: true });
const hashes = {};
for (const [name, source] of sources) {
  await copyFile(source, join(destination, name));
  hashes[name] = createHash('sha256').update(await readFile(source)).digest('hex');
}
await writeFile(join(destination, 'build-info.json'), JSON.stringify({
  purpose: 'Disposable Kuwi storage test. Scratch entries only.',
  sqlitePackage: '@sqlite.org/sqlite-wasm@3.54.1-build1',
  files: hashes,
}, null, 2) + '\n');
console.log(`Static HTTPS test files: ${destination}`);
