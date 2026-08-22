/* Verify the SOLAR-style right-click context menu on the personal network:
 * right-click a node opens the menu; "Link from here" + a click links two
 * people; right-click background offers "Add person here"; delete removes a
 * contact. Runs against the live preview.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";

function seed() {
  const names = ["Alex Morgan", "Priya Patel", "Tom Baker", "Mia Wong", "Liam Murphy", "Grace Field"];
  const entities = names.map((name) => { const id = "E:person|" + name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); return { id, type: "person", label: name, identity: name, contribs: ["ent:" + id], attrs: { entityKind: "individual", strength: 45 }, source: "manual", createdBy: "personal-network", ts: 1 }; });
  return { schema: "orbit.case.v1", name: "Demo", updated: 1, entities, links: [] };
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("dialog", (d) => d.accept()); // auto-confirm the delete prompt
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

const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.setViewport({ width: 1366, height: 850 });
await page.goto(URL, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1800));

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const count = () => page.evaluate(() => (document.getElementById("network-count") || {}).textContent);
const nodeDom = (id) => page.evaluate((i) => window.__ORBIT_NODE_DOM__(i), id);
const canvasBox = await (await page.$("#network canvas")).boundingBox();
const abs = (d) => ({ x: canvasBox.x + d.x, y: canvasBox.y + d.y });

// 1. Right-click a node → context menu appears
const alex = abs(await nodeDom("E:person|alex morgan"));
await page.mouse.click(alex.x, alex.y, { button: "right" });
await new Promise((r) => setTimeout(r, 250));
const menuItems = await page.evaluate(() => { const m = document.querySelector(".ctx-menu"); return m ? [...m.querySelectorAll(".ctx-item")].map((i) => i.textContent) : null; });
assert("right-click node opens context menu", !!menuItems, "no menu");
assert("node menu has Link/Edit/Delete", menuItems && menuItems.join("|").includes("Link from here") && menuItems.join("|").includes("Delete contact"), JSON.stringify(menuItems));

// 2. Click "Link from here" then click another node → relationship created
const before = await count();
await page.evaluate(() => { const items = [...document.querySelectorAll(".ctx-menu .ctx-item")]; const it = items.find((i) => /Link from here/.test(i.textContent)); it && it.click(); });
await new Promise((r) => setTimeout(r, 200));
const priya = abs(await nodeDom("E:person|priya patel"));
await page.mouse.click(priya.x, priya.y);
await new Promise((r) => setTimeout(r, 500));
const afterLink = await count();
assert("link-from-here created a relationship", /0 relationship/.test(before) && /1 relationship/.test(afterLink), before + " → " + afterLink);

// 3. Right-click empty canvas → "Add person here…". Try a few empty offsets from
//    ME (which sits at canvas centre) until an oncontext-driven menu appears.
const me = abs(await nodeDom("personal-network:me"));
let bgItems = null;
for (const [dx, dy] of [[45, 45], [-45, 45], [45, -45], [70, 0], [0, 70]]) {
  await page.keyboard.press("Escape");
  await page.mouse.click(me.x + dx, me.y + dy, { button: "right" });
  await new Promise((r) => setTimeout(r, 200));
  bgItems = await page.evaluate(() => { const m = document.querySelector(".ctx-menu"); return m ? [...m.querySelectorAll(".ctx-item")].map((i) => i.textContent) : null; });
  if (bgItems && bgItems.join("|").includes("Add person here")) break;
}
assert("background menu offers Add person here", bgItems && bgItems.join("|").includes("Add person here"), JSON.stringify(bgItems));
await page.keyboard.press("Escape");

// 4. Delete a contact via the menu
const peopleBefore = await count();
const tom = abs(await nodeDom("E:person|tom baker"));
await page.mouse.click(tom.x, tom.y, { button: "right" });
await new Promise((r) => setTimeout(r, 250));
await page.evaluate(() => { const items = [...document.querySelectorAll(".ctx-menu .ctx-item")]; const it = items.find((i) => /Delete contact/.test(i.textContent)); it && it.click(); });
await new Promise((r) => setTimeout(r, 500));
const peopleAfter = await count();
assert("delete contact removes a person", /6 people/.test(peopleBefore) && /5 people/.test(peopleAfter), peopleBefore + " → " + peopleAfter);

assert("no uncaught errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await page.screenshot({ path: (process.argv[2] || ".") + "/menu-test.png" });
console.log("\n  " + passed + " passed, " + failed + " failed\n");
await browser.close();
process.exit(failed ? 1 : 0);
