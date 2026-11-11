import {
  readdir,
  readFile,
  writeFile,
  copyFile,
  mkdir,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const sqlite = dirname(require.resolve("@sqlite.org/sqlite-wasm/package.json"));
await mkdir("dist/vendor", { recursive: true });
for (const [source, target] of [
  ["index.mjs", "sqlite3.mjs"],
  ["sqlite3.wasm", "sqlite3.wasm"],
])
  await copyFile(join(sqlite, "dist", source), join("dist/vendor", target));
/**
 * Recursively list runtime files beneath a directory, excluding maps and sw.js.
 * @param {string} directory - Export directory to read.
 * @returns {Promise<string[]>} File paths for shell hashing and caching; filesystem errors propagate.
 */
async function inventory(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await inventory(path)));
    else if (!path.endsWith(".map") && !path.endsWith("sw.js"))
      files.push(path);
  }
  return files;
}
for (const file of await readdir("public"))
  await copyFile(join("public", file), join("dist", file));
const files = await inventory("dist");
const hash = createHash("sha256");
for (const file of files) hash.update(await readFile(file));
const cache = "kuwi-shell-" + hash.digest("hex").slice(0, 16);
/** Convert a platform filesystem path beneath dist into a root-relative web URL.
 * @param {string} file - Inventory path beginning with the `dist` directory.
 * @returns {string} URL path with forward slashes for the service-worker cache.
 */
const toWebPath = (file) => "/" + file.slice(5).split(sep).join("/");
await writeFile(
  "dist/sw.js",
  `const CACHE=${JSON.stringify(cache)}, FILES=${JSON.stringify(["/", ...files.map(toWebPath)])};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('kuwi-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request))||(event.request.mode==='navigate'?(await cache.match('/')):null)||fetch(event.request)));});
`,
);
