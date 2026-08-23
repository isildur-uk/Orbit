/* Profile pictures from a copied-as-HTML follower list, and the confidence bar
 * for merging two records that share only a first name.
 * The avatars in the fixture are inline data: images, so the whole pipeline —
 * parse, pair, downscale, store, draw — runs without touching the network.
 */
import puppeteer from "puppeteer-core";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = join(HERE, "..", "src", "personal-network");
await import(pathToFileURL(join(BASE, "classify.js")).href);
await import(pathToFileURL(join(BASE, "matching.js")).href);
await import(pathToFileURL(join(BASE, "importers.js")).href);
const I = globalThis.OrbitNetworkImporters, M = globalThis.OrbitContactMatching;

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const id = (n) => "E:person|" + n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ME = "personal-network:me";

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const eq = (n, a, b) => assert(n, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + " vs " + JSON.stringify(b));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* A 96x96 PNG, the size a real avatar arrives at. */
const RED = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAApklEQVR4nO3QQQ0AIBDAsJOEBPwLQA8O+LJHkwlYOmcvPZrvB/EAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIAAhQMECBAgQOEAAQIECFA4QIAAAQIUDhAgQIB+dgHcn9qkOPuDXwAAAABJRU5ErkJggg==";

/* What the clipboard actually holds when you copy the list: the avatar's alt
 * text names the account it belongs to. */
const AVATAR_HTML = `<div>
  <div><a href="/kate_tollworthy/"><img alt="kate_tollworthy&#039;s profile picture" src="${RED}"></a>
    <a href="/kate_tollworthy/"><span>kate_tollworthy</span></a><span>Katie Rose</span><button>Follow</button></div>
  <div><a href="/negeen000/"><img alt="negeen000&#039;s profile picture" src="${RED}"></a>
    <a href="/negeen000/"><span>negeen000</span></a><span>Negeen Arasteh</span></div>
  <div><a href="/____roseane_/"><img alt="____roseane_&#039;s profile picture" src="${RED}"></a>
    <a href="/____roseane_/"><span>____roseane_</span></a></div>
  <div><a href="/tombrimble_2/"><img alt="tombrimble_2&#039;s profile picture" src="${RED}"></a>
    <a href="/tombrimble_2/"><span>tombrimble_2</span></a><span>Tom</span></div>
  <div><a href="/no_avatar_acct/"><span>no_avatar_acct</span></a><span>No Picture</span></div>
  <div><a href="/iainjwilson/"><img alt="iainjwilson&#039;s profile picture" src="${RED}"></a>
    <a href="/iainjwilson/"><span>iainjwilson</span></a><span>Iain Wilson</span></div>
</div>`;

console.log("\n[reading the pictures out of the copied HTML]");
assert("HTML is recognised as HTML", I.looksLikeHtml(AVATAR_HTML));
const map = I.avatarMap(AVATAR_HTML);
eq("every avatar is paired to its account by name", Object.keys(map).sort(), ["____roseane_", "iainjwilson", "kate_tollworthy", "negeen000", "tombrimble_2"]);
assert("the address survives entity decoding", map["kate_tollworthy"] === RED, map["kate_tollworthy"].slice(0, 40));
const parsed = I.review(AVATAR_HTML, "benwlsn11_IG_Followers");
const byHandle = {};
parsed.candidates.forEach((c) => { byHandle[c.igHandle] = c; });
eq("every account is still found", Object.keys(byHandle).sort(), ["____roseane_", "iainjwilson", "kate_tollworthy", "negeen000", "no_avatar_acct", "tombrimble_2"]);
eq("the pairing is unchanged by the markup", byHandle["kate_tollworthy"].preferredName, "Katie Rose");
eq("an account with no display name still pairs", byHandle["____roseane_"].preferredName, "");
eq("and the one after it is not thrown off", byHandle["tombrimble_2"].preferredName, "Tom");
assert("accounts carry their picture address", byHandle["negeen000"].avatarUrl === RED, String(byHandle["negeen000"].avatarUrl).slice(0, 40));
assert("an account without one carries nothing", !byHandle["no_avatar_acct"].avatarUrl);
eq("the count is reported", parsed.avatarCount, 5);
eq("the direction still comes from the file name", byHandle["kate_tollworthy"].igDirection, "follower");

console.log("\n[a first name alone is not a person]");
const person = (n, a) => ({ id: n, label: n, attrs: a || {} });
assert("two Chrises with different details are kept apart",
  !M.matchAgainst({ name: "Chris", email: "chris@fitbod.me" }, [person("Chris", { phone: "07824 833000" })]));
assert("a full name still matches on its own",
  !!M.matchAgainst({ name: "Sarah Jones" }, [person("Sarah Jones", {})]));
const atWork = M.matchAgainst({ name: "Chris", organisation: "Acme" }, [person("Chris", { organisation: "Acme" })]);
assert("a first name at the same organisation does match", !!atWork, "no match");
eq("and says why", atWork && atWork.reason, "Same name at Acme");
assert("a first name with a shared phone still matches",
  !!M.matchAgainst({ name: "Chris", phone: "07824 833000" }, [person("Chris", { phone: "07824 833000" })]));
assert("the duplicate sweep will not propose first-name pairs",
  M.duplicatePairs([person("Chris", { email: "chris@fitbod.me" }), person("Chris", { phone: "07824 833000" })]).length === 0);

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
    const t = "2026-08-01T12:00:00.000Z";
    localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "a", name: "Ben", email: "ben@orbit.test", profile: {}, salt: "s", hash: "h", createdAt: t, lastSignIn: t }]));
    localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "a", signedInAt: t }));
    localStorage.setItem("orbit_case_v1", JSON.stringify({ schema: "orbit.case.v1", name: "D", updated: 1, entities: [], links: [] }));
  });
  await page.setViewport({ width: 1400, height: 880 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await wait(2200);
  if (!(await page.evaluate(() => typeof window.__ORBIT_PASTE__ === "function"))) { await browser.close(); return null; }
  return { browser, page, errors };
}

let ctx = null;
for (let i = 0; i < 4 && !ctx; i++) { ctx = await boot(); if (!ctx) console.log("retry " + (i + 1)); }
if (!ctx) { console.log("FAILED to seed after retries"); process.exit(1); }
const { browser, page, errors } = ctx;

console.log("\n[importing the list, pictures and all]");
const withPictures = await page.evaluate((html) => window.__ORBIT_PASTE__(html, "follower"), AVATAR_HTML);
eq("the review counts the pictures it found", withPictures, 5);
await page.evaluate(() => document.querySelector('[data-action="merge-import"]').click());
await wait(2500);
eq("everyone imported", await page.evaluate(() => window.__ORBIT_PEOPLE__()), 6);
const photo = await page.evaluate(() => window.__ORBIT_PHOTO__(window.__ORBIT_BYHANDLE__("kate_tollworthy")));
assert("the picture is stored inline, not as a link", /^data:image\//.test(String(photo)), String(photo).slice(0, 40));
assert("and it is small enough to keep hundreds of", photo.length < 4000, photo.length + " chars");
eq("an account with no picture keeps its glyph", await page.evaluate(() => window.__ORBIT_PHOTO__(window.__ORBIT_BYHANDLE__("no_avatar_acct"))), "");
assert("which is the social handle glyph", (await page.evaluate(() => window.__ORBIT_ICON_USED__(window.__ORBIT_BYHANDLE__("no_avatar_acct")))) === "social");
assert("the status reports what arrived", /PICTURE/.test(await page.evaluate(() => document.querySelector("#sync-status").textContent)), await page.evaluate(() => document.querySelector("#sync-status").textContent));

console.log("\n[re-importing backfills rather than duplicating]");
const again = await page.evaluate((html) => window.__ORBIT_PASTE__(html, "follower"), AVATAR_HTML);
await page.evaluate(() => document.querySelector('[data-action="merge-import"]').click());
await wait(2000);
eq("the same list does not create a second copy of anyone", await page.evaluate(() => window.__ORBIT_PEOPLE__()), 6);
assert("no uncaught errors", errors.length === 0, errors.join(" | "));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
await browser.close();
process.exit(failed ? 1 : 0);
