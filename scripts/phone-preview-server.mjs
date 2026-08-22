import { createServer } from "node:http";
import { existsSync, readFile, statSync, watch } from "node:fs";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = resolve(projectRoot, "src");
const port = Number(process.env.ORBIT_PHONE_PORT || process.argv[2] || 4173);
const clients = new Set();
let reloadTimer = null;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf"
};

function insideRoot(root, target) {
  const rel = relative(root, target);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

function sourcePath(urlPath) {
  let pathname = decodeURIComponent(urlPath.split("?", 1)[0]);
  if (pathname === "/" || pathname === "/index.html") pathname = "/personal-network/index.html";
  const candidates = [
    [publicRoot, resolve(publicRoot, `.${pathname}`)],
    [join(publicRoot, "personal-network"), resolve(join(publicRoot, "personal-network"), `.${pathname}`)],
    [projectRoot, resolve(projectRoot, `.${pathname}`)]
  ];
  for (const [root, target] of candidates) {
    if (insideRoot(root, target) && existsSync(target)) return target;
  }
  return null;
}

function liveClient() {
  return `<script>(function(){var source=new EventSource('/__orbit_live');source.addEventListener('reload',function(){location.reload();});})();</script>`;
}

function announceReload(fileName) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const client of clients) client.write(`event: reload\ndata: ${JSON.stringify(fileName || "source changed")}\n\n`);
    console.log(`changed ${fileName || "source"} · phone preview reloading`);
  }, 180);
}

function watchSource(folder) {
  try {
    watch(folder, { recursive: true }, (_event, fileName) => announceReload(String(fileName || "source")));
  } catch (error) {
    console.warn(`watch unavailable for ${folder}: ${error.message}`);
  }
}

watchSource(publicRoot);
watchSource(join(projectRoot, "assets"));

const server = createServer((request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405, { "Allow": "GET" });
    response.end("GET only");
    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/__orbit_live") {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    response.write("retry: 1000\n\ndata: connected\n\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  const target = sourcePath(url.pathname);
  if (!target || !existsSync(target) || !statSync(target).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  readFile(target, (error, content) => {
    if (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Could not read preview file");
      return;
    }
    const type = mime[extname(target).toLowerCase()] || "application/octet-stream";
    const body = type.startsWith("text/html")
      ? Buffer.from(content.toString("utf8").replace(/<\/body>/i, `${liveClient()}</body>`))
      : content;
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "Content-Length": body.length });
    response.end(body);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`ORBIT phone preview: serving ${publicRoot}`);
  console.log(`On this computer: http://localhost:${port}/index.html`);
  console.log(`On the phone: use the Wi-Fi address of this computer with /index.html`);
  console.log("Live reload is enabled; keep this process running while editing.");
});

setInterval(() => {
  for (const client of clients) client.write(": keep-alive\n\n");
}, 15000).unref();
