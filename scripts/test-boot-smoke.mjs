/* Headless boot smoke test.
 *
 * Loads the real index.html (every script, in order) in jsdom and asserts the
 * app boots to a VISIBLE state — the auth screen — without an uncaught error,
 * and that the boot gate is dismissed. This is the "never a blank screen" and
 * "no uncaught JavaScript errors" guarantee, checked in a simulated browser.
 *
 * Run: node scripts/test-boot-smoke.mjs   (requires: npm i --no-save jsdom)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = join(HERE, "..", "src", "personal-network");
const indexPath = join(BASE, "index.html");
const html = readFileSync(indexPath, "utf8");

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => { errors.push(String(e && (e.detail || e.message || e))); });

const dom = new JSDOM(html, {
  url: pathToFileURL(indexPath).href,
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    /* file:// is an opaque origin, so jsdom provides no localStorage. Give the
     * page a Map-backed shim so the local-first storage paths run as in a real
     * browser, plus a no-op vis stub so the graph never needs a real canvas. */
    const backing = new Map();
    const storage = {
      getItem: (k) => (backing.has(String(k)) ? backing.get(String(k)) : null),
      setItem: (k, v) => { backing.set(String(k), String(v)); },
      removeItem: (k) => { backing.delete(String(k)); },
      clear: () => backing.clear(),
      key: (i) => Array.from(backing.keys())[i] ?? null,
      get length() { return backing.size; }
    };
    Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
    Object.defineProperty(window, "sessionStorage", { value: { ...storage, _b: new Map() }, configurable: true });
    const noopNet = function () { return { on() {}, setData() {}, fit() {}, destroy() {} }; };
    window.vis = { DataSet: function (d) { return { get: () => d || [] }; }, Network: noopNet };
  }
});

const win = dom.window;
// Minimal canvas + graph stub so vis/render paths never crash headless.
win.HTMLCanvasElement.prototype.getContext = win.HTMLCanvasElement.prototype.getContext || function () { return null; };

await new Promise((resolve) => win.addEventListener("load", resolve));
// Give async boot() (auth ready + case init) time to settle.
await new Promise((r) => setTimeout(r, 2500));

let passed = 0, failed = 0;
function assert(name, cond, detail) {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + (detail ? "  →  " + detail : "")); }
}

const doc = win.document;
const boot = doc.getElementById("boot-screen");
const authShell = doc.getElementById("auth-shell");
const app = doc.getElementById("network-app");

console.log("\n[boot smoke]");
assert("core modules loaded", !!(win.OrbitContactClassify && win.OrbitContactMatching && win.OrbitNetworkImporters && win.OrbitNetworkDomain));
assert("boot completed (gate dismissed or recovery shown)", win.__ORBIT_BOOTED__ === true || (doc.getElementById("boot-recovery") && !doc.getElementById("boot-recovery").hidden));
assert("boot screen is hidden after boot", boot && boot.hidden === true);
assert("a visible surface is shown (auth or workspace)", (authShell && !authShell.hidden) || (app && !app.hidden));
assert("no uncaught JavaScript errors during boot", errors.length === 0, errors.slice(0, 3).join(" | "));

// Exercise the local account engine (used as the offline fallback provider).
const cloudActive = !!(win.OrbitCloudAuth && win.OrbitCloudAuth.configured);
try {
  await win.OrbitLocalAuth.createAccount({ name: "Test User", email: "test@example.com", password: "secret1" });
  await new Promise((r) => setTimeout(r, 600));
  assert("local account engine creates + persists an account", !!(win.OrbitLocalAuth.current && win.OrbitLocalAuth.current()));
  if (cloudActive) {
    console.log("  SKIP  workspace-visible-after-signin (cloud auth is the active provider; sign-in is network-gated)");
  } else {
    assert("workspace becomes visible after local sign-in", app && app.hidden === false);
  }
  assert("no new uncaught errors after account creation", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  assert("local account engine creates + persists an account", false, String(e && e.message));
}

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
if (errors.length) { console.log("  captured errors:"); errors.slice(0, 5).forEach((e) => console.log("   - " + e.split("\n")[0])); }
console.log("----------------------------------------\n");
dom.window.close();
process.exit(failed ? 1 : 0);
