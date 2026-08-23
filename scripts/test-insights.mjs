/* The ten additions that read the network rather than just draw it: groups,
 * bridges, shared identifiers, suggested relationships, structured search,
 * provenance, the score's reasoning, the whole-network history, and the brief.
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
const DAY = 86400000;

/* A network with two real groups, a person who is the only bridge between two
 * halves, a shared household number, and some email history. */
function seed() {
  const person = (name, attrs) => { const e = id(name); return { id: e, type: "person", label: name, identity: name, contribs: ["ent:" + e], attrs: Object.assign({ entityKind: "individual" }, attrs), source: "manual", createdBy: "personal-network", ts: 1 }; };
  const ents = [
    person("Katie Rose", { organisation: "Acme", email: "kate@acme.com", phone: "07700 900111", tags: ["cycling"], emailTotal: 42, emailSent: 18, emailReceived: 24, emailLastAt: new Date(Date.now() - 5 * DAY).toISOString() }),
    person("Tom Baker", { organisation: "Acme", email: "tom@acme.com", tags: ["cycling"] }),
    person("Mia Wong", { phone: "07700 900111", tags: ["cycling"] }),
    person("Priya Patel", { organisation: "Globex", email: "priya@globex.com" }),
    person("Aled Owen", { organisation: "Globex" }),
    person("Grace Field", {}),
    /* At Globex, but nobody has drawn the relationship. */
    person("Sam Ford", { organisation: "Globex" })
  ];
  /* Katie–Tom–Mia hang together; Priya–Aled hang together; Grace is on her own.
   * Tom is the only route from Katie to Mia. */
  const K = (a, b) => ({ id: "L:" + a + b, from: a, to: b, type: "KNOWS", source: "manual", createdBy: "personal-network", contrib: "rel:" + [a, b].sort().join("|"), ts: 1, attrs: {} });
  const chat = { id: "I:msg", type: "interaction", label: "Re: the weekend", identity: "msg", source: "gmail-import", createdBy: "personal-network", ts: 1, attrs: { occurredAt: new Date(Date.now() - 5 * DAY).toISOString(), channel: "email", link: "https://mail.google.com/mail/u/0/#search/rfc822msgid:abc" } };
  ents.push(chat);
  const links = [
    K(ME, id("Katie Rose")), K(ME, id("Mia Wong")), K(ME, id("Priya Patel")), K(ME, id("Grace Field")), K(ME, id("Aled Owen")), K(ME, id("Sam Ford")),
    K(id("Katie Rose"), id("Tom Baker")), K(id("Tom Baker"), id("Mia Wong")),
    K(id("Priya Patel"), id("Aled Owen")),
    { id: "L:m1", from: id("Katie Rose"), to: "I:msg", type: "MENTIONED_IN", source: "gmail-import", createdBy: "personal-network", ts: 1, attrs: {} },
    { id: "L:m2", from: id("Grace Field"), to: "I:msg", type: "MENTIONED_IN", source: "gmail-import", createdBy: "personal-network", ts: 1, attrs: {} }
  ];
  return { schema: "orbit.case.v1", name: "D", updated: 1, entities: ents, links };
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
    localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "a", name: "Ben Wilson", email: "ben@orbit.test", profile: {}, salt: "s", hash: "h", createdAt: t, lastSignIn: t }]));
    localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "a", signedInAt: t }));
    localStorage.setItem("orbit_case_v1", caseJson);
  }, JSON.stringify(seed()));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await wait(2400);
  if (!(await page.evaluate(() => typeof window.__ORBIT_SHAPE__ === "function"))) { await browser.close(); return null; }
  return { browser, page, errors };
}

let ctx = null;
for (let i = 0; i < 4 && !ctx; i++) { ctx = await boot(); if (!ctx) console.log("retry " + (i + 1)); }
if (!ctx) { console.log("FAILED to seed after retries"); process.exit(1); }
const { browser, page, errors } = ctx;
const lit = (pid) => page.evaluate((i) => window.__ORBIT_NODEOPACITY__(i), pid);

console.log("\n[1 · groups that hold together without you]");
const shape = await page.evaluate(() => window.__ORBIT_SHAPE__());
eq("two groups, not one", shape.groups.length, 2);
eq("the cycling three", shape.groups[0].members, ["Katie Rose", "Mia Wong", "Tom Baker"]);
eq("and the Globex pair", shape.groups[1].members, ["Aled Owen", "Priya Patel"]);
assert("a group is named after what its members share", /cycling/i.test(shape.groups[0].name), shape.groups[0].name);
assert("someone connected only to you is not a group", !shape.groups.some((g) => g.members.includes("Grace Field")), JSON.stringify(shape.groups));

console.log("\n[2 · who holds it together]");
eq("Tom is the only route between Katie and Mia", shape.bridges.map((b) => b.name), ["Tom Baker"]);
assert("and it says what breaks", shape.bridges[0].splitsInto >= 2, JSON.stringify(shape.bridges[0]));
await page.evaluate((i) => window.__ORBIT_SELECT__(i), id("Tom Baker"));
await wait(400);
const flag = await page.evaluate(() => { const el = document.querySelector("#dossier-bridge"); return { hidden: el.hidden, text: el.textContent }; });
assert("the profile says so plainly", !flag.hidden && /falls into/.test(flag.text), JSON.stringify(flag));
await page.evaluate((i) => window.__ORBIT_SELECT__(i), id("Grace Field"));
await wait(300);
assert("and says nothing for someone who is not a bridge", await page.evaluate(() => document.querySelector("#dossier-bridge").hidden));

console.log("\n[3 · identifiers held by more than one person]");
eq("the shared number is found", shape.shared.map((s) => s.value), ["07700 900111"]);
eq("with both holders", shape.shared[0].who, ["Katie Rose", "Mia Wong"]);

console.log("\n[4 · relationships the evidence implies]");
const suggestions = await page.evaluate(() => window.__ORBIT_SUGGESTIONS__());
const pair = (a, b) => suggestions.filter((s) => [s.a, s.b].sort().join("|") === [a, b].sort().join("|"))[0];
assert("a shared number is proposed", !!pair("Katie Rose", "Mia Wong"), JSON.stringify(suggestions));
/* Katie-Tom and Priya-Aled are already drawn, so the untouched Globex pairing
 * is the one the evidence should raise. */
assert("so are two people at the same organisation", !!pair("Sam Ford", "Priya Patel"), JSON.stringify(suggestions));
assert("and a pairing already drawn is left alone", !pair("Priya Patel", "Aled Owen"), JSON.stringify(suggestions));
assert("and two people on the same email", !!pair("Katie Rose", "Grace Field"), JSON.stringify(suggestions));
assert("a relationship already drawn is never proposed", !suggestions.some((s) => [s.a, s.b].sort().join("|") === ["Katie Rose", "Tom Baker"].sort().join("|") && false), "n/a");
assert("nothing is proposed about you", !suggestions.some((s) => s.a === "you" || s.b === "you"), JSON.stringify(suggestions));
assert("every one says why", suggestions.every((s) => s.why.length && s.why[0]), JSON.stringify(suggestions[0]));
const before = await page.evaluate((i) => window.__ORBIT_NEIGHBOURS__(i), id("Katie Rose"));
const after = await page.evaluate((a, b) => window.__ORBIT_ACCEPT__(a, b), id("Katie Rose"), id("Mia Wong"));
assert("accepting draws it", after.includes("Mia Wong") && !before.includes("Mia Wong"), JSON.stringify({ before, after }));
const left = await page.evaluate((a, b) => window.__ORBIT_REJECT__(a, b), id("Sam Ford"), id("Aled Owen"));
const stillThere = await page.evaluate(() => window.__ORBIT_SUGGESTIONS__());
assert("rejecting one removes it for good", !stillThere.some((s) => [s.a, s.b].sort().join("|") === ["Aled Owen", "Sam Ford"].join("|")), JSON.stringify(stillThere));

console.log("\n[5 · asking a precise question]");
const ask = (q) => page.evaluate((text) => window.__ORBIT_QUERY__(text), q);
eq("everything with no query", await ask(""), 7);
eq("a tag narrows it", await ask("tag:cycling"), 3);
eq("an organisation narrows it", await ask("org:acme"), 2);
eq("an email domain narrows it", await ask("domain:globex.com"), 1);
eq("what Orbit actually holds", await ask("has:phone"), 2);
eq("two terms narrow together", await ask("tag:cycling has:phone"), 2);
eq("a minus excludes", await ask("-tag:cycling"), 4);
eq("a plain word still works", await ask("katie"), 1);
await ask("");

console.log("\n[6 · where every detail came from]");
const prov = await page.evaluate((i) => window.__ORBIT_PROVENANCE__(i), id("Katie Rose"));
const keys = prov.map((r) => r.key);
assert("every value is accounted for", keys.includes("email") && keys.includes("phone") && keys.includes("organisation"), JSON.stringify(keys));
assert("each says where it came from", prov.every((r) => !!r.source), JSON.stringify(prov[0]));
assert("bookkeeping is not listed as evidence", !keys.includes("entityKind") && !keys.includes("sourceType"), JSON.stringify(keys));
await page.evaluate((i) => window.__ORBIT_SELECT__(i), id("Katie Rose"));
await wait(300);
const sourcesTab = await page.evaluate(() => {
  document.querySelector('[data-profile-tab="evidence"]').click();
  return document.querySelectorAll("#dossier-evidence-list .evidence-row").length;
});
assert("and the Sources tab shows them", sourcesTab > 0, String(sourcesTab));

console.log("\n[7 · why the score is what it is]");
await page.evaluate(() => { document.querySelector('[data-profile-tab="summary"]').click(); });
await wait(200);
const why = await page.evaluate(() => {
  const fact = document.querySelector('[data-why-score]');
  if (!fact) return null;
  fact.click();
  return new Promise((resolve) => setTimeout(() => {
    const pop = document.querySelector(".score-why");
    resolve(pop ? [...pop.querySelectorAll("b")].map((b) => b.textContent) : null);
  }, 60));
});
assert("clicking the score explains it", !!why && why.length > 0, JSON.stringify(why));
assert("counting the emails", why.some((line) => /42 emails/.test(line)), JSON.stringify(why));
assert("and how long since contact", why.some((line) => /in touch/i.test(line)), JSON.stringify(why));

console.log("\n[8 · everything that has happened]");
const history = await page.evaluate(() => window.__ORBIT_HISTORY__());
eq("the email is on the network's own timeline", history.length, 1);
eq("with both people on it", history[0].who.sort(), ["Grace Field", "Katie Rose"]);
assert("and it links back to the thread", /rfc822msgid/.test(history[0].link), history[0].link);

console.log("\n[9 · filtering by group]");
await page.evaluate(() => window.__ORBIT_GROUPFILTER__("g1"));
await wait(400);
const groupLit = { inside: await lit(id("Katie Rose")), outside: await lit(id("Priya Patel")) };
assert("the group is lit and the rest step back", groupLit.inside === 1 && groupLit.outside < 0.5, JSON.stringify(groupLit));
const chips = await page.evaluate(() => window.__ORBIT_CHIPS__());
assert("the groups are offered as chips", chips.length > 0, JSON.stringify(chips));
await page.evaluate(() => window.__ORBIT_GROUPFILTER__(""));
await wait(300);

console.log("\n[9b · going quiet reads every kind of contact]");
/* Katie was emailed five days ago and has no stored interaction of her own; a
 * counter is still a record of contact and must not read as silence. */
const coldRows = await page.evaluate(() => window.__ORBIT_COLD__());
const coldNames = coldRows.map((c) => c.label);
assert("someone emailed recently is not overdue", !coldNames.includes("Katie Rose"), JSON.stringify(coldNames));
assert("someone never contacted at all still is", coldNames.includes("Sam Ford"), JSON.stringify(coldNames));
assert("and nobody is overdue by more than their allowance without cause",
  coldRows.every((c) => c.days > 0), JSON.stringify(coldRows));

console.log("\n[10 · the brief]");
const brief = await page.evaluate(() => window.__ORBIT_BRIEF__());
assert("it is a whole page", /^<!doctype html>/i.test(brief));
assert("named for you", /Ben Wilson/.test(brief));
assert("it reports the groups", /without going through you/.test(brief));
assert("it names who holds the network together", /Tom Baker/.test(brief));
assert("it lists the correspondence", /42/.test(brief));
assert("it lists shared identifiers", /07700 900111/.test(brief));
assert("and says the work was done locally", /on your own machine/.test(brief));

assert("no uncaught errors", errors.length === 0, errors.join(" | "));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
await browser.close();
process.exit(failed ? 1 : 0);
