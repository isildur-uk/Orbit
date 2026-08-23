/* Reading a Gmail Takeout mailbox: headers only, last twelve months only,
 * nothing uploaded and no message body touched. The parser is asserted in Node;
 * the import, the counters and the clickable timeline run in the browser.
 */
import puppeteer from "puppeteer-core";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = join(HERE, "..", "src", "personal-network");
await import(pathToFileURL(join(BASE, "mbox.js")).href);
const M = globalThis.OrbitMbox;

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const ME = "personal-network:me";

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const eq = (n, a, b) => assert(n, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + " vs " + JSON.stringify(b));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY).toUTCString();
function message(n, from, to, subject, daysAgo, body) {
  return [
    "From " + n + " Mon Jan 01 00:00:00 +0000 2024",
    "From: " + from,
    "To: " + to,
    "Subject: " + subject,
    "Message-ID: <m" + n + "@mail>",
    "Date: " + ago(daysAgo),
    "",
    body || "A body that must never be read.",
    ""
  ].join("\n");
}
/* Katie: four exchanges this year. Tom: one, cc'd. Old Friend: over a year ago.
 * A note to yourself, and an automated sender. */
const MBOX = [
  message(1, "Katie Rose <kate@example.com>", "me@orbit.test", "Lunch on Thursday?", 40),
  message(2, "me@orbit.test", "Katie Rose <kate@example.com>", "Re: Lunch on Thursday?", 39),
  message(3, "Katie Rose <kate@example.com>", "me@orbit.test", "Photos from the weekend", 12,
    "From now on, a body line starting with From must not split this message."),
  message(4, "me@orbit.test", "Katie Rose <kate@example.com>, Tom <tom@example.com>", "Plans", 5),
  message(5, "Old Friend <old@example.com>", "me@orbit.test", "Long time", 500),
  message(6, "me@orbit.test", "me@orbit.test", "Note to self", 2)
].join("");

console.log("\n[reading the mailbox]");
const now = Date.now();
const summary = M.summarise(MBOX, { mine: ["me@orbit.test"], since: now - 365 * DAY, keepRecent: 5 });
const by = {};
summary.people.forEach((r) => { by[r.email] = r; });
eq("six messages read", summary.counts.read, 6);
eq("anything older than a year is left out", summary.counts.skippedOld, 1);
eq("a message only to yourself is not a correspondence", summary.counts.skippedNoParty, 1);
eq("the correspondents found", Object.keys(by).sort(), ["kate@example.com", "tom@example.com"]);
eq("Katie's messages are counted both ways", [by["kate@example.com"].total, by["kate@example.com"].received, by["kate@example.com"].sent], [4, 2, 2]);
eq("her name came off the header", by["kate@example.com"].name, "Katie Rose");
eq("a body line starting with From did not split a message", by["kate@example.com"].recent.length, 4);
assert("every kept message links back to Gmail", by["kate@example.com"].recent.every((m) => /rfc822msgid:/.test(m.link)), JSON.stringify(by["kate@example.com"].recent[0]));
eq("someone only ever cc'd is still a correspondent", by["tom@example.com"].total, 1);

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
    localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "a", name: "Ben", email: "me@orbit.test", profile: {}, salt: "s", hash: "h", createdAt: t, lastSignIn: t }]));
    localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "a", signedInAt: t }));
    localStorage.setItem("orbit_case_v1", JSON.stringify({ schema: "orbit.case.v1", name: "D", updated: 1, entities: [], links: [] }));
  });
  await page.setViewport({ width: 1400, height: 880 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await wait(2200);
  if (!(await page.evaluate(() => typeof window.__ORBIT_MAILBOX__ === "function"))) { await browser.close(); return null; }
  return { browser, page, errors };
}

let ctx = null;
for (let i = 0; i < 4 && !ctx; i++) { ctx = await boot(); if (!ctx) console.log("retry " + (i + 1)); }
if (!ctx) { console.log("FAILED to seed after retries"); process.exit(1); }
const { browser, page, errors } = ctx;
const kateId = () => page.evaluate(() => window.__ORBIT_BYEMAIL__("kate@example.com"));

console.log("\n[bringing it into the network]");
const stats = await page.evaluate((text) => window.__ORBIT_MAILBOX__(text, "All mail.mbox"), MBOX);
eq("the review knows what it found", stats, { people: 2, kept: 4, old: 1 });
const preview = await page.evaluate(() => document.querySelector("#import-summary").textContent);
assert("and says so before anything is merged", /4 messages/.test(preview) && /2 correspondents/.test(preview), JSON.stringify(preview));
assert("and is explicit that nothing was uploaded", /no message body was read/i.test(preview), JSON.stringify(preview));
await page.evaluate(() => document.querySelector('[data-action="merge-import"]').click());
await wait(1500);
eq("a contact per correspondent", await page.evaluate(() => window.__ORBIT_PEOPLE__()), 2);

const kate = await kateId();
assert("Katie is in the network by her address", !!kate, String(kate));
const mail = await page.evaluate((i) => window.__ORBIT_MAILSTATS__(i), kate);
eq("her real totals are kept, not just what is stored", [mail.total, mail.sent, mail.received], [4, 2, 2]);
assert("with the date of the last one", /^\d{4}-\d{2}-\d{2}/.test(mail.last), mail.last);

const timeline = await page.evaluate((i) => window.__ORBIT_TIMELINE__(i), kate);
eq("the recent messages are on her timeline", timeline.length, 4);
assert("each one opens the thread in Gmail", timeline.every((t) => /^https:\/\/mail\.google\.com\/.*rfc822msgid:/.test(t.link)), JSON.stringify(timeline[0]));
await page.evaluate((i) => window.__ORBIT_SELECT__(i), kate);
await wait(400);
const facts = await page.evaluate(() => document.querySelector("#dossier-facts").textContent.replace(/\s+/g, " "));
assert("the profile shows the email count", /Emails\s*4/.test(facts), JSON.stringify(facts));
assert("split by direction", /2 out, 2 in/.test(facts), JSON.stringify(facts));
assert("and the last one's date", /Last email/.test(facts), JSON.stringify(facts));
const rendered = await page.evaluate(() => {
  const tab = document.querySelector('[data-profile-tab="timeline"]');
  if (tab) tab.click();
  return document.querySelectorAll("#person-dossier .timeline-link").length;
});
assert("the timeline renders them as links", rendered > 0, String(rendered));

console.log("\n[what it means for the rest of Orbit]");
const cold = await page.evaluate(() => window.__ORBIT_COLD__());
const kateCold = cold.filter((c) => /kate/i.test(c.label) || /Katie/.test(c.label))[0];
assert("someone emailed five days ago is not overdue", !kateCold, JSON.stringify(cold.map((c) => c.label)));
await page.evaluate((text) => window.__ORBIT_MAILBOX__(text, "All mail.mbox"), MBOX);
await page.evaluate(() => document.querySelector('[data-action="merge-import"]').click());
await wait(1200);
eq("importing the same mailbox twice changes nothing", await page.evaluate(() => window.__ORBIT_PEOPLE__()), 2);
eq("and does not double the counts", (await page.evaluate((i) => window.__ORBIT_MAILSTATS__(i), kate)).total, 4);
eq("nor the timeline", (await page.evaluate((i) => window.__ORBIT_TIMELINE__(i), kate)).length, 4);

assert("no uncaught errors", errors.length === 0, errors.join(" | "));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
await browser.close();
process.exit(failed ? 1 : 0);
