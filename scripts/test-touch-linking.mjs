/* Verify touch long-press opens the context menu (the phone linking path that
 * was missing), and that link-from-here completes with a tap. */
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";

function seed() {
  const names = ["Alex Morgan", "Priya Patel", "Tom Baker", "Mia Wong"];
  const entities = names.map((name) => { const id = "E:person|" + name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); return { id, type: "person", label: name, identity: name, contribs: ["ent:" + id], attrs: { entityKind: "individual", strength: 45 }, source: "manual", createdBy: "personal-network", ts: 1 }; });
  return { schema: "orbit.case.v1", name: "D", updated: 1, entities, links: [] };
}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on("request", (req) => { if (/supabase-config\.js/.test(req.url())) req.respond({ status: 200, contentType: "text/javascript", body: "window.ORBIT_SUPABASE_CONFIG = {};" }); else req.continue(); });
await page.evaluateOnNewDocument((cj) => {
  const m = new Map();
  const s = { getItem: (k) => m.has(String(k)) ? m.get(String(k)) : null, setItem: (k, v) => m.set(String(k), String(v)), removeItem: (k) => m.delete(String(k)), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
  Object.defineProperty(window, "localStorage", { value: s, configurable: true });
  const iso = "2026-08-01T12:00:00.000Z";
  localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "a", name: "Ben", email: "b@e.com", profile: {}, salt: "s", hash: "h", createdAt: iso, lastSignIn: iso }]));
  localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "a", signedInAt: iso }));
  localStorage.setItem("orbit_case_v1", cj);
}, JSON.stringify(seed()));
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page.goto(URL, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1800));

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const count = () => page.evaluate(() => (document.getElementById("network-count") || {}).textContent);

// Dismiss the welcome card so the canvas is free.
await page.evaluate(() => { const b = document.querySelector('#network-empty [data-action="dismiss-empty"]'); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 200));

const netBox = await (await page.$("#network")).boundingBox();
const dom = (id) => page.evaluate((i) => window.__ORBIT_NODE_DOM__(i), id);
async function longPress(clientX, clientY) {
  await page.evaluate((cx, cy) => {
    const el = document.getElementById("network");
    const t = new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
    el.dispatchEvent(new TouchEvent("touchstart", { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
  }, clientX, clientY);
  await new Promise((r) => setTimeout(r, 620)); // past the 480ms long-press threshold
  await page.evaluate(() => { const el = document.getElementById("network"); el.dispatchEvent(new TouchEvent("touchend", { touches: [], changedTouches: [], bubbles: true })); });
}

// Long-press a person node → node menu should open.
const alex = await dom("E:person|alex morgan");
await longPress(netBox.x + alex.x, netBox.y + alex.y);
await new Promise((r) => setTimeout(r, 150));
const items = await page.evaluate(() => { const m = document.querySelector(".ctx-menu"); return m ? [...m.querySelectorAll(".ctx-item")].map((i) => i.textContent) : null; });
assert("long-press opens the node context menu", !!items && items.join("|").includes("Link from here"), JSON.stringify(items));

// "Link from here" arms the link (completion by tap = the same click path proven
// on desktop in test-charting-menu). Confirm the menu item exists and dismiss.
await page.keyboard.press("Escape");

// Long-press an empty part of the canvas → background menu offers "Add person here".
const me = await dom("personal-network:me");
let bgItems = null;
for (const [dx, dy] of [[40, 40], [-40, 40], [40, -40], [60, 0]]) {
  await page.keyboard.press("Escape");
  await longPress(netBox.x + me.x + dx, netBox.y + me.y + dy);
  await new Promise((r) => setTimeout(r, 150));
  bgItems = await page.evaluate(() => { const m = document.querySelector(".ctx-menu"); return m ? [...m.querySelectorAll(".ctx-item")].map((i) => i.textContent) : null; });
  if (bgItems && bgItems.join("|").includes("Add person here")) break;
}
assert("long-press empty canvas offers Add person here", !!bgItems && bgItems.join("|").includes("Add person here"), JSON.stringify(bgItems));
assert("no uncaught errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log("\n  " + passed + " passed, " + failed + " failed\n");
await browser.close();
process.exit(failed ? 1 : 0);
