/* Tag tests: the model, the flair on the chart, the filter bar, search, the
 * by-tag layout, and the glyph for contacts that arrived as an address only.
 * Model assertions run in Node; the rest drive the live preview on :4173.
 */
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = join(HERE, "..", "src", "personal-network");
await import(pathToFileURL(join(BASE, "tags.js")).href);
await import(pathToFileURL(join(BASE, "icons.js")).href);
const T = globalThis.OrbitTags, Icons = globalThis.OrbitIcons;

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const id = (n) => "E:person|" + n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ME = "personal-network:me";

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const eq = (n, a, b) => assert(n, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + " vs " + JSON.stringify(b));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("\n[the tag model]");
eq("a comma string parses", T.parse("cycling, work"), ["cycling", "work"]);
eq("duplicates collapse regardless of case", T.parse("Work, work"), ["Work"]);
eq("whitespace collapses", T.parse("  ex   colleague "), ["ex colleague"]);
eq("separators cannot hide inside a tag", T.parse(["a;b"]), ["a b"]);
eq("toggle is add-or-remove", T.toggle(T.toggle([], "uni"), "UNI"), []);
assert("a tag's colour is stable and from the palette", T.colour("cycling") === T.colour("Cycling") && T.PALETTE.includes(T.colour("cycling")));
assert("an address-only contact gets the mail glyph", Icons.defaultKey("unknown") === "mail", Icons.defaultKey("unknown"));
assert("a person still gets the person glyph", Icons.defaultKey("individual") === "person");
assert("an organisation still gets its own", Icons.defaultKey("generic-inbox") === "organisation");

/* Four tagged people, one organisation, and one that arrived as an address. */
function seed() {
  const person = (name, attrs) => { const e = id(name); return { id: e, type: "person", label: name, identity: name, contribs: ["ent:" + e], attrs: Object.assign({ entityKind: "individual", strength: 45 }, attrs), source: "manual", createdBy: "personal-network", ts: 1 }; };
  const ents = [
    person("Alex Morgan", { tags: ["cycling", "uni"] }),
    person("Priya Patel", { tags: ["work"] }),
    person("Tom Baker", { tags: ["cycling"] }),
    person("Mia Wong", {}),
    person("Grace Field", { entityKind: "organisation" }),
    person("sales", { entityKind: "unknown", email: "sales@nowhere.net" })
  ];
  const L = (a, b) => ({ id: "L:" + a + b, from: a, to: b, type: "KNOWS", source: "manual", createdBy: "personal-network", ts: 1, attrs: {} });
  return { schema: "orbit.case.v1", name: "Demo", updated: 1, entities: ents, links: [L(ME, id("Tom Baker"))] };
}

async function boot() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.dismiss());
  await page.setRequestInterception(true);
  page.on("request", (req) => { if (/supabase-config\.js/.test(req.url())) req.respond({ status: 200, contentType: "text/javascript", body: "window.ORBIT_SUPABASE_CONFIG = {};" }); else req.continue(); });
  await page.evaluateOnNewDocument((caseJson) => {
    const backing = new Map();
    const s = { getItem: (k) => backing.has(String(k)) ? backing.get(String(k)) : null, setItem: (k, v) => backing.set(String(k), String(v)), removeItem: (k) => backing.delete(String(k)), clear: () => backing.clear(), key: (i) => [...backing.keys()][i] ?? null, get length() { return backing.size; } };
    Object.defineProperty(window, "localStorage", { value: s, configurable: true });
    const iso = "2026-08-01T12:00:00.000Z";
    localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "acct_demo", name: "Ben", email: "ben@orbit.test", profile: {}, salt: "s", hash: "h", createdAt: iso, lastSignIn: iso }]));
    localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "acct_demo", signedInAt: iso }));
    localStorage.setItem("orbit_case_v1", caseJson);
  }, JSON.stringify(seed()));
  await page.setViewport({ width: 1400, height: 880 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await wait(2200);
  if (!(await page.evaluate(() => typeof window.__ORBIT_TAGCENSUS__ === "function"))) { await browser.close(); return null; }
  return { browser, page, errors };
}

let ctx = null;
for (let i = 0; i < 4 && !ctx; i++) { ctx = await boot(); if (!ctx) console.log("retry " + (i + 1)); }
if (!ctx) { console.log("FAILED to seed after retries"); process.exit(1); }
const { browser, page, errors } = ctx;

const chips = () => page.evaluate(() => [...document.querySelectorAll("#tag-bar [data-tag-filter]")].map((n) => n.textContent.replace(/\s+/g, " ").trim()));
const visibleNodes = () => page.evaluate(() => window.__ORBIT_PEOPLE__());

console.log("\n[the tag bar]");
assert("the bar is shown when tags exist", !(await page.evaluate(() => document.querySelector("#tag-bar").hidden)));
const bar = await chips();
/* textContent runs the name straight into the count; the gap is CSS. */
assert("a chip per tag, most-used first, with counts", bar.join(" | ") === "cycling2 | uni1 | work1", bar.join(" | "));

console.log("\n[filtering]");
const active = await page.evaluate(() => window.__ORBIT_TAGFILTER__("cycling"));
assert("clicking a tag turns the filter on", active.length === 1 && active[0] === "cycling", JSON.stringify(active));
assert("everyone stays on the chart", (await visibleNodes()) === 6, String(await visibleNodes()));
const opacities = await page.evaluate((ids) => ids.map((i) => {
  try { return { id: i, o: window.__ORBIT_NODEOPACITY__(i) }; } catch (e) { return { id: i, o: "err" }; }
}), [id("Alex Morgan"), id("Mia Wong")]);
assert("tagged people stay bright, the rest fade back", opacities[0].o === 1 && opacities[1].o < 0.5, JSON.stringify(opacities));
const cleared = await page.evaluate(() => window.__ORBIT_TAGFILTER__("cycling"));
assert("clicking it again clears the filter", cleared.length === 0, JSON.stringify(cleared));

console.log("\n[tagging a person]");
const set = await page.evaluate((i) => window.__ORBIT_SETTAGS__(i, "work, cycling"), id("Mia Wong"));
eq("tags are written to the person", set, ["work", "cycling"]);
const census = await page.evaluate(() => window.__ORBIT_TAGCENSUS__());
eq("the census picks the new tags up", census.map((c) => c.tag + ":" + c.count), ["cycling:3", "work:2", "uni:1"]);
const undone = await page.evaluate(() => { document.querySelector('[data-action="undo"]').click(); return true; });
await wait(400);
eq("undo puts the tags back", await page.evaluate((i) => window.__ORBIT_TAGS__(i), id("Mia Wong")), []);
await page.evaluate((i) => window.__ORBIT_SETTAGS__(i, "work"), id("Mia Wong"));
await wait(200);
eq("clearing every tag removes the attribute", await page.evaluate((i) => window.__ORBIT_SETTAGS__(i, ""), id("Mia Wong")), []);

console.log("\n[search reads tags]");
await page.evaluate(() => { const s = document.querySelector("#network-search"); s.value = "cycling"; s.dispatchEvent(new Event("input", { bubbles: true })); });
await wait(400);
assert("searching a tag narrows the chart to its people", (await visibleNodes()) === 6 && (await page.evaluate(() => window.__ORBIT_VISIBLE__())) === 2, String(await page.evaluate(() => window.__ORBIT_VISIBLE__())));
await page.evaluate(() => { const s = document.querySelector("#network-search"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); });
await wait(300);

console.log("\n[the by-tag layout]");
await page.evaluate(() => window.__ORBIT_SETLAYOUT__("tags"));
await wait(700);
assert("the layout is selectable", (await page.evaluate(() => window.__ORBIT_LAYOUT__())) === "tags");
const positions = await page.evaluate((a, b, c) => ({
  alex: window.__ORBIT_POS__(a), tom: window.__ORBIT_POS__(b), priya: window.__ORBIT_POS__(c)
}), id("Alex Morgan"), id("Tom Baker"), id("Priya Patel"));
const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
assert("people sharing a tag cluster together", gap(positions.alex, positions.tom) < gap(positions.alex, positions.priya),
  "cycling pair " + Math.round(gap(positions.alex, positions.tom)) + " vs cross-tag " + Math.round(gap(positions.alex, positions.priya)));
await page.evaluate(() => window.__ORBIT_SETLAYOUT__("orbit"));
await wait(500);

console.log("\n[an address is not a person]");
const glyph = await page.evaluate((i) => window.__ORBIT_ICON_USED__(i), id("sales"));
assert("an address-only contact renders as an envelope", glyph === "mail", String(glyph));
const personGlyph = await page.evaluate((i) => window.__ORBIT_ICON_USED__(i), id("Alex Morgan"));
assert("a named person still renders as a person", personGlyph === "person", String(personGlyph));

assert("no uncaught errors", errors.length === 0, errors.join(" | "));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
await browser.close();
process.exit(failed ? 1 : 0);
