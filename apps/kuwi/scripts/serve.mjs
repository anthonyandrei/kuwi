import http from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
const root = resolve("dist");
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
 * Serve dist on loopback. Port zero selects an available port.
 * The optional response transform supports server-side fault injection in tests;
 * the CLI serves unchanged files. Callers own closing the returned HTTP server.
 */
export function startServer(port = 0, transform = (_path, bytes) => bytes) {
  return http
    .createServer(async (req, res) => {
      const path = resolve(
        root,
        "." + decodeURIComponent(new URL(req.url, "http://localhost").pathname),
      );
      if (path !== root && !path.startsWith(root + "/")) {
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
