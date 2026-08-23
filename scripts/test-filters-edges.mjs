/* Filtering by what Orbit actually holds on someone, deselecting by clicking
 * empty canvas, editing and pointing relationships, and a hover that says
 * something. Runs against the preview on :4173.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const id = (n) => "E:person|" + n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ME = "personal-network:me";

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const eq = (n, a, b) => assert(n, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + " vs " + JSON.stringify(b));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* One of each kind of record, so every chip has something to find. */
function seed() {
  const person = (name, attrs) => { const e = id(name); return { id: e, type: "person", label: name, identity: name, contribs: ["ent:" + e], attrs: Object.assign({ entityKind: "individual", strength: 45 }, attrs), source: "manual", createdBy: "personal-network", ts: 1 }; };
  const ents = [
    person("Alex Morgan", { email: "alex@example.com", phone: "07700 900111", tags: ["work"] }),
    person("Priya Patel", { phone: "07700 900222" }),
    person("kate_tollworthy", { entityKind: "social", instagram: "kate_tollworthy", preferredName: "Katie Rose" }),
    person("hello", { entityKind: "email", email: "hello@airfloband.co.uk" }),
    person("Acme Ltd", { entityKind: "organisation", email: "info@acme.com" }),
    person("Mia Wong", {})
  ];
  const K = (a, b) => ({ id: "L:" + a + b, from: a, to: b, type: "KNOWS", source: "manual", createdBy: "personal-network", contrib: "rel:" + [a, b].sort().join("|"), ts: 1, attrs: {} });
  const imported = { id: "L:imported", from: ME, to: id("Priya Patel"), type: "KNOWS", source: "csv-import", createdBy: "personal-network", ts: 1, attrs: { sourceType: "csv-import" } };
  return { schema: "orbit.case.v1", name: "Demo", updated: 1, entities: ents, links: [K(ME, id("Alex Morgan")), imported] };
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
    const t = "2026-08-01T12:00:00.000Z";
    localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "a", name: "Ben", email: "ben@orbit.test", profile: {}, salt: "s", hash: "h", createdAt: t, lastSignIn: t }]));
    localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "a", signedInAt: t }));
    localStorage.setItem("orbit_case_v1", caseJson);
  }, JSON.stringify(seed()));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await wait(2200);
  if (!(await page.evaluate(() => typeof window.__ORBIT_KINDFILTER__ === "function"))) { await browser.close(); return null; }
  const box = await page.evaluate(() => { const r = document.querySelector("#network").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  return { browser, page, errors, box };
}

let ctx = null;
for (let i = 0; i < 4 && !ctx; i++) { ctx = await boot(); if (!ctx) console.log("retry " + (i + 1)); }
if (!ctx) { console.log("FAILED to seed after retries"); process.exit(1); }
const { browser, page, errors, box } = ctx;
const lit = (pid) => page.evaluate((i) => window.__ORBIT_NODEOPACITY__(i), pid);

console.log("\n[filtering by what you hold on someone]");
const chips = await page.evaluate(() => window.__ORBIT_CHIPS__());
assert("the bar offers kind chips with counts", chips.some((c) => /^Email\s*\d/.test(c)) && chips.some((c) => /^Phone\s*\d/.test(c)) && chips.some((c) => /^Social\s*\d/.test(c)), JSON.stringify(chips));
assert("and the tags after them", chips.some((c) => /^work\s*\d/.test(c)), JSON.stringify(chips));
assert("a chip nobody matches is left out", !chips.some((c) => /^Photo/.test(c)), JSON.stringify(chips));

eq("clicking Email turns it on", await page.evaluate(() => window.__ORBIT_KINDFILTER__("email")), ["email"]);
const emailOn = { has: await lit(id("Alex Morgan")), hasnt: await lit(id("Mia Wong")) };
assert("people with an email stay lit, the rest fade", emailOn.has === 1 && emailOn.hasnt < 0.5, JSON.stringify(emailOn));
/* Two chips narrow together rather than widening. */
await page.evaluate(() => window.__ORBIT_KINDFILTER__("phone"));
const both = { emailAndPhone: await lit(id("Alex Morgan")), emailOnly: await lit(id("hello")) };
assert("a second chip narrows further", both.emailAndPhone === 1 && both.emailOnly < 0.5, JSON.stringify(both));
await page.evaluate(() => { window.__ORBIT_KINDFILTER__("email"); window.__ORBIT_KINDFILTER__("phone"); });
await wait(200);

eq("Social finds the handle records", await page.evaluate(() => window.__ORBIT_KINDFILTER__("social")), ["social"]);
const social = { handle: await lit(id("kate_tollworthy")), person: await lit(id("Mia Wong")) };
assert("only the social records are lit", social.handle === 1 && social.person < 0.5, JSON.stringify(social));
await page.evaluate(() => window.__ORBIT_KINDFILTER__("social"));
await wait(200);
await page.evaluate(() => window.__ORBIT_KINDFILTER__("bare"));
const bare = { nothing: await lit(id("Mia Wong")), something: await lit(id("Alex Morgan")) };
assert("No details finds the empty records", bare.nothing === 1 && bare.something < 0.5, JSON.stringify(bare));
await page.keyboard.press("Escape");
await wait(300);
eq("Escape clears the filter", await page.evaluate(() => window.__ORBIT_CHIPS__().length > 0 && document.querySelectorAll("#tag-bar .active").length), 0);

console.log("\n[a social handle is not a person]");
const socialTip = await page.evaluate((i) => window.__ORBIT_TOOLTIP__(i), id("kate_tollworthy"));
assert("the hover names the vanity label", /Katie Rose/.test(socialTip), JSON.stringify(socialTip));
assert("and says what the record is", /Social handle/.test(socialTip), JSON.stringify(socialTip));
const personTip = await page.evaluate((i) => window.__ORBIT_TOOLTIP__(i), id("Alex Morgan"));
assert("a person's hover counts their connections", /connection/.test(personTip), JSON.stringify(personTip));
assert("and never says \"person in your network\"", !/person in your network/i.test(personTip + socialTip), JSON.stringify(personTip));
await page.evaluate((i) => window.__ORBIT_SELECT__(i), id("kate_tollworthy"));
await wait(400);
eq("the profile leads with the username", await page.evaluate(() => document.querySelector("#dossier-name").textContent.trim()), "kate_tollworthy");
const sub = await page.evaluate(() => document.querySelector("#dossier-role").textContent);
assert("with the display name underneath", /Katie Rose/.test(sub) && /Social handle/.test(sub), JSON.stringify(sub));

console.log("\n[clicking empty canvas lets go]");
assert("someone is selected", (await page.evaluate(() => window.__ORBIT_SELECTED__())) !== "");
/* A point with neither a node nor an edge under it. */
const empty = await page.evaluate(() => window.__ORBIT_EMPTYPOINT__());
assert("found an empty spot on the canvas", !!empty, JSON.stringify(empty));
await page.mouse.click(empty.x, empty.y);
await wait(500);
eq("clicking empty canvas deselects", await page.evaluate(() => window.__ORBIT_SELECTED__()), "");
assert("and closes the profile", await page.evaluate(() => document.querySelector("#person-dossier").hidden));
/* A real box-select still works — it must not be swallowed by the same fix. */
await page.mouse.move(box.x + 20, box.y + 20);
await page.mouse.down();
await page.mouse.move(box.x + box.w - 20, box.y + box.h - 20, { steps: 8 });
await page.mouse.up();
await wait(400);
assert("dragging a box still selects", (await page.evaluate(() => window.__ORBIT_MULTI__())).length > 1);
await page.keyboard.press("Escape");
await wait(300);

console.log("\n[relationships can be described and pointed]");
const linkId = await page.evaluate((a, b) => window.__ORBIT_LINKID__(a, b), ME, id("Alex Morgan"));
assert("the manual relationship was found", !!linkId, String(linkId));
eq("a label can be set", await page.evaluate((l) => window.__ORBIT_SETLABEL__(l, "Colleague"), linkId), "Colleague");
await wait(200);
eq("and changed afterwards", await page.evaluate((l) => window.__ORBIT_SETLABEL__(l, "Former colleague"), linkId), "Former colleague");
await wait(200);
const menu = await page.evaluate((l) => window.__ORBIT_EDGEMENU__(l), linkId);
assert("the menu offers editing the existing label", menu.some((m) => /Edit label/.test(m)), JSON.stringify(menu));
assert("and pointing the arrow either way", menu.filter((m) => /^✓?\s*Point at /.test(m)).length === 2, JSON.stringify(menu));
/* An imported relationship can be described too, but not deleted. */
const importedMenu = await page.evaluate(() => window.__ORBIT_EDGEMENU__("L:imported"));
assert("an imported link can still be labelled", importedMenu.some((m) => /Custom label|Edit label/.test(m)), JSON.stringify(importedMenu));
assert("and pointed", importedMenu.some((m) => /Point at/.test(m)), JSON.stringify(importedMenu));
assert("but not deleted", !importedMenu.some((m) => /Delete relationship/.test(m)), JSON.stringify(importedMenu));

eq("an arrow can be pointed at one end", await page.evaluate((l, t) => window.__ORBIT_SETARROW__(l, t), linkId, id("Alex Morgan")), id("Alex Morgan"));
const drawn = await page.evaluate((l) => window.__ORBIT_EDGEARROWS__(l), linkId);
assert("and it is drawn that way", drawn && drawn.to && drawn.to.enabled === true && !drawn.from, JSON.stringify(drawn));
eq("pointing the other way flips it", await page.evaluate((l, t) => window.__ORBIT_SETARROW__(l, t), linkId, ME), ME);
const flipped = await page.evaluate((l) => window.__ORBIT_EDGEARROWS__(l), linkId);
assert("the arrowhead moves to the other end", flipped && flipped.from && flipped.from.enabled === true && !flipped.to, JSON.stringify(flipped));
eq("and it can be taken off again", await page.evaluate((l) => window.__ORBIT_SETARROW__(l, ""), linkId), "");
eq("leaving no arrowheads", await page.evaluate((l) => window.__ORBIT_EDGEARROWS__(l), linkId), null);

assert("no uncaught errors", errors.length === 0, errors.join(" | "));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
await browser.close();
process.exit(failed ? 1 : 0);
