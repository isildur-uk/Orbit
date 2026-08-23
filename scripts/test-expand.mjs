/* Opening a person up: their handles, addresses and numbers drawn as their own
 * nodes hanging off them, without any of it being written to the vault.
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

/* Katie has been merged together from several sources: an address book entry,
 * an Instagram account and a couple of numbers. */
function seed() {
  const person = (name, attrs) => { const e = id(name); return { id: e, type: "person", label: name, identity: name, contribs: ["ent:" + e], attrs: Object.assign({ entityKind: "individual", strength: 50 }, attrs), source: "manual", createdBy: "personal-network", ts: 1 }; };
  const ents = [
    person("Katie Rose", {
      email: "kate@example.com, katie@work.com",
      phone: "07700 900111", whatsapp: "07700 900111",
      instagram: "kate_tollworthy", website: "https://katie.example.com",
      address: "12 Hill Road, Bristol"
    }),
    person("Tom Baker", {}),
    person("Mia Wong", { email: "mia@example.com" })
  ];
  const K = (a, b) => ({ id: "L:" + a + b, from: a, to: b, type: "KNOWS", source: "manual", createdBy: "personal-network", ts: 1, attrs: {} });
  return { schema: "orbit.case.v1", name: "D", updated: 1, entities: ents, links: [K(ME, id("Katie Rose")), K(id("Katie Rose"), id("Tom Baker"))] };
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
  await page.setViewport({ width: 1400, height: 880 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await wait(2200);
  if (!(await page.evaluate(() => typeof window.__ORBIT_EXPAND__ === "function"))) { await browser.close(); return null; }
  return { browser, page, errors };
}

let ctx = null;
for (let i = 0; i < 4 && !ctx; i++) { ctx = await boot(); if (!ctx) console.log("retry " + (i + 1)); }
if (!ctx) { console.log("FAILED to seed after retries"); process.exit(1); }
const { browser, page, errors } = ctx;
const KATIE = id("Katie Rose");
const people = () => page.evaluate(() => window.__ORBIT_PEOPLE__());
const nodeCount = () => page.evaluate(() => window.__ORBIT_NETWORK__().body.data.nodes.length);

console.log("\n[what a person is made of]");
const parts = await page.evaluate((i) => window.__ORBIT_DETAILS__(i), KATIE);
assert("both email addresses are separate parts", parts.filter((p) => /^Email\|/.test(p)).length === 2, JSON.stringify(parts));
assert("the Instagram handle is one", parts.some((p) => /kate_tollworthy/.test(p)), JSON.stringify(parts));
assert("and it carries its link", parts.some((p) => /kate_tollworthy\|https:\/\/instagram\.com\/kate_tollworthy/.test(p)), JSON.stringify(parts));
assert("an email part links to mail", parts.some((p) => /mailto:kate@example\.com/.test(p)), JSON.stringify(parts));
assert("a number links to the dialler", parts.some((p) => /tel:/.test(p)), JSON.stringify(parts));
assert("the address is a part too", parts.some((p) => /Hill Road/.test(p)), JSON.stringify(parts));

console.log("\n[expanding draws them, without storing them]");
const before = await nodeCount();
const vaultBefore = await page.evaluate(() => JSON.parse(window.localStorage.getItem("orbit_case_v1")).entities.length);
eq("nothing is expanded to start with", await page.evaluate((i) => window.__ORBIT_DETAILNODES__(i), KATIE), []);
eq("expanding marks the person", await page.evaluate((i) => window.__ORBIT_EXPAND__(i), KATIE), [KATIE]);
await wait(400);
const drawn = await page.evaluate((i) => window.__ORBIT_DETAILNODES__(i), KATIE);
eq("a node per part appears", drawn.length, parts.length);
assert("labelled with the value, not the field name", drawn.some((d) => /kate_tollworthy/.test(d)), JSON.stringify(drawn));
assert("the chart grew by exactly that many", (await nodeCount()) === before + parts.length, before + " -> " + (await nodeCount()));
eq("but the network still holds three people", await people(), 3);
const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("orbit_case_v1")).entities.length);
eq("and the vault gained nothing at all", stored, vaultBefore);

console.log("\n[the parts are not people]");
const cycled = await page.evaluate(() => { window.__ORBIT_SELECT__("E:person|katie rose"); return window.__ORBIT_CYCLE__(1); });
assert("stepping through contacts skips them", !/detail/.test(String(cycled)) && String(cycled).indexOf("E:person|") === 0, String(cycled));
const cold = await page.evaluate(() => window.__ORBIT_COLD__());
assert("the going-cold sweep ignores them", cold.every((c) => c.id.indexOf("E:person|") === 0), JSON.stringify(cold.map((c) => c.id)));
await page.evaluate((i) => window.__ORBIT_SELECT__(i), KATIE);
await wait(300);
eq("selecting still selects the person", await page.evaluate(() => window.__ORBIT_SELECTED__()), KATIE);

console.log("\n[collapsing]");
eq("collapsing unmarks them", await page.evaluate((i) => window.__ORBIT_EXPAND__(i), KATIE), []);
await wait(400);
eq("and the nodes are gone", await page.evaluate((i) => window.__ORBIT_DETAILNODES__(i), KATIE), []);
eq("leaving the chart as it was", await nodeCount(), before);
await page.evaluate((i) => window.__ORBIT_EXPAND__(i), KATIE);
await wait(300);
await page.keyboard.press("Escape");
await wait(400);
eq("Escape folds everything away", await page.evaluate((i) => window.__ORBIT_DETAILNODES__(i), KATIE), []);

console.log("\n[someone with nothing recorded]");
const empty = await page.evaluate((i) => window.__ORBIT_DETAILS__(i), id("Tom Baker"));
eq("has no parts", empty, []);
await page.evaluate((i) => window.__ORBIT_EXPAND__(i), id("Tom Baker"));
await wait(300);
eq("and expanding them draws nothing", await page.evaluate((i) => window.__ORBIT_DETAILNODES__(i), id("Tom Baker")), []);

assert("no uncaught errors", errors.length === 0, errors.join(" | "));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
await browser.close();
process.exit(failed ? 1 : 0);
