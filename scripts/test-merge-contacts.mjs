/* Merge tests: Ctrl-click builds a two-person selection, the right-click menu
 * offers the merge in both directions, and merging carries every unique
 * credential, relationship and record onto the surviving profile. Undo puts it
 * all back. Runs against the live preview on :4173.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const id = (n) => "E:person|" + n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ME = "personal-network:me";

/* Two records for the same person plus two others, so links and facts on the
 * absorbed record have somewhere to be re-parented from. */
function seed() {
  const person = (name, attrs) => { const e = id(name); return { id: e, type: "person", label: name, identity: name, contribs: ["ent:" + e], attrs: Object.assign({ entityKind: "individual", strength: 45 }, attrs), source: "manual", createdBy: "personal-network", ts: 1 }; };
  const ents = [
    person("Tom Baker", { email: "tom@work.com", phone: "07700 900111", organisation: "Acme", note: "Met at the conference" }),
    person("Tommy Baker", { email: "tom.baker@home.com", phone: "07700 900222", location: "Bristol", note: "Runs the cycling club", address: "12 Hill Road" }),
    person("Alex Morgan", {}),
    person("Priya Patel", {})
  ];
  const L = (a, b, type = "KNOWS") => ({ id: "L:" + type + a + b, from: a, to: b, type, source: "manual", createdBy: "personal-network", contrib: "rel:" + [a, b].sort().join("|"), ts: 1, attrs: {} });
  const fact = {
    id: "F:tommy-note", type: "fact", label: "Contact note", identity: "tommy-note",
    contribs: ["ent:" + id("Tommy Baker")], source: "manual", createdBy: "personal-network", ts: 1,
    attrs: { factType: "contact_note", value: "Cycling club on Sundays", observedAt: "2026-07-01T12:00:00.000Z", validFrom: "2026-07-01T12:00:00.000Z" }
  };
  const links = [
    L(ME, id("Tom Baker")),
    L(id("Tom Baker"), id("Alex Morgan")),
    L(id("Tommy Baker"), id("Priya Patel")),
    L(id("Tommy Baker"), id("Tom Baker")),
    { id: "L:ABOUT", from: id("Tommy Baker"), to: "F:tommy-note", type: "ABOUT", source: "manual", createdBy: "personal-network", contrib: "ent:" + id("Tommy Baker"), ts: 1, attrs: {} }
  ];
  return { schema: "orbit.case.v1", name: "Demo", updated: 1, entities: ents.concat([fact]), links };
}

async function run() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
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
  await new Promise((r) => setTimeout(r, 2000));
  if (!(await page.evaluate(() => typeof window.__ORBIT_MERGE__ === "function"))) { await browser.close(); return null; }
  return { browser, page, dialogs };
}

let ctx = null;
for (let i = 0; i < 4 && !ctx; i++) { ctx = await run(); if (!ctx) console.log("retry " + (i + 1)); }
if (!ctx) { console.log("FAILED to seed after retries"); process.exit(1); }
const { browser, page, dialogs } = ctx;

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const people = () => page.evaluate(() => window.__ORBIT_PEOPLE__());
const attrsOf = (pid) => page.evaluate((i) => window.__ORBIT_ATTRS__(i), pid);
const profileOf = (pid) => page.evaluate((i) => window.__ORBIT_PROFILE__(i), pid);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const TOM = id("Tom Baker"), TOMMY = id("Tommy Baker"), ALEX = id("Alex Morgan"), PRIYA = id("Priya Patel");

console.log("\n[selection]");
assert("seeded 4 people", (await people()) === 4, String(await people()));
let picked = await page.evaluate((a) => window.__ORBIT_TOGGLE__(a), TOM);
picked = await page.evaluate((b) => window.__ORBIT_TOGGLE__(b), TOMMY);
assert("ctrl-click selects two", picked.length === 2, JSON.stringify(picked));
assert("status offers the merge", (await page.evaluate(() => document.querySelector("#sync-status").textContent)).includes("RIGHT-CLICK TO MERGE"));

console.log("\n[right-click menu]");
const menu = await page.evaluate((pid) => {
  const dom = window.__ORBIT_NODE_DOM__(pid);
  const r = document.querySelector("#network").getBoundingClientRect();
  window.dispatchEvent(new Event("noop"));
  const ev = new MouseEvent("contextmenu", { bubbles: true, clientX: r.left + dom.x, clientY: r.top + dom.y });
  document.querySelector("#network canvas").dispatchEvent(ev);
  return [...document.querySelectorAll(".ctx-item")].map((n) => n.textContent);
}, TOM);
assert("menu offers both directions", menu.includes("Merge Tommy Baker into Tom Baker") && menu.includes("Merge Tom Baker into Tommy Baker"), JSON.stringify(menu.slice(0, 4)));
await page.evaluate(() => document.body.click());

console.log("\n[merge]");
await page.evaluate((a, b) => window.__ORBIT_MERGE__(a, b), TOM, TOMMY);
await wait(400);
assert("no confirm dialog", dialogs.length === 0, JSON.stringify(dialogs));
assert("one person fewer", (await people()) === 3, String(await people()));
assert("survivor is selected", (await page.evaluate(() => window.__ORBIT_SELECTED__())) === TOM);
assert("survivor profile is open", (await page.evaluate(() => document.querySelector("#person-dossier h2").textContent.trim())) === "Tom Baker");

const a = await attrsOf(TOM);
assert("both emails kept", /tom@work\.com/.test(a.email) && /tom\.baker@home\.com/.test(a.email), a.email);
assert("both phones kept", /900111/.test(a.phone) && /900222/.test(a.phone), a.phone);
assert("survivor's organisation stands", a.organisation === "Acme", a.organisation);
assert("empty field filled from absorbed", a.location === "Bristol", a.location);
assert("address carried over", a.address === "12 Hill Road", a.address);
assert("notes appended", /conference/.test(a.note) && /cycling club/i.test(a.note), a.note);
assert("alias recorded", /Also known as Tommy Baker/.test(a.note), a.note);

const prof = await profileOf(TOM);
const chips = prof.header.contactMethods.map((m) => m.kind + ":" + m.value);
assert("emails render as two chips", chips.filter((c) => c.startsWith("email:")).length === 2, JSON.stringify(chips));
assert("phones render as two chips", chips.filter((c) => c.startsWith("phone:")).length === 2, JSON.stringify(chips));

const related = await page.evaluate((i) => window.__ORBIT_NEIGHBOURS__(i), TOM);
const relatedJson = JSON.stringify(related);
assert("absorbed relationship re-pointed (Priya)", related.includes("Priya Patel"), relatedJson);
assert("survivor keeps its own relationship (Alex)", related.includes("Alex Morgan"), relatedJson);
assert("no self-link left behind", !/Tommy/.test(relatedJson), relatedJson);
assert("absorbed fact re-parented", JSON.stringify(prof.facts || []).includes("Cycling club on Sundays"), JSON.stringify((prof.facts || []).map((f) => f.value)));

console.log("\n[bin + undo]");
const bin = await page.evaluate(() => window.__ORBIT_TRASH__());
assert("absorbed record is in the bin", bin.some((r) => r.label === "Tommy Baker"), JSON.stringify(bin));
assert("binned without its links", bin.filter((r) => r.label === "Tommy Baker").every((r) => r.links === 0), JSON.stringify(bin));

await page.evaluate(() => document.querySelector('[data-action="undo"]').click());
await wait(400);
assert("undo restores both people", (await people()) === 4, String(await people()));
const undone = await attrsOf(TOM);
assert("undo restores the original email", undone.email === "tom@work.com", undone.email);
assert("undo restores the original note", undone.note === "Met at the conference", undone.note);

assert("no uncaught errors", errors.length === 0, errors.join(" | "));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
await browser.close();
process.exit(failed ? 1 : 0);
