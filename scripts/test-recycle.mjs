/* Recycle-bin tests: deleting is frictionless (no confirm dialog), moves the
 * person to a restorable bin persisted in localStorage, and restore brings them
 * (and their links) back. Runs against the live preview on :4173.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const id = (n) => "E:person|" + n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ME = "personal-network:me";

function seed() {
  const names = ["Alex Morgan", "Priya Patel", "Tom Baker", "Mia Wong", "Liam Murphy", "Grace Field"];
  const ents = names.map((n) => { const e = id(n); return { id: e, type: "person", label: n, identity: n, contribs: ["ent:" + e], attrs: { entityKind: "individual", strength: 45 }, source: "manual", createdBy: "personal-network", ts: 1 }; });
  const L = (a, b) => ({ id: "L:" + a + b, from: a, to: b, type: "KNOWS", source: "manual", createdBy: "personal-network", ts: 1, attrs: {} });
  const links = [L(ME, id("Tom Baker")), L(id("Alex Morgan"), id("Tom Baker")), L(id("Priya Patel"), id("Grace Field"))];
  return { schema: "orbit.case.v1", name: "Demo", updated: 1, entities: ents, links };
}

async function run() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); }); // if a confirm() ever fires, we record it (and the test fails)
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
  if (!(await page.evaluate(() => typeof window.__ORBIT_DELETE__ === "function"))) { await browser.close(); return null; }
  return { browser, page, dialogs };
}

let ctx = null;
for (let i = 0; i < 4 && !ctx; i++) { ctx = await run(); if (!ctx) console.log("retry " + (i + 1)); }
if (!ctx) { console.log("FAILED to seed after retries"); process.exit(1); }
const { browser, page, dialogs } = ctx;

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const people = () => page.evaluate(() => window.__ORBIT_PEOPLE__());
const trash = () => page.evaluate(() => window.__ORBIT_TRASH__());

console.log("\n[recycle bin]");
const before = await people();
assert("seeded 6 people", before === 6, String(before));

// Delete via the profile Delete button (the path that used to prompt).
await page.evaluate((i) => window.__ORBIT_SELECT__(i), id("Tom Baker"));
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => { const b = document.querySelector('[data-action="delete-contact"]'); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 300));
assert("delete shows NO confirm dialog", dialogs.length === 0, dialogs.join(" | "));
const afterDel = await people();
assert("person removed from the network", afterDel === 5, String(afterDel));
const bin = await trash();
assert("deleted person is in the recycle bin", bin.some((r) => r.label === "Tom Baker"), JSON.stringify(bin));
assert("their links were captured with them", bin.find((r) => r.label === "Tom Baker").links >= 1, JSON.stringify(bin));

// Bin persists in localStorage (survives a reload).
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("orbit_trash_v1") || "[]").length);
assert("recycle bin is persisted to localStorage", stored === bin.length && stored >= 1, String(stored));

// The bin button badge reflects the count.
const badge = await page.evaluate(() => (document.querySelector("#recycle-count") || {}).textContent);
assert("bin button shows the count badge", badge === String(bin.length), badge);

// Restore brings the person + links back.
const tid = bin.find((r) => r.label === "Tom Baker").tid;
const remaining = await page.evaluate((t) => window.__ORBIT_RESTORE__(t), tid);
await new Promise((r) => setTimeout(r, 300));
const afterRestore = await people();
assert("restore returns the person to the network", afterRestore === 6, String(afterRestore));
assert("restored item leaves the bin", remaining === bin.length - 1, String(remaining));

// A second delete via the QA hook also avoids any prompt.
await page.evaluate((i) => window.__ORBIT_DELETE__(i), id("Mia Wong"));
await new Promise((r) => setTimeout(r, 200));
assert("still no dialogs after a second delete", dialogs.length === 0, dialogs.join(" | "));
assert("second delete lands in the bin", (await trash()).some((r) => r.label === "Mia Wong"));

console.log("\n  " + passed + " passed, " + failed + " failed\n");
await browser.close();
process.exit(failed ? 1 : 0);
