/* Importing an Instagram followers + following pair: the filename says whose
 * list it is, the handle becomes a link, and each account is joined to that
 * account with a mutual or one-way follow. Runs against the preview on :4173.
 */
import puppeteer from "puppeteer-core";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = join(HERE, "..", "src", "personal-network");
await import(pathToFileURL(join(BASE, "classify.js")).href);
await import(pathToFileURL(join(BASE, "importers.js")).href);
const I = globalThis.OrbitNetworkImporters;

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const ME = "personal-network:me";

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const eq = (n, a, b) => assert(n, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + " vs " + JSON.stringify(b));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* In both lists            → mutual follow
 * followers only           → them → Ben
 * following only           → Ben → them
 * ____roseane_ has no display name, which is the case that used to drift. */
const FOLLOWERS = [
  "kate_tollworthy", "Katie Rose",
  "tombrimble_2", "Tom",
  "pippasyddall", "Pippa Syddall",
  "negeen000", "Negeen Arasteh",
  "____roseane_",
  "iainjwilson", "Iain Wilson"
].join("\n");
const FOLLOWING = [
  "kate_tollworthy", "Katie Rose",
  "tombrimble_2", "Tom",
  "pippasyddall", "Pippa Syddall",
  "aled_owen", "Aled Owen",
  "simonavaipan", "Simona Vaipan",
  "tomwlsn", "tom 𓆈"
].join("\n");
const MUTUAL = 3, FOLLOWERS_ONLY = 3, FOLLOWING_ONLY = 3;
const TOTAL = MUTUAL + FOLLOWERS_ONLY + FOLLOWING_ONLY;

console.log("\n[the filename carries the owner and the direction]");
eq("owner and direction read from the name", I.handleListMeta("benwlsn11_IG_Followers"), { owner: "benwlsn11", direction: "follower" });
eq("the following list is read the other way", I.handleListMeta("benwlsn11_IG_Following"), { owner: "benwlsn11", direction: "following" });
eq("an official export name has no owner", I.handleListMeta("followers_1.json"), { owner: "", direction: "follower" });
eq("a handle with underscores survives", I.handleListMeta("liv._.sim_IG_Followers").owner, "liv._.sim");
const parsed = I.review(FOLLOWERS, "benwlsn11_IG_Followers").candidates;
eq("each account carries its handle, owner and direction", parsed[0].igHandle + "|" + parsed[0].igOwner + "|" + parsed[0].igDirection, "kate_tollworthy|benwlsn11|follower");
eq("the handle is stored bare, not as a URL", parsed[0].instagram, "kate_tollworthy");
eq("the display name is the contact's name", parsed[0].name, "Katie Rose");

async function boot() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.dismiss());
  await page.setRequestInterception(true);
  page.on("request", (req) => { if (/supabase-config\.js/.test(req.url())) req.respond({ status: 200, contentType: "text/javascript", body: "window.ORBIT_SUPABASE_CONFIG = {};" }); else req.continue(); });
  await page.evaluateOnNewDocument(() => {
    const backing = new Map();
    const s = { getItem: (k) => backing.has(String(k)) ? backing.get(String(k)) : null, setItem: (k, v) => backing.set(String(k), String(v)), removeItem: (k) => backing.delete(String(k)), clear: () => backing.clear(), key: (i) => [...backing.keys()][i] ?? null, get length() { return backing.size; } };
    Object.defineProperty(window, "localStorage", { value: s, configurable: true });
    const stamp = "2026-08-01T12:00:00.000Z";
    localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "acct_demo", name: "Ben", email: "ben@orbit.test", profile: {}, salt: "s", hash: "h", createdAt: stamp, lastSignIn: stamp }]));
    localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "acct_demo", signedInAt: stamp }));
    localStorage.setItem("orbit_case_v1", JSON.stringify({ schema: "orbit.case.v1", name: "Demo", updated: 1, entities: [], links: [] }));
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await wait(2200);
  if (!(await page.evaluate(() => typeof window.__ORBIT_FOLLOWS__ === "function"))) { await browser.close(); return null; }
  return { browser, page, errors };
}

let ctx = null;
for (let i = 0; i < 4 && !ctx; i++) { ctx = await boot(); if (!ctx) console.log("retry " + (i + 1)); }
if (!ctx) { console.log("FAILED to seed after retries"); process.exit(1); }
const { browser, page, errors } = ctx;

/* Drive the real review-and-merge path with both files at once. */
async function importFiles(files) {
  await page.evaluate((list) => {
    const dt = new DataTransfer();
    list.forEach((f) => dt.items.add(new File([f.body], f.name, { type: "text/plain" })));
    const input = document.querySelector("#contact-file");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, files);
  await wait(900);
  await page.evaluate(() => document.querySelector('[data-action="merge-import"]').click());
  await wait(900);
}

console.log("\n[importing both lists together]");
await importFiles([
  { name: "benwlsn11_IG_Followers", body: FOLLOWERS },
  { name: "benwlsn11_IG_Following", body: FOLLOWING }
]);
const people = await page.evaluate(() => window.__ORBIT_PEOPLE__());
assert("every account became a contact, counted once", people === TOTAL, String(people));
eq("the owner handle was learned onto your own record", await page.evaluate((m) => window.__ORBIT_HANDLE__(m), ME), "benwlsn11");

const follows = await page.evaluate(() => window.__ORBIT_FOLLOWS__());
const byPair = {};
follows.forEach((f) => { byPair[[f.from, f.to].sort().join("|")] = f; });
assert("one link per account, not two", follows.length === TOTAL, JSON.stringify(follows.map((f) => f.from + "->" + f.to + " " + f.label)));

console.log("\n[mutual versus one-way]");
const kate = byPair[["Katie Rose", "you"].sort().join("|")];
assert("in both lists is a mutual follow", kate && kate.label === "Mutual follow", JSON.stringify(kate));
assert("and carries both directions", kate && kate.attrs.igFollowsOwner === true && kate.attrs.igOwnerFollows === true, JSON.stringify(kate && kate.attrs));

const negeen = byPair[["Negeen Arasteh", "you"].sort().join("|")];
assert("a follower who is not followed back is one-way", negeen && negeen.label === "Follows", JSON.stringify(negeen));
eq("and the arrow runs from them to you", negeen && negeen.from + " → " + negeen.to, "Negeen Arasteh → you");
assert("recorded as following the owner only", negeen && negeen.attrs.igFollowsOwner === true && !negeen.attrs.igOwnerFollows, JSON.stringify(negeen && negeen.attrs));

const aled = byPair[["Aled Owen", "you"].sort().join("|")];
assert("someone you follow who does not follow back is one-way", aled && aled.label === "Follows", JSON.stringify(aled));
eq("and the arrow runs from you to them", aled && aled.from + " → " + aled.to, "you → Aled Owen");
assert("recorded as followed by the owner only", aled && aled.attrs.igOwnerFollows === true && !aled.attrs.igFollowsOwner, JSON.stringify(aled && aled.attrs));

console.log("\n[the handle is a link]");
const chip = await page.evaluate((h) => {
  window.__ORBIT_SELECT__(window.__ORBIT_BYHANDLE__(h));
  const nodes = [...document.querySelectorAll("#dossier-contact .contact-chip")];
  const hit = nodes.filter((n) => n.textContent.indexOf(h) !== -1)[0];
  return hit ? { tag: hit.tagName, href: hit.getAttribute("href"), text: hit.textContent.replace(/\s+/g, " ").trim() } : null;
}, "kate_tollworthy");
assert("the handle renders as a hyperlink", chip && chip.tag === "A", JSON.stringify(chip));
eq("pointing at the account", chip && chip.href, "https://instagram.com/kate_tollworthy");
assert("showing the handle, not the URL", chip && /kate_tollworthy/.test(chip.text) && !/https/.test(chip.text), JSON.stringify(chip));

console.log("\n[importing one list at a time reaches the same answer]");
const second = await boot();
if (!second) { console.log("  FAIL  second workspace"); failed++; }
else {
  const inner = second.page;
  async function importInto(p, files) {
    await p.evaluate((list) => {
      const dt = new DataTransfer();
      list.forEach((f) => dt.items.add(new File([f.body], f.name, { type: "text/plain" })));
      const input = document.querySelector("#contact-file");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, files);
    await wait(900);
    await p.evaluate(() => document.querySelector('[data-action="merge-import"]').click());
    await wait(900);
  }
  await importInto(inner, [{ name: "benwlsn11_IG_Following", body: FOLLOWING }]);
  const afterFirst = await inner.evaluate(() => window.__ORBIT_FOLLOWS__());
  assert("the first list alone gives one-way follows", afterFirst.length === MUTUAL + FOLLOWING_ONLY && afterFirst.every((f) => f.label === "Follows"), JSON.stringify(afterFirst.map((f) => f.label)));
  await importInto(inner, [{ name: "benwlsn11_IG_Followers", body: FOLLOWERS }]);
  const afterSecond = await inner.evaluate(() => window.__ORBIT_FOLLOWS__());
  const mutuals = afterSecond.filter((f) => f.label === "Mutual follow").length;
  assert("the second list upgrades the shared ones to mutual", mutuals === MUTUAL, JSON.stringify(afterSecond.map((f) => f.from + "->" + f.to + " " + f.label)));
  assert("without duplicating any link", afterSecond.length === TOTAL, String(afterSecond.length));
  await second.browser.close();
}

assert("no uncaught errors", errors.length === 0, errors.join(" | "));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
await browser.close();
process.exit(failed ? 1 : 0);
