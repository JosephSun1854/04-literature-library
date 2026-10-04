import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url))),
  port = Number(process.env.PORT || 4174);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".ttf": "font/ttf",
};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const file = resolve(root, "." + decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    const entry = await stat(file),
      target = entry.isDirectory() ? resolve(file, "index.html") : file;
    const data = await readFile(target);
    res.writeHead(200, {
      "Content-Type": types[extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Literature Library: http://127.0.0.1:${port}`),
);
