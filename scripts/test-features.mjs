/* The five additions: the shortcuts card, bulk tagging a selection, the
 * duplicate sweep, the "how do I know them" chain, and the going-cold pass.
 * Pure logic is asserted in Node; everything else drives the preview on :4173.
 */
import puppeteer from "puppeteer-core";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = join(HERE, "..", "src", "personal-network");
await import(pathToFileURL(join(BASE, "classify.js")).href);
await import(pathToFileURL(join(BASE, "domain.js")).href);
await import(pathToFileURL(join(BASE, "matching.js")).href);
const D = globalThis.OrbitNetworkDomain, M = globalThis.OrbitContactMatching;

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const id = (n) => "E:person|" + n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ME = "personal-network:me";

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const eq = (n, a, b) => assert(n, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + " vs " + JSON.stringify(b));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("\n[pure logic]");
const L = (a, b) => ({ from: a, to: b });
eq("the chain takes the shortest route", D.shortestPath([L("me", "a"), L("a", "b"), L("b", "c"), L("me", "d"), L("d", "c")], "me", "c"), ["me", "d", "c"]);
eq("no route means no chain", D.shortestPath([L("me", "a")], "me", "z"), null);
eq("never contacted is overdue by the whole allowance", D.contactDebt("inner", null, Date.now()).days, 30);
eq("a closer ring goes cold sooner", D.COLD_AFTER_DAYS.inner < D.COLD_AFTER_DAYS.deep, true);
eq("a duplicate pair is reported once", M.duplicatePairs([
  { id: "1", label: "Tom Baker", attrs: { email: "t@x.com" } },
  { id: "2", label: "Tommy Baker", attrs: { email: "t@x.com" } }
]).length, 1);

/* A network with: a real duplicate, a chain three hops out, and people who
 * have gone quiet for very different lengths of time. */
const DAY = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
function seed() {
  const person = (name, attrs) => { const e = id(name); return { id: e, type: "person", label: name, identity: name, contribs: ["ent:" + e], attrs: Object.assign({ entityKind: "individual", strength: 45 }, attrs), source: "manual", createdBy: "personal-network", ts: 1 }; };
  const ents = [
    person("Alex Morgan", { ring: "inner", email: "alex@example.com" }),
    person("Priya Patel", { ring: "inner" }),
    person("Tom Baker", { ring: "outer" }),
    person("Mia Wong", { ring: "outer" }),
    person("Grace Field", { ring: "deep" }),
    person("Alexander Morgan", { email: "alex@example.com" })
  ];
  /* Alex spoke to you last week; Priya not for half a year; the rest never. */
  const chat = (key, daysAgo) => ({ id: "I:" + key, type: "interaction", label: "Call", identity: key, attrs: { occurredAt: iso(daysAgo), interactionType: "call" }, source: "manual", createdBy: "personal-network", ts: 1 });
  ents.push(chat("alex", 5), chat("priya", 180));
  const K = (a, b) => ({ id: "L:" + a + b, from: a, to: b, type: "KNOWS", source: "manual", createdBy: "personal-network", contrib: "rel:" + [a, b].sort().join("|"), ts: 1, attrs: {} });
  const links = [
    K(ME, id("Alex Morgan")),
    K(id("Alex Morgan"), id("Tom Baker")),
    K(id("Tom Baker"), id("Mia Wong")),
    K(ME, id("Priya Patel")),
    { id: "L:ia", from: id("Alex Morgan"), to: "I:alex", type: "MENTIONED_IN", source: "manual", createdBy: "personal-network", ts: 1, attrs: {} },
    { id: "L:ip", from: id("Priya Patel"), to: "I:priya", type: "MENTIONED_IN", source: "manual", createdBy: "personal-network", ts: 1, attrs: {} }
  ];
  return { schema: "orbit.case.v1", name: "Demo", updated: 1, entities: ents, links };
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
    const stamp = "2026-08-01T12:00:00.000Z";
    localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "acct_demo", name: "Ben", email: "ben@orbit.test", profile: {}, salt: "s", hash: "h", createdAt: stamp, lastSignIn: stamp }]));
    localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "acct_demo", signedInAt: stamp }));
    localStorage.setItem("orbit_case_v1", caseJson);
  }, JSON.stringify(seed()));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await wait(2200);
  if (!(await page.evaluate(() => typeof window.__ORBIT_COLD__ === "function"))) { await browser.close(); return null; }
  return { browser, page, errors };
}

let ctx = null;
for (let i = 0; i < 4 && !ctx; i++) { ctx = await boot(); if (!ctx) console.log("retry " + (i + 1)); }
if (!ctx) { console.log("FAILED to seed after retries"); process.exit(1); }
const { browser, page, errors } = ctx;
const hidden = (sel) => page.evaluate((s) => document.querySelector(s).hidden, sel);
const status = () => page.evaluate(() => document.querySelector("#sync-status").textContent);

console.log("\n[1 · shortcuts card]");
await page.keyboard.press("?");
await wait(400);
assert("? opens the card", !(await hidden("#shortcuts-modal")));
const groups = await page.evaluate(() => [...document.querySelectorAll("#shortcuts-body .shortcut-group h3")].map((n) => n.textContent));
assert("it covers every area", groups.length >= 4, JSON.stringify(groups));
const keys = await page.evaluate(() => [...document.querySelectorAll("#shortcuts-body kbd")].map((n) => n.textContent));
assert("it documents the gestures I had to explain by hand", ["Shift", "Ctrl", "Del", "←", "→"].every((k) => keys.includes(k)), JSON.stringify(keys));
await page.keyboard.press("Escape");
await wait(300);
assert("Escape closes it", await hidden("#shortcuts-modal"));
await page.evaluate(() => { const t = document.querySelector("#network-search"); t.focus(); t.value = "?"; });
await page.keyboard.press("?");
await wait(250);
assert("? typed into search does not open it", await hidden("#shortcuts-modal"));
await page.evaluate(() => { const t = document.querySelector("#network-search"); t.value = ""; t.blur(); t.dispatchEvent(new Event("input", { bubbles: true })); });
await wait(300);

console.log("\n[2 · tagging a whole selection]");
const three = [id("Alex Morgan"), id("Tom Baker"), id("Mia Wong")];
const tagged = await page.evaluate((ids) => window.__ORBIT_BULKTAG__(ids, "cycling"), three);
eq("every selected person gains the tag", tagged, [["cycling"], ["cycling"], ["cycling"]]);
const censusAfter = await page.evaluate(() => window.__ORBIT_TAGCENSUS__());
eq("the census counts them once each", censusAfter.map((c) => c.tag + ":" + c.count), ["cycling:3"]);
const untagged = await page.evaluate((ids) => window.__ORBIT_BULKTAG__(ids, "cycling"), three);
eq("tagging again removes it from all of them", untagged, [[], [], []]);
await page.evaluate((ids) => window.__ORBIT_BULKTAG__(ids, "cycling"), three);
await page.evaluate((one) => window.__ORBIT_SETTAGS__(one, ""), id("Tom Baker"));
const mixed = await page.evaluate((ids) => window.__ORBIT_BULKTAG__(ids, "cycling"), three);
eq("a mixed selection gains it rather than losing it", mixed, [["cycling"], ["cycling"], ["cycling"]]);
await page.evaluate((ids) => window.__ORBIT_BULKTAG__(ids, "cycling"), three);
await wait(200);

console.log("\n[3 · duplicate sweep]");
await page.evaluate(() => document.querySelector('[data-action="find-duplicates"]').click());
await wait(500);
assert("the sweep opens", !(await hidden("#dupes-modal")));
const found = await page.evaluate(() => window.__ORBIT_DUPES__());
assert("it finds the seeded duplicate and nothing else", found.length === 1, JSON.stringify(found));
assert("and explains itself", found[0] && found[0].reason === "Same email address", JSON.stringify(found));
const rows = await page.evaluate(() => document.querySelectorAll("#dupes-list .dupe-row").length);
assert("the pair is listed with both keep-directions", rows === 1 && (await page.evaluate(() => document.querySelectorAll("#dupes-list [data-merge-into]").length)) === 2, String(rows));
await page.evaluate(() => document.querySelector("#dupes-list [data-not-a]").click());
await wait(400);
eq("dismissing a pair removes it from the sweep", await page.evaluate(() => window.__ORBIT_DUPES__()), []);
await page.evaluate(() => document.querySelector('[data-action="reset-dupes"]').click());
await wait(400);
assert("restoring dismissed brings it back", (await page.evaluate(() => window.__ORBIT_DUPES__())).length === 1);
const before = await page.evaluate(() => window.__ORBIT_PEOPLE__());
await page.evaluate(() => document.querySelector("#dupes-list [data-merge-into]").click());
await wait(600);
assert("merging from the sweep removes one person", (await page.evaluate(() => window.__ORBIT_PEOPLE__())) === before - 1, before + " → " + (await page.evaluate(() => window.__ORBIT_PEOPLE__())));
eq("and the sweep is clean afterwards", await page.evaluate(() => window.__ORBIT_DUPES__()), []);
await page.evaluate(() => document.querySelector('[data-action="close-dupes"]').click());
await wait(300);

console.log("\n[4 · how do I know them]");
const chain = await page.evaluate((t) => window.__ORBIT_PATH__(t), id("Mia Wong"));
eq("the chain runs from you through the people between", chain, [ME, id("Alex Morgan"), id("Tom Baker"), id("Mia Wong")]);
assert("the strip names the chain", (await page.evaluate(() => document.querySelector("#path-strip-chain").textContent)).replace(/\s+/g, " ") === "You→Alex Morgan→Tom Baker→Mia Wong",
  await page.evaluate(() => document.querySelector("#path-strip-chain").textContent));
assert("it says how many people stand between", (await status()).includes("2 PEOPLE BETWEEN YOU"), await status());
const onChain = await page.evaluate((a, b) => ({ on: window.__ORBIT_NODEOPACITY__(a), off: window.__ORBIT_NODEOPACITY__(b) }), id("Tom Baker"), id("Grace Field"));
assert("people on the chain stay lit, the rest step back", onChain.on === 1 && onChain.off < 0.5, JSON.stringify(onChain));
await page.keyboard.press("Escape");
await wait(400);
assert("Escape clears the chain", await hidden("#path-strip"));
const direct = await page.evaluate((t) => window.__ORBIT_PATH__(t), id("Priya Patel"));
eq("someone you know yourself is a two-step chain", direct, [ME, id("Priya Patel")]);
assert("and is reported as direct", (await status()).includes("DIRECT"), await status());
await page.keyboard.press("Escape");
await wait(300);
const none = await page.evaluate((t) => window.__ORBIT_PATH__(t), id("Grace Field"));
eq("an unconnected person has no chain", none, null);
assert("and it says so rather than showing nothing", (await status()).includes("NO CHAIN"), await status());

console.log("\n[5 · going cold]");
/* The merge in section 3 left its survivor selected; clear that first, or a
 * selected person stays lit for the wrong reason. */
await page.keyboard.press("Escape");
await wait(400);
const cold = await page.evaluate(() => window.__ORBIT_COLD__());
const byName = Object.fromEntries(cold.map((c) => [c.label, c]));
assert("someone spoken to last week is not overdue", !byName["Alex Morgan"], JSON.stringify(cold.map((c) => c.label)));
assert("an inner-circle contact quiet for six months is", !!byName["Priya Patel"], JSON.stringify(cold.map((c) => c.label)));
assert("people never contacted are overdue by their allowance", byName["Tom Baker"] && byName["Tom Baker"].days === 120 && byName["Tom Baker"].ever === false, JSON.stringify(byName["Tom Baker"]));
assert("a deep-field contact gets a year before it counts", byName["Grace Field"] && byName["Grace Field"].days === 365, JSON.stringify(byName["Grace Field"]));
assert("worst first", cold[0] && cold[0].days >= cold[cold.length - 1].days, JSON.stringify(cold.map((c) => c.label + ":" + c.days)));
assert("the mode turns on", (await page.evaluate(() => window.__ORBIT_COLDMODE__())) === true);
assert("and names the worst offender", (await status()).includes("OVERDUE"), await status());
assert("the banner changes", (await page.evaluate(() => document.querySelector("#network-mode").textContent)) === "GOING COLD");
const litness = await page.evaluate((a, b) => ({ overdue: window.__ORBIT_NODEOPACITY__(a), fine: window.__ORBIT_NODEOPACITY__(b) }), id("Priya Patel"), id("Alex Morgan"));
assert("overdue people are lit, the rest step back", litness.overdue === 1 && litness.fine < 0.5, JSON.stringify(litness));
await page.keyboard.press("Escape");
await wait(400);
assert("Escape leaves the mode", (await page.evaluate(() => document.querySelector("#network-mode").textContent)) !== "GOING COLD");

console.log("\n[6 · renaming from the profile]");
await page.evaluate((t) => window.__ORBIT_SELECT__(t), id("Tom Baker"));
await wait(400);
const headingState = await page.evaluate(() => {
  const h = document.querySelector("#dossier-name");
  return { editable: h.getAttribute("contenteditable"), role: h.getAttribute("role"), text: h.textContent.trim() };
});
assert("the profile name is an editable field", headingState.editable === "plaintext-only" && headingState.role === "textbox", JSON.stringify(headingState));
eq("showing the current name", headingState.text, "Tom Baker");
/* Type into it the way a person would, then press Enter. */
await page.evaluate(() => { const h = document.querySelector("#dossier-name"); h.focus(); h.textContent = "Thomas Baker"; });
await page.keyboard.press("Enter");
await wait(500);
eq("Enter commits the new name", await page.evaluate((t) => window.__ORBIT_LABEL__(t), id("Tom Baker")), "Thomas Baker");
assert("the chart shows it too", (await page.evaluate(() => document.querySelector("#dossier-name").textContent.trim())) === "Thomas Baker");
/* Escape puts the old name back without saving. */
await page.evaluate(() => { const h = document.querySelector("#dossier-name"); h.focus(); h.textContent = "Nonsense"; });
await page.keyboard.press("Escape");
await wait(400);
eq("Escape abandons the edit", await page.evaluate((t) => window.__ORBIT_LABEL__(t), id("Tom Baker")), "Thomas Baker");
assert("and leaves the profile open rather than closing it", !(await page.evaluate(() => document.querySelector("#person-dossier").hidden)));
/* An empty name is not a name. */
await page.evaluate(() => { const h = document.querySelector("#dossier-name"); h.focus(); h.textContent = "   "; h.blur(); });
await wait(400);
eq("a blank name is refused", await page.evaluate((t) => window.__ORBIT_LABEL__(t), id("Tom Baker")), "Thomas Baker");
eq("and the field is put back", await page.evaluate(() => document.querySelector("#dossier-name").textContent.trim()), "Thomas Baker");
await page.evaluate(() => document.querySelector('[data-action="undo"]').click());
await wait(500);
eq("undo restores the original name", await page.evaluate((t) => window.__ORBIT_LABEL__(t), id("Tom Baker")), "Tom Baker");
/* Delete must not fire while a name is being typed. */
const peopleBefore = await page.evaluate(() => window.__ORBIT_PEOPLE__());
await page.evaluate(() => { const h = document.querySelector("#dossier-name"); h.focus(); });
await page.keyboard.press("Delete");
await wait(400);
eq("Delete typed into the name does not delete the contact", await page.evaluate(() => window.__ORBIT_PEOPLE__()), peopleBefore);
await page.evaluate(() => document.querySelector("#dossier-name").blur());
await wait(300);

assert("no uncaught errors", errors.length === 0, errors.join(" | "));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
await browser.close();
process.exit(failed ? 1 : 0);
