/* You-as-an-entity tests: your own node is a person record like any other —
 * openable, selectable, cyclable and a valid merge target — while staying the
 * centre of the chart, uncountable as a contact and impossible to delete.
 * Runs against the live preview on :4173.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const id = (n) => "E:person|" + n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ME = "personal-network:me";
const NAMES = ["Alex Morgan", "Priya Patel", "Tom Baker"];

/* A duplicate of the account holder, as a Google import would deliver it. */
function seed() {
  const person = (name, attrs) => { const e = id(name); return { id: e, type: "person", label: name, identity: name, contribs: ["ent:" + e], attrs: Object.assign({ entityKind: "individual", strength: 45 }, attrs), source: "manual", createdBy: "personal-network", ts: 1 }; };
  const ents = NAMES.map((n) => person(n, {})).concat([
    person("Ben Wilson", { email: "ben.other@example.com", phone: "07700 900999", website: "https://ben.example.com", note: "My own contact card from Google" })
  ]);
  const L = (a, b) => ({ id: "L:" + a + b, from: a, to: b, type: "KNOWS", source: "manual", createdBy: "personal-network", contrib: "rel:" + [a, b].sort().join("|"), ts: 1, attrs: {} });
  return { schema: "orbit.case.v1", name: "Demo", updated: 1, entities: ents, links: [L(ME, id("Tom Baker")), L(id("Ben Wilson"), id("Alex Morgan"))] };
}

async function boot() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => { if (/supabase-config\.js/.test(req.url())) req.respond({ status: 200, contentType: "text/javascript", body: "window.ORBIT_SUPABASE_CONFIG = {};" }); else req.continue(); });
  await page.evaluateOnNewDocument((caseJson) => {
    const backing = new Map();
    const s = { getItem: (k) => backing.has(String(k)) ? backing.get(String(k)) : null, setItem: (k, v) => backing.set(String(k), String(v)), removeItem: (k) => backing.delete(String(k)), clear: () => backing.clear(), key: (i) => [...backing.keys()][i] ?? null, get length() { return backing.size; } };
    Object.defineProperty(window, "localStorage", { value: s, configurable: true });
    const iso = "2026-08-01T12:00:00.000Z";
    localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "acct_demo", name: "Ben", email: "ben@orbit.test", profile: { phone: "07700 900111" }, salt: "s", hash: "h", createdAt: iso, lastSignIn: iso }]));
    localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "acct_demo", signedInAt: iso }));
    localStorage.setItem("orbit_case_v1", caseJson);
  }, JSON.stringify(seed()));
  await page.setViewport({ width: 1360, height: 840 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2200));
  if (!(await page.evaluate(() => typeof window.__ORBIT_ATTRS__ === "function"))) { await browser.close(); return null; }
  const box = await page.evaluate(() => { const r = document.querySelector("#network").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  return { browser, page, box, errors };
}

let ctx = null;
for (let i = 0; i < 4 && !ctx; i++) { ctx = await boot(); if (!ctx) console.log("retry " + (i + 1)); }
if (!ctx) { console.log("FAILED to seed after retries"); process.exit(1); }
const { browser, page, box, errors } = ctx;

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const attrsOf = (pid) => page.evaluate((i) => window.__ORBIT_ATTRS__(i), pid);
const dossier = () => page.evaluate(() => ({ hidden: document.querySelector("#person-dossier").hidden, name: document.querySelector("#person-dossier h2").textContent.trim() }));

console.log("\n[you are a record]");
const me = await attrsOf(ME);
assert("your record exists in the vault", !!me, JSON.stringify(me));
assert("it is projected from the account profile", me && me.phone === "07700 900111", JSON.stringify(me));
assert("carrying the account email", me && me.email === "ben@orbit.test", JSON.stringify(me));
assert("the people count excludes you", (await page.evaluate(() => window.__ORBIT_PEOPLE__())) === 4, String(await page.evaluate(() => window.__ORBIT_PEOPLE__())));
assert("the toolbar count excludes you", (await page.evaluate(() => document.querySelector("#toolbar-count").textContent)).startsWith("4 people"), await page.evaluate(() => document.querySelector("#toolbar-count").textContent));

/* One node, not two: the centre node and a person node would share an id. */
const nodeCount = await page.evaluate((m) => { try { return window.__ORBIT_NODEAT__(m) === m ? 1 : 0; } catch (e) { return "err"; } }, ME);
assert("your node is on the chart exactly once", nodeCount === 1, String(nodeCount));

console.log("\n[you open like anyone else]");
const meDom = await page.evaluate((m) => window.__ORBIT_NODE_DOM__(m), ME);
await page.mouse.click(box.x + meDom.x, box.y + meDom.y);
await wait(500);
const opened = await dossier();
assert("clicking your node opens your profile", !opened.hidden && opened.name === "Ben", JSON.stringify(opened));
assert("and selects you", (await page.evaluate(() => window.__ORBIT_SELECTED__())) === ME);
assert("the profile hides Delete on your record", await page.evaluate(() => document.querySelector('[data-action="delete-contact"]').hidden));
assert("and offers Edit my details", (await page.evaluate(() => document.querySelector('[data-action="edit-person"]').textContent)) === "Edit my details");

const menu = await page.evaluate((m) => {
  const d = window.__ORBIT_NODE_DOM__(m), r = document.querySelector("#network").getBoundingClientRect();
  document.querySelector("#network canvas").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + d.x, clientY: r.top + d.y }));
  return [...document.querySelectorAll(".ctx-item")].map((n) => n.textContent);
}, ME);
assert("right-click gives you the contact menu", menu.includes("Open my profile") && menu.includes("Edit my details…"), JSON.stringify(menu));
assert("without a delete", !menu.some((m) => /Delete/.test(m)), JSON.stringify(menu));
assert("and without ring pinning", !menu.some((m) => /Pin to/.test(m)), JSON.stringify(menu));
assert("but keeping the chart controls", menu.some((m) => /Fit chart/.test(m)), JSON.stringify(menu));
await page.evaluate(() => document.body.click());

console.log("\n[merging a duplicate of you into your record]");
const dupe = id("Ben Wilson");
await page.evaluate((m, d) => window.__ORBIT_MERGE__(m, d), ME, dupe);
await wait(600);
const merged = await attrsOf(ME);
assert("your own phone stands", /900111/.test(merged.phone), merged.phone);
assert("their phone joins it", /900999/.test(merged.phone), merged.phone);
assert("both emails kept", /ben@orbit\.test/.test(merged.email) && /ben\.other@example\.com/.test(merged.email), merged.email);
assert("their website carried over", merged.website === "https://ben.example.com", merged.website);
assert("their note carried over", /own contact card/.test(String(merged.note)), merged.note);
assert("the duplicate is gone", (await page.evaluate(() => window.__ORBIT_PEOPLE__())) === 3, String(await page.evaluate(() => window.__ORBIT_PEOPLE__())));
const neighbours = await page.evaluate((m) => window.__ORBIT_NEIGHBOURS__(m), ME);
assert("their relationship became yours (Alex Morgan)", neighbours.includes("Alex Morgan"), JSON.stringify(neighbours));
assert("your profile is the one left open", (await dossier()).name === "Ben", JSON.stringify(await dossier()));

console.log("\n[you cannot be merged away]");
await page.evaluate((m, t) => window.__ORBIT_MERGE__(t, m), ME, id("Tom Baker"));
await wait(400);
assert("merging you INTO someone is refused", !!(await attrsOf(ME)), "your record vanished");
assert("and says why", (await page.evaluate(() => document.querySelector("#sync-status").textContent)).includes("CANNOT BE MERGED AWAY"));

assert("no uncaught errors", errors.length === 0, errors.join(" | "));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
await browser.close();
process.exit(failed ? 1 : 0);
