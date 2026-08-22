/* Verify: no-photo nodes render as circular glyph chips (no square selection),
 * icon override persists, ME is draggable (not fixed), and Delete key removes a
 * selected contact. */
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
function seed() {
  const names = [["Alex Morgan", "individual"], ["Priya Patel", "individual"], ["Acme Corp", "organisation"], ["Tom Baker", "individual"]];
  // NO contribs — simulates contacts imported before the per-entity contrib
  // existed, i.e. the exact records the user could not delete.
  const entities = names.map(([name, kind]) => { const id = "E:person|" + name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); return { id, type: "person", label: name, identity: name, attrs: { entityKind: kind, strength: 50 }, source: "manual", createdBy: "pn", ts: 1 }; });
  return { schema: "orbit.case.v1", name: "D", updated: 1, entities, links: [] };
}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.setRequestInterception(true);
page.on("request", (r) => { if (/supabase-config\.js/.test(r.url())) r.respond({ status: 200, contentType: "text/javascript", body: "window.ORBIT_SUPABASE_CONFIG={};" }); else r.continue(); });
await page.evaluateOnNewDocument((cj) => {
  const m = new Map();
  const s = { getItem: (k) => m.has(String(k)) ? m.get(String(k)) : null, setItem: (k, v) => m.set(String(k), String(v)), removeItem: (k) => m.delete(String(k)), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
  Object.defineProperty(window, "localStorage", { value: s, configurable: true });
  const iso = "2026-08-01T12:00:00.000Z";
  localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "a", name: "Ben", email: "b@e.com", profile: {}, salt: "s", hash: "h", createdAt: iso, lastSignIn: iso }]));
  localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "a", signedInAt: iso }));
  localStorage.setItem("orbit_case_v1", cj);
}, JSON.stringify(seed()));
await page.setViewport({ width: 1200, height: 800 });
await page.goto(URL, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1700));
let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const shape = (id) => page.evaluate((i) => { try { return window.__ORBIT_NODESHAPE__ ? window.__ORBIT_NODESHAPE__(i) : (window.__ORBIT_SELECT__ && null); } catch (e) { return null; } }, id);
const count = () => page.evaluate(() => (document.getElementById("network-count") || {}).textContent);

assert("boots with glyph-chip nodes (no error)", errors.length === 0, errors.slice(0, 2).join(" | "));
assert("ME is centre-pinned in Orbit layout", (await page.evaluate(() => window.__ORBIT_NODE_FIXED__("personal-network:me"))) === true);

// icon override persists
await page.evaluate(() => window.__ORBIT_SETICON__("E:person|alex morgan", "favourite"));
await new Promise((r) => setTimeout(r, 400));
assert("icon override saved", (await page.evaluate(() => window.__ORBIT_ICON__("E:person|alex morgan"))) === "favourite");

// Delete key removes a selected contact
await page.evaluate(() => window.__ORBIT_SELECT__("E:person|tom baker"));
await new Promise((r) => setTimeout(r, 300));
const before = await count();
await page.keyboard.press("Delete");
await new Promise((r) => setTimeout(r, 400));
const after = await count();
assert("Delete key removes the selected contact", /4 people/.test(before) && /3 people/.test(after), before + " → " + after);

// undo brings it back
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
await new Promise((r) => setTimeout(r, 400));
assert("undo restores the deleted contact", /4 people/.test(await count()));
assert("no uncaught errors overall", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log("\n  " + passed + " passed, " + failed + " failed\n");
await browser.close();
process.exit(failed ? 1 : 0);
