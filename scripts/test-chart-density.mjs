/* A crowded chart must still be readable: icon chips survive dense mode, the
 * Instagram follow spokes fold away by default and come back for a selection,
 * and edge labels never paper the whole graph. Runs against the preview on
 * :4173, seeded with a real-sized Instagram list.
 */
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
const HERE = "c:/Users/44752/Documents/Claude/Projects/Personal_Network";
const BASE = join(HERE, "src", "personal-network");
await import(pathToFileURL(join(BASE, "classify.js")).href);
await import(pathToFileURL(join(BASE, "importers.js")).href);
const I = globalThis.OrbitNetworkImporters;
const OUT = process.argv[2] || ".";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const ME = "personal-network:me";
const seen = new Map();
for (const f of ["benwlsn11_IG_Followers", "benwlsn11_IG_Following"]) {
  const meta = I.handleListMeta(f);
  for (const c of (I.handleList(readFileSync(join(HERE, "contacts", f), "utf8"), f).candidates || [])) {
    const h = String(c.igHandle || c.instagram || "").toLowerCase();
    if (!h) continue;
    const row = seen.get(h) || { handle: h, name: c.name || h, display: c.preferredName || "" };
    if (meta.direction === "follower") row.follower = true; else row.following = true;
    seen.set(h, row);
  }
}
const all = [...seen.values()];
function buildCase(rows) {
  const now = "2026-08-01T12:00:00.000Z";
  const entities = [{ id: ME, type: "person", label: "Ben", identity: "me", attrs: { instagram: "benwlsn11", entityKind: "individual" }, source: "manual", createdBy: "personal-network", ts: 1 }];
  const links = [];
  for (const r of rows) {
    const id = "E:person|instagram:" + r.handle;
    entities.push({ id, type: "person", label: r.display || r.name, identity: "instagram:" + r.handle,
      attrs: { instagram: r.handle, igHandle: r.handle, entityKind: "social", sourceType: "instagram-import", sourceRef: "instagram", provenance: "imported", observedAt: now },
      source: "instagram-import", createdBy: "personal-network", ts: 1 });
    const attrs = { sourceType: "instagram-import", sourceRef: "instagram", observedAt: now, igOwner: ME };
    if (r.follower) attrs.igFollowsOwner = true;
    if (r.following) attrs.igOwnerFollows = true;
    links.push({ id: "L:FOLLOWS|" + id, from: ME, to: id, type: "FOLLOWS", attrs, source: "instagram-import", createdBy: "personal-network", ts: 1 });
  }
  return JSON.stringify({ schema: "orbit.case.v1", name: "IG", updated: 1, entities, links });
}
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); } };
const probe = () => {
  const net = window.__ORBIT_NETWORK__ && window.__ORBIT_NETWORK__();
  if (!net || !net.body) return { err: "no network" };
  const shapes = {}; let hiddenEdges = 0, shownEdges = 0, labelled = 0;
  Object.values(net.body.nodes).forEach((n) => { const s = (n.options && n.options.shape) || "?"; shapes[s] = (shapes[s] || 0) + 1; });
  Object.values(net.body.edges).forEach((e) => {
    const o = e.options || {};
    if (o.hidden) hiddenEdges++; else shownEdges++;
    if (o.label) labelled++;
  });
  return { shapes, hiddenEdges, shownEdges, labelled, toolbar: (document.getElementById("toolbar-count") || {}).textContent };
};
async function run(rows, tag) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--window-size=1400,900"] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (/supabase-config\.js/.test(req.url())) req.respond({ status: 200, contentType: "text/javascript", body: "window.ORBIT_SUPABASE_CONFIG = {};" });
    else req.continue();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.evaluateOnNewDocument((caseJson) => {
    const iso = "2026-08-01T12:00:00.000Z";
    localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "acct_demo", name: "Ben", email: "b@e.com", profile: {}, salt: "s", hash: "h", createdAt: iso, lastSignIn: iso }]));
    localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "acct_demo", signedInAt: iso }));
    localStorage.setItem("orbit_case_v1", caseJson);
  }, buildCase(rows));
  await page.setViewport({ width: 1366, height: 850 });
  await page.goto(URL, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 3000));
  const base = await page.evaluate(probe);
  console.log("\n[" + tag + " · nothing selected] " + JSON.stringify(base));
  await page.screenshot({ path: OUT + "/fixed-" + tag + ".png" });
  // now select one account and re-probe
  const pick = "E:person|instagram:" + rows[0].handle;
  await page.evaluate((id) => { if (window.__ORBIT_SELECT__) window.__ORBIT_SELECT__(id); }, pick);
  await new Promise((r) => setTimeout(r, 900));
  const sel = await page.evaluate(probe);
  console.log("[" + tag + " · one selected] " + JSON.stringify(sel));
  await page.screenshot({ path: OUT + "/fixed-" + tag + "-selected.png" });
  console.log("errors:", errors.slice(0, 3));
  await browser.close();
  return { base, sel };
}
const r283 = await run(all, "283");
const r140 = await run(all.slice(0, 140), "140");

console.log("\n--- assertions ---");
ok("283: no bare dots left except ME", (r283.base.shapes.dot || 0) <= 1, JSON.stringify(r283.base.shapes));
ok("283: icon chips render in dense mode", (r283.base.shapes.circularImage || 0) >= 280, JSON.stringify(r283.base.shapes));
ok("283: follow spokes folded when nothing selected", r283.base.hiddenEdges >= 280, "hidden=" + r283.base.hiddenEdges);
ok("283: no edge labels when nothing selected", r283.base.labelled === 0, "labelled=" + r283.base.labelled);
ok("283: toolbar discloses the fold", /follows folded/.test(r283.base.toolbar || ""), r283.base.toolbar);
ok("283: selecting a person brings their edge back", r283.sel.shownEdges >= 1, "shown=" + r283.sel.shownEdges);
ok("283: selection labels only that edge", r283.sel.labelled >= 1 && r283.sel.labelled <= 3, "labelled=" + r283.sel.labelled);
ok("140: chips still render", (r140.base.shapes.circularImage || 0) >= 138, JSON.stringify(r140.base.shapes));
ok("140: no wall of labels", r140.base.labelled === 0, "labelled=" + r140.base.labelled);
ok("140: spokes folded too (140 > 40)", r140.base.hiddenEdges >= 138, "hidden=" + r140.base.hiddenEdges);
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
