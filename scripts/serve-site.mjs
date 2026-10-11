// Serve the built site (_site/) locally under a subpath, the way GitHub
// Pages serves a project site with no custom domain
// (https://<owner>.github.io/<repo>/). The live site is at the root of
// biasclear.com; a relative link that works under the subpath works there
// too, so this is the stricter test. A missing path gets 404.html with
// status 404, as on GitHub Pages. For previews only.
//
// Files are sent with "cache-control: no-store", so an edit shows at once.
// --pages-cache sends GitHub Pages' "max-age=600" instead, so a browser
// reuses files as it will on the live site (the request counter's checks
// need that).
//
// Usage: node scripts/serve-site.mjs [--dir _site] [--base /biasclear/] [--port 8080] [--pages-cache]

import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
};

export const PAGES_CACHE = "max-age=600";

export function serve({ dir, base = "/biasclear/", port = 8080, host = "127.0.0.1", cache = "no-store" }) {
  const root = resolve(dir);
  const send = (res, status, file) => {
    res.writeHead(status, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": cache });
    res.end(readFileSync(file));
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === base.slice(0, -1)) {
      res.writeHead(301, { location: base });
      return res.end();
    }
    let rel = null;
    if (url.pathname.startsWith(base)) rel = decodeURIComponent(url.pathname.slice(base.length));
    if (rel !== null) {
      let file = normalize(join(root, rel));
      if (file === root || file.startsWith(root + sep)) {
        if (existsSync(file) && statSync(file).isDirectory()) {
          if (!url.pathname.endsWith("/")) {
            res.writeHead(301, { location: `${url.pathname}/` });
            return res.end();
          }
          file = join(file, "index.html");
        } else if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
        if (existsSync(file) && statSync(file).isFile()) return send(res, 200, file);
      }
    }
    send(res, 404, join(root, "404.html"));
  });
  return new Promise((ok) => server.listen(port, host, () => ok(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const base = opt("--base", "/biasclear/");
  const port = Number(opt("--port", "8080"));
  const cache = args.includes("--pages-cache") ? PAGES_CACHE : "no-store";
  serve({ dir: opt("--dir", fileURLToPath(new URL("../_site", import.meta.url))), base, port, cache }).then(() =>
    console.log(`serving http://127.0.0.1:${port}${base}`),
  );
}
