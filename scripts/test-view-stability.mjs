/* View-stability tests: once you have zoomed or panned, ordinary work must not
 * re-frame the chart. Selecting a person, cycling with ←/→, editing and deleting
 * all leave the camera alone; an import (people arriving) still refits.
 * Runs against the live preview on :4173.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const id = (n) => "E:person|" + n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ME = "personal-network:me";
const NAMES = ["Alex Morgan", "Priya Patel", "Tom Baker", "Mia Wong", "Liam Murphy"];

function seed() {
  const ents = NAMES.map((n) => { const e = id(n); return { id: e, type: "person", label: n, identity: n, contribs: ["ent:" + e], attrs: { entityKind: "individual", strength: 45 }, source: "manual", createdBy: "personal-network", ts: 1 }; });
  const L = (a, b) => ({ id: "L:" + a + b, from: a, to: b, type: "KNOWS", source: "manual", createdBy: "personal-network", ts: 1, attrs: {} });
  return { schema: "orbit.case.v1", name: "Demo", updated: 1, entities: ents, links: [L(ME, id("Tom Baker"))] };
}

async function run() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => { if (/supabase-config\.js/.test(req.url())) req.respond({ status: 200, contentType: "text/javascript", body: "window.ORBIT_SUPABASE_CONFIG = {};" }); else req.continue(); });
  await page.evaluateOnNewDocument((caseJson) => {
    const backing = new Map();
    const s = { getItem: (k) => backing.has(String(k)) ? backing.get(String(k)) : null, setItem: (k, v) => backing.set(String(k), String(v)), removeItem: (k) => backing.delete(String(k)), clear: () => backing.clear(), key: (i) => [...backing.keys()][i] ?? null, get length() { return backing.size; } };
    Object.defineProperty(window, "localStorage", { value: s, configurable: true });
    const iso = "2026-08-01T12:00:00.000Z";
    localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "acct_demo", name: "Ben", email: "b@e.com", profile: {}, salt: "s", hash: "h", createdAt: iso, lastSignIn: iso }]));
    localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "acct_demo", signedInAt: iso }));
    localStorage.setItem("orbit_case_v1", caseJson);
  }, JSON.stringify(seed()));
  await page.setViewport({ width: 1360, height: 840 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2200));
  if (!(await page.evaluate(() => typeof window.__ORBIT_VIEW__ === "function"))) { await browser.close(); return null; }
  return { browser, page };
}

let ctx = null;
for (let i = 0; i < 4 && !ctx; i++) { ctx = await run(); if (!ctx) console.log("retry " + (i + 1)); }
if (!ctx) { console.log("FAILED to seed after retries"); process.exit(1); }
const { browser, page } = ctx;

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const view = () => page.evaluate(() => window.__ORBIT_VIEW__());
const same = (a, b) => a && b && a.scale === b.scale && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
const show = (a, b) => JSON.stringify(a) + " → " + JSON.stringify(b);

const box = await page.evaluate(() => { const r = document.querySelector("#network").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });

console.log("\n[zoom + pan, then work]");
await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2);
for (let i = 0; i < 3; i++) { await page.mouse.wheel({ deltaY: -120 }); await wait(120); }
await wait(400);
const zoomed = await view();
assert("wheel zoomed in", zoomed && zoomed.scale > 0.7, JSON.stringify(zoomed));

/* Click a person that is actually on screen, the way a user would. */
const target = await page.evaluate((ids, b) => {
  for (const i of ids) { const d = window.__ORBIT_NODE_DOM__(i); if (d && d.x > 40 && d.x < b.w - 40 && d.y > 40 && d.y < b.h - 40) return { id: i, x: d.x, y: d.y }; }
  return null;
}, NAMES.map(id), box);
await page.mouse.click(box.x + target.x, box.y + target.y);
await wait(500);
const afterClick = await view();
assert("clicking a person keeps the view", same(zoomed, afterClick), show(zoomed, afterClick));
assert("clicking still opens the profile", !(await page.evaluate(() => document.querySelector("#person-dossier").hidden)));

await page.keyboard.press("ArrowRight");
await wait(350);
await page.keyboard.press("ArrowRight");
await wait(350);
const afterCycle = await view();
assert("←/→ cycling keeps the view", same(afterClick, afterCycle), show(afterClick, afterCycle));

const cycled = await page.evaluate(() => document.querySelector("#person-dossier h2").textContent.trim());
await page.keyboard.press("Delete");
await wait(600);
const afterDelete = await view();
assert("deleting keeps the view", same(afterCycle, afterDelete), show(afterCycle, afterDelete));
const advanced = await page.evaluate(() => document.querySelector("#person-dossier h2").textContent.trim());
assert("deleting still advances to the next contact", !(await page.evaluate(() => document.querySelector("#person-dossier").hidden)) && advanced !== cycled, cycled + " → " + advanced);

await page.keyboard.press("ArrowRight");
await wait(350);
assert("←/→ still works after the delete", (await page.evaluate(() => document.querySelector("#person-dossier h2").textContent.trim())) !== advanced);
assert("view held through the whole run", same(afterDelete, await view()), show(afterDelete, await view()));

console.log("\n[people arriving still refits]");
const beforeUndo = await view();
await page.evaluate(() => document.querySelector('[data-action="undo"]').click());
await wait(700);
const afterUndo = await view();
assert("undo brings the person back", (await page.evaluate(() => window.__ORBIT_PEOPLE__())) === 5, String(await page.evaluate(() => window.__ORBIT_PEOPLE__())));
assert("a returning person refits the chart", !same(beforeUndo, afterUndo), show(beforeUndo, afterUndo));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
await browser.close();
process.exit(failed ? 1 : 0);
