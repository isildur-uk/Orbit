/* Integration test for the layout switcher: drive setLayout through each
 * SOLAR-parity arrangement in a real vis-network canvas and confirm nodes are
 * actually repositioned (not left on the orbit rings), coordinates are finite,
 * and no errors are thrown. Runs against the live preview on :4173.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";

function seed() {
  const names = ["Alex Morgan", "Priya Patel", "Tom Baker", "Mia Wong", "Liam Murphy", "Grace Field", "Acme Corp"];
  const kinds = { "Acme Corp": "organisation" };
  const id = (n) => "E:person|" + n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const entities = names.map((name) => { const eid = id(name); return { id: eid, type: "person", label: name, identity: name, contribs: ["ent:" + eid], attrs: { entityKind: kinds[name] || "individual", strength: 45 }, source: "manual", createdBy: "personal-network", ts: 1 }; });
  const link = (a, b) => { const f = id(a), t = id(b); return { id: "L:" + f + "|" + t, from: f, to: t, type: "KNOWS", contribs: ["ent:" + f], source: "manual", createdBy: "personal-network", ts: 1, attrs: {} }; };
  const ME = "personal-network:me";
  const links = [
    { id: "L:me|a", from: ME, to: id("Alex Morgan"), type: "KNOWS", source: "manual", createdBy: "personal-network", ts: 1, attrs: {} },
    { id: "L:me|p", from: ME, to: id("Priya Patel"), type: "KNOWS", source: "manual", createdBy: "personal-network", ts: 1, attrs: {} },
    link("Alex Morgan", "Tom Baker"), link("Alex Morgan", "Mia Wong"), link("Priya Patel", "Liam Murphy"), link("Priya Patel", "Grace Field")
  ];
  return { schema: "orbit.case.v1", name: "Demo", updated: 1, entities, links };
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
const page = await browser.newPage();
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

const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
await page.setViewport({ width: 1366, height: 850 });
await page.goto(URL, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1800));

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const IDS = ["personal-network:me", "E:person|alex morgan", "E:person|priya patel", "E:person|grace field"];
const snapshotPos = () => page.evaluate((ids) => ids.map((i) => window.__ORBIT_POS__(i)), IDS);
const setLayout = (k) => page.evaluate((key) => window.__ORBIT_SETLAYOUT__(key), k);

// Baseline: default orbit layout, ME pinned at origin.
const orbitPos = await snapshotPos();
assert("orbit: ME sits at the centre (0,0)", orbitPos[0] && Math.abs(orbitPos[0].x) < 1 && Math.abs(orbitPos[0].y) < 1, JSON.stringify(orbitPos[0]));

const finite = (arr) => arr.every((p) => p && isFinite(p.x) && isFinite(p.y));
const differs = (a, b) => a.some((p, i) => !b[i] || Math.abs(p.x - b[i].x) > 2 || Math.abs(p.y - b[i].y) > 2);

for (const kind of ["peacock", "peacock-compact", "hierarchy", "grouped", "circle", "grid"]) {
  await setLayout(kind);
  await new Promise((r) => setTimeout(r, 400));
  const pos = await snapshotPos();
  const active = await page.evaluate(() => window.__ORBIT_LAYOUT__());
  assert(kind + ": becomes the active layout", active === kind, active);
  assert(kind + ": all sampled nodes have finite coords", finite(pos), JSON.stringify(pos));
  assert(kind + ": nodes actually moved off the orbit rings", differs(pos, orbitPos), "identical to orbit");
}

// Force layout settles under physics, then freezes with finite coords.
await setLayout("force");
await new Promise((r) => setTimeout(r, 2500));
const forcePos = await snapshotPos();
assert("force: settles to finite coordinates", finite(forcePos), JSON.stringify(forcePos));

// Back to orbit re-centres ME.
await setLayout("orbit");
await new Promise((r) => setTimeout(r, 400));
const backPos = await snapshotPos();
assert("orbit restored: ME returns to the centre", backPos[0] && Math.abs(backPos[0].x) < 1 && Math.abs(backPos[0].y) < 1, JSON.stringify(backPos[0]));

assert("no uncaught errors across all layouts", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log("\n  " + passed + " passed, " + failed + " failed\n");
await browser.close();
process.exit(failed ? 1 : 0);
