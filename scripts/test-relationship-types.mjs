/* Verify relationship labels/types: set via the edge context menu and the QA
 * hook, read back from the vault, and undo. */
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
await page.setViewport({ width: 1366, height: 850 });
await page.goto(URL, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1700));

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const relType = (a, b) => page.evaluate((x, y) => window.__ORBIT_RELTYPE__(x, y), a, b);

// Link two people
await page.evaluate(() => window.__ORBIT_LINK__("E:person|alex morgan", "E:person|priya patel"));
await new Promise((r) => setTimeout(r, 400));
assert("relationship starts unlabelled", (await relType("E:person|alex morgan", "E:person|priya patel")) === "");

// Set via hook
await page.evaluate(() => window.__ORBIT_SETRELTYPE__("E:person|alex morgan", "E:person|priya patel", "Friend"));
await new Promise((r) => setTimeout(r, 400));
assert("relationship type saved to the vault", (await relType("E:person|alex morgan", "E:person|priya patel")) === "Friend");

// Undo reverts the label
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
await new Promise((r) => setTimeout(r, 400));
assert("undo reverts the relationship label", (await relType("E:person|alex morgan", "E:person|priya patel")) === "");

// Right-click the edge (midpoint of the two nodes) → menu offers types
const a = await page.evaluate(() => window.__ORBIT_NODE_DOM__("E:person|alex morgan"));
const b = await page.evaluate(() => window.__ORBIT_NODE_DOM__("E:person|priya patel"));
const box = await (await page.$("#network canvas")).boundingBox();
const mx = box.x + (a.x + b.x) / 2, my = box.y + (a.y + b.y) / 2;
await page.mouse.click(mx, my, { button: "right" });
await new Promise((r) => setTimeout(r, 250));
const items = await page.evaluate(() => { const m = document.querySelector(".ctx-menu"); return m ? [...m.querySelectorAll(".ctx-item")].map((i) => i.textContent) : null; });
assert("edge menu offers relationship types", items && items.join("|").includes("Friend") && items.join("|").includes("Family") && items.join("|").includes("Custom label"), JSON.stringify(items));
// Click "Family"
await page.evaluate(() => { const it = [...document.querySelectorAll(".ctx-menu .ctx-item")].find((i) => i.textContent === "Family"); it && it.click(); });
await new Promise((r) => setTimeout(r, 400));
assert("choosing a type from the menu applies it", (await relType("E:person|alex morgan", "E:person|priya patel")) === "Family");

assert("no uncaught errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log("\n  " + passed + " passed, " + failed + " failed\n");
await browser.close();
process.exit(failed ? 1 : 0);
