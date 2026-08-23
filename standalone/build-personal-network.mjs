/* Build the sibling Personal Network surface as one self-contained HTML file.
 * It intentionally has its own small pipeline: the main build-surface emitter
 * prunes the conjoined ORBIT host and would make this product depend on the
 * Charting shell. Shared persistence and graph libraries are still inlined from
 * src/ so the surface remains air-gapped and desktop-packagable. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = join(ROOT, "src", "personal-network");
const OUT = join(HERE, "dist", "ORBIT-personal-network.html");
const STAMP = process.env.ORBIT_BUILD_STAMP || process.argv[2] || "dev";

const MIME = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };
const missing = [];
function fail(message) { console.error("build-personal-network: FAILED - " + message); process.exit(1); }
function readRef(ref) { return readFileSync(resolve(BASE, ref.split("?")[0].split("#")[0]), "utf8"); }
function guard(code) { return code.replace(/<\/script>/gi, "<\\/script>"); }

function inlineCss(href) {
  const cssPath = resolve(BASE, href.split("?")[0].split("#")[0]);
  const cssDir = dirname(cssPath);
  return readFileSync(cssPath, "utf8").replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, asset) => {
    if (/^(data:|https?:|\/\/)/i.test(asset)) return match;
    const clean = asset.split("?")[0].split("#")[0];
    try {
      const bytes = readFileSync(resolve(cssDir, clean));
      const ext = (clean.split(".").pop() || "").toLowerCase();
      return `url("data:${MIME[ext] || "application/octet-stream"};base64,${bytes.toString("base64")}")`;
    } catch (error) {
      missing.push("asset:" + asset);
      return match;
    }
  });
}

let html = readFileSync(join(BASE, "index.html"), "utf8");
html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/g, (match, href) => {
  try { return `<style>/* ${href} */\n${inlineCss(href)}\n</style>`; }
  catch (error) { missing.push("css:" + href); return match; }
});
html = html.replace(/<script\s+([^>]*?)src="([^"]+)"([^>]*)>\s*<\/script>/g, (match, before, src, after) => {
  try {
    const module = /type="module"/.test(before + after);
    return `<script${module ? ' type="module"' : ""}>/* ${src.split("?")[0]} */\n${guard(readRef(src))}\n</script>`;
  } catch (error) {
    missing.push("js:" + src);
    return match;
  }
});
html = html.replace(/<title>[^<]*<\/title>/i, "<title>ORBIT Network</title>");
/* The single-file offline bundle ships no sidecar files, so drop the PWA
 * manifest link (its target would 404 and trip the strict CSP). */
html = html.replace(/<link\s+rel="manifest"[^>]*>\s*/i, "");
html = html.replace(/window\.ORBIT_SURFACE\s*=\s*"[^"]*";/, `window.ORBIT_BUILD = "${STAMP}"; window.ORBIT_SURFACE = "personal";`);
if (!/window\.ORBIT_BUILD\s*=/.test(html)) fail("build stamp anchor missing");
html = html.replace(/<head>/i, `<head>\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob: file: 'self'; style-src 'unsafe-inline' data: file: 'self'; img-src data: blob: file: 'self'; font-src data: file: 'self'; worker-src blob: data: file: 'self'; connect-src 'self' https://vjhahnnulqiouthqovdi.supabase.co wss://vjhahnnulqiouthqovdi.supabase.co https://people.googleapis.com; object-src 'none'; base-uri 'none'; form-action 'self' https://vjhahnnulqiouthqovdi.supabase.co">\n<script>window.ORBIT_OFFLINE_BUILD = true;</script>`);

if (missing.some((item) => !item.startsWith("asset:"))) fail("references could not be inlined: " + missing.filter((item) => !item.startsWith("asset:")).join(", "));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(Buffer.byteLength(html) / 1e6).toFixed(1)} MB) · BUILD ${STAMP}`);
