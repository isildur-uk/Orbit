/* Cycle-and-delete tests: ←/→ always means "step through contacts", and Delete
 * always leaves you on the next one rather than on an empty panel. Covers the
 * case that used to bite — a stray left-drag box-selects everyone, the arrows
 * did nothing, and the next Delete binned the whole selection.
 * Runs against the live preview on :4173.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const id = (n) => "E:person|" + n.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ME = "personal-network:me";
/* Sorted order: Alex Morgan, Grace Field, Liam Murphy, Mia Wong, Priya Patel, Tom Baker */
const NAMES = ["Alex Morgan", "Priya Patel", "Tom Baker", "Mia Wong", "Liam Murphy", "Grace Field"];

function seed() {
  const ents = NAMES.map((n) => { const e = id(n); return { id: e, type: "person", label: n, identity: n, contribs: ["ent:" + e], attrs: { entityKind: "individual", strength: 45 }, source: "manual", createdBy: "personal-network", ts: 1 }; });
  const L = (a, b) => ({ id: "L:" + a + b, from: a, to: b, type: "KNOWS", source: "manual", createdBy: "personal-network", ts: 1, attrs: {} });
  return { schema: "orbit.case.v1", name: "Demo", updated: 1, entities: ents, links: [L(ME, id("Tom Baker"))] };
}

async function boot() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
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
  await new Promise((r) => setTimeout(r, 2200));
  if (!(await page.evaluate(() => typeof window.__ORBIT_MULTI__ === "function"))) { await browser.close(); return null; }
  const box = await page.evaluate(() => { const r = document.querySelector("#network").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  return { browser, page, box, errors };
}

let passed = 0, failed = 0;
const assert = (n, c, d) => { if (c) { passed++; console.log("  PASS  " + n); } else { failed++; console.log("  FAIL  " + n + (d ? "  → " + d : "")); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function api(page) {
  return {
    state: () => page.evaluate(() => ({
      sel: window.__ORBIT_SELECTED__(), multi: window.__ORBIT_MULTI__().length,
      hidden: document.querySelector("#person-dossier").hidden,
      name: document.querySelector("#person-dossier h2").textContent.trim(),
      people: window.__ORBIT_PEOPLE__()
    })),
    clickPerson: async (box) => {
      const t = await page.evaluate((ids, b) => {
        for (const i of ids) { const d = window.__ORBIT_NODE_DOM__(i); if (d && d.x > 40 && d.x < b.w - 40 && d.y > 40 && d.y < b.h - 40) return { x: d.x, y: d.y }; }
        return null;
      }, NAMES.map(id), box);
      await page.mouse.click(box.x + t.x, box.y + t.y);
      await wait(400);
    },
    boxSelectAll: async (box) => {
      await page.mouse.move(box.x + 20, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + box.w - 20, box.y + box.h - 20, { steps: 8 });
      await page.mouse.up();
      await wait(400);
    }
  };
}

/* Each case gets a clean workspace, so one delete never skews the next. */
async function scenario(label, run) {
  let ctx = null;
  for (let i = 0; i < 4 && !ctx; i++) ctx = await boot();
  if (!ctx) { console.log("  FAIL  " + label + "  → could not seed"); failed++; return; }
  try { await run(ctx, api(ctx.page)); assert("no uncaught errors · " + label, ctx.errors.length === 0, ctx.errors.join(" | ")); }
  finally { await ctx.browser.close(); }
}

console.log("\n[cycle then delete]");
await scenario("right then delete", async ({ page, box }, a) => {
  await a.clickPerson(box);
  await page.keyboard.press("ArrowRight");
  await wait(300);
  const before = await a.state();
  await page.keyboard.press("Delete");
  await wait(500);
  const after = await a.state();
  assert("→ then Delete keeps a profile open", !after.hidden, JSON.stringify(after));
  assert("→ then Delete advances", after.name && after.name !== before.name, before.name + " → " + after.name);
  assert("→ then Delete removes exactly one", after.people === before.people - 1, before.people + " → " + after.people);
});

await scenario("left, wrapping, then delete", async ({ page, box }, a) => {
  await a.clickPerson(box);
  for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowLeft"); await wait(250); }
  const before = await a.state();
  await page.keyboard.press("Delete");
  await wait(500);
  const after = await a.state();
  assert("← wrapping then Delete advances", !after.hidden && after.name !== before.name, before.name + " → " + after.name);
  assert("← wrapping removes exactly one", after.people === before.people - 1, before.people + " → " + after.people);
});

console.log("\n[a stray box-select must not turn Delete into a purge]");
await scenario("arrow collapses a box-select", async ({ page, box }, a) => {
  await a.boxSelectAll(box);
  const selected = await a.state();
  /* Six contacts plus your own record, which is a selectable person too. */
  assert("left-drag box-selected everyone", selected.multi === 7 && !selected.sel, JSON.stringify(selected));
  await page.keyboard.press("ArrowRight");
  await wait(400);
  const collapsed = await a.state();
  assert("an arrow collapses it to one contact", collapsed.multi === 0 && !!collapsed.sel && !collapsed.hidden, JSON.stringify(collapsed));
  await page.keyboard.press("Delete");
  await wait(500);
  const after = await a.state();
  assert("Delete then removes ONE, not the selection", after.people === 5, "people=" + after.people);
  assert("and lands on the next contact", !after.hidden && after.name !== collapsed.name, collapsed.name + " → " + after.name);
});

console.log("\n[deliberate bulk delete still works, and still lands somewhere]");
await scenario("bulk delete advances", async ({ page, box }, a) => {
  /* Box-select a corner of the ring, so some people survive. */
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w / 2, box.y + box.h / 2, { steps: 8 });
  await page.mouse.up();
  await wait(400);
  const selected = await a.state();
  assert("a partial box-select picks some people", selected.multi > 0 && selected.multi < 7, JSON.stringify(selected));
  /* Your own record is never deleted, so it does not count towards the loss. */
  const deletable = await page.evaluate(() => window.__ORBIT_MULTI__().filter((i) => i !== "personal-network:me").length);
  await page.keyboard.press("Delete");
  await wait(600);
  const after = await a.state();
  assert("bulk delete removes the selection", after.people === 6 - deletable, "6 - " + deletable + " vs " + after.people);
  assert("bulk delete lands on a remaining contact", !after.hidden && !!after.sel, JSON.stringify(after));
});

console.log("\n[your own record is never deleted]");
await scenario("delete refuses your own record", async ({ page, box }, a) => {
  await page.evaluate(() => window.__ORBIT_SELECT__("personal-network:me"));
  await wait(400);
  const before = await a.state();
  assert("your own profile opens", !before.hidden && before.sel === "personal-network:me", JSON.stringify(before));
  await page.keyboard.press("Delete");
  await wait(500);
  const after = await a.state();
  assert("Delete leaves every contact in place", after.people === 6, "people=" + after.people);
  assert("and says why", (await page.evaluate(() => document.querySelector("#sync-status").textContent)).includes("CANNOT BE DELETED"));
});

console.log("\n[the last contact]");
await scenario("deleting everyone leaves you", async ({ page, box }, a) => {
  await a.clickPerson(box);
  /* Delete lands on the next contact each time; your own record refuses, so
   * press past it. */
  for (let i = 0; i < 10; i++) {
    if (await page.evaluate(() => window.__ORBIT_SELECTED__()) === "personal-network:me") await page.keyboard.press("ArrowRight");
    else await page.keyboard.press("Delete");
    await wait(350);
  }
  const after = await a.state();
  assert("every contact deleted", after.people === 0, "people=" + after.people);
  assert("the panel lands on you rather than going blank", !after.hidden && after.sel === "personal-network:me", JSON.stringify(after));
});

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
process.exit(failed ? 1 : 0);
