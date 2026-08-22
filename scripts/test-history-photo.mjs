/* Verify undo/redo (snapshot model) and that a photo node renders without
 * breaking the graph. Runs against the live preview.
 */
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
await page.evaluateOnNewDocument((caseJson) => {
  const m = new Map();
  const s = { getItem: (k) => m.has(String(k)) ? m.get(String(k)) : null, setItem: (k, v) => m.set(String(k), String(v)), removeItem: (k) => m.delete(String(k)), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
  Object.defineProperty(window, "localStorage", { value: s, configurable: true });
  const iso = "2026-08-01T12:00:00.000Z";
  localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "a", name: "Ben", email: "b@e.com", profile: {}, salt: "s", hash: "h", createdAt: iso, lastSignIn: iso }]));
  localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "a", signedInAt: iso }));
  localStorage.setItem("orbit_case_v1", caseJson);
}, JSON.stringify(seed()));

const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.setViewport({ width: 1366, height: 850 });
await page.goto(URL, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1800));

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const count = () => page.evaluate(() => (document.getElementById("network-count") || {}).textContent);
const undoDisabled = () => page.evaluate(() => document.querySelector('[data-action="undo"]').disabled);

assert("boots cleanly", /4 people/.test(await count()));
assert("undo disabled before any edit", await undoDisabled() === true);

// Set a real, properly-sized photo on a node and confirm it renders without error.
await page.evaluate(() => {
  const c = document.createElement("canvas"); c.width = 120; c.height = 120;
  const x = c.getContext("2d"); x.fillStyle = "#c0392b"; x.fillRect(0, 0, 120, 120); x.fillStyle = "#fff"; x.beginPath(); x.arc(60, 48, 22, 0, 7); x.fill();
  window.__ORBIT_SETPHOTO__("E:person|alex morgan", c.toDataURL("image/jpeg", 0.8));
});
await new Promise((r) => setTimeout(r, 900));
assert("photo node renders with no drawImage error", errors.length === 0, errors.slice(0, 2).join(" | "));

// Add a relationship, then undo, then redo
await page.evaluate(() => window.__ORBIT_LINK__("E:person|alex morgan", "E:person|priya patel"));
await new Promise((r) => setTimeout(r, 400));
assert("relationship added", /1 relationship/.test(await count()));
assert("undo enabled after edit", await undoDisabled() === false);

await page.evaluate(() => document.querySelector('[data-action="undo"]').click());
await new Promise((r) => setTimeout(r, 400));
assert("undo removes the relationship", /0 relationship/.test(await count()));

await page.evaluate(() => document.querySelector('[data-action="redo"]').click());
await new Promise((r) => setTimeout(r, 400));
assert("redo restores the relationship", /1 relationship/.test(await count()));

// Ctrl+Z keyboard path
await page.keyboard.down("Control"); await page.keyboard.press("z"); await page.keyboard.up("Control");
await new Promise((r) => setTimeout(r, 400));
assert("Ctrl+Z undoes", /0 relationship/.test(await count()));

assert("no uncaught errors overall", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log("\n  " + passed + " passed, " + failed + " failed\n");
await browser.close();
process.exit(failed ? 1 : 0);
