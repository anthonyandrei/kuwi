import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
const root = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".css": "text/css",
};
/**
 * Serve this app's dist on loopback regardless of the caller's directory.
 * Port zero selects an available port.
 * The optional response transform supports server-side fault injection in tests;
 * the CLI serves unchanged files. Callers own closing the returned HTTP server.
 * @param {number} port - Loopback port, or zero to ask the OS for an available one.
 * @param {(pathname: string, bytes: Buffer) => Buffer} transform - Optional response-body transform for tests.
 * @returns {http.Server} HTTP server listening on loopback; the caller closes it.
 */
export function startServer(port = 0, transform = (_path, bytes) => bytes) {
  return http
    .createServer(async (req, res) => {
      const path = resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
      );
      const relativePath = relative(root, path);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)
      ) {
        res.writeHead(403).end();
        return;
      }
      try {
        const file = path === root ? resolve(root, "index.html") : path;
        const bytes = await readFile(file);
        res
          .writeHead(200, {
            "Content-Type": mime[extname(file)] || "application/octet-stream",
            "Cache-Control": "no-cache",
          })
          .end(transform(new URL(req.url, "http://localhost").pathname, bytes));
      } catch {
        res.writeHead(404).end("Not found");
      }
    })
    .listen(port, "127.0.0.1");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  startServer(4183);
