/* Interaction tests for three behaviours added on top of the SOLAR-parity graph:
 *   2) drag-to-re-pin: dropping a person in a ring band pins them to that ring;
 *      dragging past the outer ring unpins them.
 *   3) arrow-key cycling: with a person selected, ←/→ walk their connections.
 *   4) relationship-type picker appears the moment a connection is drawn.
 * Runs against the live preview on :4173.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const id = (n) => "E:person|" + n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ME = "personal-network:me";

function seed() {
  const names = ["Alex Morgan", "Priya Patel", "Tom Baker", "Mia Wong", "Liam Murphy", "Grace Field"];
  const ents = names.map((n) => { const e = id(n); return { id: e, type: "person", label: n, identity: n, contribs: ["ent:" + e], attrs: { entityKind: "individual", strength: 45 }, source: "manual", createdBy: "personal-network", ts: 1 }; });
  const L = (from, to) => ({ id: "L:" + from + "|" + to, from, to, type: "KNOWS", source: "manual", createdBy: "personal-network", ts: 1, attrs: {} });
  const links = [L(ME, id("Alex Morgan")), L(ME, id("Priya Patel")), L(id("Alex Morgan"), id("Tom Baker")), L(id("Alex Morgan"), id("Mia Wong")), L(id("Priya Patel"), id("Liam Murphy")), L(id("Priya Patel"), id("Grace Field"))];
  return { schema: "orbit.case.v1", name: "Demo", updated: 1, entities: ents, links };
}

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

const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.setViewport({ width: 1366, height: 850 });
await page.goto(URL, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1800));

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Task 2: drag-to-re-pin -------------------------------------------------
console.log("\n[2] drag-to-re-pin (orbit layout)");
const tom = id("Tom Baker");
const ringAfterDrop = (x, y) => page.evaluate((args) => window.__ORBIT_DRAGTO__(args.id, args.x, args.y), { id: tom, x, y });
assert("dropped at r≈150 pins to inner ring", (await ringAfterDrop(150, 0)) === "inner");
assert("dropped at r≈260 re-pins to working ring", (await ringAfterDrop(0, 260)) === "working");
assert("dropped at r≈370 re-pins to outer ring", (await ringAfterDrop(-370, 0)) === "outer");
assert("dropped at r≈490 re-pins to deep field", (await ringAfterDrop(0, 490)) === "deep");
assert("dragged past the outer ring unpins (no ring)", (await ringAfterDrop(760, 0)) === "");
assert("ring persists after re-render", await page.evaluate((i) => { window.__ORBIT_SELECT__(i); return window.__ORBIT_DRAGTO__(i, 150, 0) === "inner"; }, tom));

// --- Task 3: arrow-key cycling ---------------------------------------------
console.log("\n[3] arrow-key cycling of a selection's connections");
// All people, label-sorted: Alex Morgan, Grace Field, Liam Murphy, Mia Wong, Priya Patel, Tom Baker
await page.evaluate((i) => window.__ORBIT_SELECT__(i), id("Alex Morgan"));
await wait(120);
const c1 = await page.evaluate(() => window.__ORBIT_CYCLE__(1));
assert("→ steps to the next person (Grace Field)", c1 === id("Grace Field"), c1);
const c2 = await page.evaluate(() => window.__ORBIT_CYCLE__(1));
assert("→ advances again (Liam Murphy)", c2 === id("Liam Murphy"), c2);
const c3 = await page.evaluate(() => window.__ORBIT_CYCLE__(-1));
assert("← steps back (Grace Field)", c3 === id("Grace Field"), c3);
// Wrapping: from the first person, ← lands on the last — which is your own
// record, since you are a contact like any other and sort under "you".
await page.evaluate((i) => window.__ORBIT_SELECT__(i), id("Alex Morgan"));
const wrap = await page.evaluate(() => window.__ORBIT_CYCLE__(-1));
assert("← from the first person wraps to the last (you)", wrap === ME, wrap);
const wrapOn = await page.evaluate(() => window.__ORBIT_CYCLE__(-1));
assert("← continues past you to the last contact (Tom Baker)", wrapOn === id("Tom Baker"), wrapOn);
// Works from anyone, including a person with no links (Mia Wong → Priya Patel).
await page.evaluate((i) => window.__ORBIT_SELECT__(i), id("Mia Wong"));
const fromLeaf = await page.evaluate(() => window.__ORBIT_CYCLE__(1));
assert("cycles even from a person with no connections", fromLeaf === id("Priya Patel"), fromLeaf);
// The REAL arrow key (not just the hook) drives the cycle end-to-end.
await page.evaluate((i) => window.__ORBIT_SELECT__(i), id("Alex Morgan"));
await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
await wait(100);
await page.keyboard.press("ArrowRight");
await wait(220);
const domName = await page.evaluate(() => (document.querySelector("#dossier-name") || {}).textContent);
assert("pressing the real → key cycles the open profile", domName === "Grace Field", domName);

// --- Task 4: relationship-type picker on draw ------------------------------
console.log("\n[4] relationship-type picker appears when a connection is drawn");
const canvasBox = await (await page.$("#network canvas")).boundingBox();
const abs = (d) => ({ x: canvasBox.x + d.x, y: canvasBox.y + d.y });
const nodeDom = (i) => page.evaluate((x) => window.__ORBIT_NODE_DOM__(x), i);
// Use Liam + Grace: both sit out on the rings (untouched by Task 2), well clear
// of ME, so the context menu lands on the intended node.
const liam = id("Liam Murphy"), grace = id("Grace Field");
const liamPt = abs(await nodeDom(liam));
await page.mouse.click(liamPt.x, liamPt.y, { button: "right" });
await wait(220);
const liamMenu = await page.evaluate(() => { const items = [...document.querySelectorAll(".ctx-menu .ctx-item")]; const it = items.find((i) => /Link from here/.test(i.textContent)); if (it) it.click(); return items.map((i) => i.textContent); });
assert("Link-from-here is available on the node menu", liamMenu.join("|").includes("Link from here"), JSON.stringify(liamMenu));
await wait(150);
const gracePt = abs(await nodeDom(grace));
await page.mouse.click(gracePt.x, gracePt.y);
await wait(220);
const pickerItems = await page.evaluate(() => { const p = document.querySelector(".reltype-picker"); return p ? [...p.querySelectorAll(".reltype-item")].map((i) => i.textContent) : null; });
assert("drawing a connection opens the relationship-type picker", !!pickerItems, "no picker");
assert("picker lists relationship types + custom", pickerItems && pickerItems.includes("Friend") && pickerItems.includes("Custom…"), JSON.stringify(pickerItems));
await page.evaluate(() => { const it = [...document.querySelectorAll(".reltype-picker .reltype-item")].find((i) => i.textContent === "Friend"); it && it.click(); });
await wait(200);
const relType = await page.evaluate((a, b) => window.__ORBIT_RELTYPE__(a, b), liam, grace);
assert("choosing a type labels the new relationship", relType === "Friend", relType);

assert("no uncaught errors across all interactions", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log("\n  " + passed + " passed, " + failed + " failed\n");
await browser.close();
process.exit(failed ? 1 : 0);
