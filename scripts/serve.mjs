import http from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../dist");
const port = Number(process.env.PORT || 8080);
const { routes = [], responseOverrides = {} } = JSON.parse(
  await readFile(path.join(root, "staticwebapp.config.json"), "utf8"),
);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain",
  ".mp3": "audio/mpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const redirect = routes.find(
      (route) =>
        route.redirect &&
        (route.route.endsWith("*")
          ? pathname.startsWith(route.route.slice(0, -1))
          : route.route === pathname),
    );
    if (redirect) {
      res.writeHead(redirect.statusCode || 302, {
        Location: redirect.redirect,
      });
      return res.end();
    }
    let file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) && file !== root)
      throw new Error("Invalid path");
    if ((await stat(file)).isDirectory()) {
      if (!pathname.endsWith("/")) {
        res.writeHead(302, { Location: `${pathname}/` });
        return res.end();
      }
      file = path.join(file, "index.html");
    }
    const { size } = await stat(file);
    let start = 0,
      end = size - 1,
      partial = false;
    if (req.headers.range && file.endsWith(".mp3")) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!match) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        return res.end();
      }
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` });
        return res.end();
      }
      partial = true;
    }
    const headers = {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    };
    if (partial) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    res.writeHead(partial ? 206 : 200, headers);
    if (req.method === "HEAD") return res.end();
    const stream = createReadStream(file, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  } catch {
    const notFoundPath = responseOverrides["404"]?.rewrite;
    if (notFoundPath) {
      try {
        const notFoundFile = path.resolve(root, `.${notFoundPath}`);
        if (!notFoundFile.startsWith(root + path.sep))
          throw new Error("Invalid 404 rewrite");
        const { size } = await stat(notFoundFile);
        res.writeHead(404, {
          "Content-Type":
            types[path.extname(notFoundFile)] || "application/octet-stream",
          "Content-Length": size,
          "X-Content-Type-Options": "nosniff",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
        });
        if (req.method === "HEAD") return res.end();
        return createReadStream(notFoundFile).pipe(res);
      } catch {
        /* Fall through to the plain response if the configured page is missing. */
      }
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Listening at http://127.0.0.1:${port}`),
);
