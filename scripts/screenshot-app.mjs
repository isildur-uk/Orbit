/* Drive the real app in headless Chrome, seeded with sample contacts, and
 * screenshot the populated workspace + modals at desktop and phone widths.
 * Uses the LOCAL auth fallback (blanks the Supabase config) so no network
 * sign-in is needed. Diagnostic only — writes PNGs to the scratchpad.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = "http://127.0.0.1:4173/index.html?orbittest=1";
const OUT = process.argv[2] || ".";
mkdirSync(OUT, { recursive: true });

/* A believable contact set: individuals across orgs, two organisations. */
function seed() {
  const now = new Date().toISOString();
  const people = [
    ["Sarah Jones", "Insurance recruiter", "Aon", "sarah.jones@aon.com", "07700 900111", "individual"],
    ["Tom Baker", "Software engineer", "Monzo", "tom@monzo.com", "07711 222333", "individual"],
    ["Priya Patel", "Product lead", "Acme Corp", "priya@acmecorp.com", "", "individual"],
    ["James O'Neill", "Solicitor", "O'Neill & Co", "james@oneill.co.uk", "07900 111222", "individual"],
    ["Mia Wong", "Designer", "Studio Wong", "mia@studiowong.com", "", "individual"],
    ["Daniel Cohen", "Accountant", "Grant Thornton", "daniel@gt.com", "07555 010203", "individual"],
    ["Aisha Khan", "Doctor", "NHS", "aisha.khan@nhs.uk", "", "individual"],
    ["Liam Murphy", "Founder", "Murphy Labs", "liam@murphylabs.io", "07404 556677", "individual"],
    ["Chloe Adams", "Marketing manager", "Deliveroo", "chloe@deliveroo.com", "", "individual"],
    ["Ravi Sharma", "Data scientist", "Meta", "ravi@meta.com", "07808 909091", "individual"],
    ["Emma Thompson", "Teacher", "Local school", "emma.t@school.org", "", "individual"],
    ["Noah Reilly", "Photographer", "", "noah@lens.photo", "07123 456780", "individual"],
    ["Grace Field", "Consultant", "McKinsey", "grace.field@mckinsey.com", "", "individual"],
    ["Oliver Bennett", "Architect", "Bennett Studio", "oliver@bennett.studio", "07999 000111", "individual"],
    ["Sofia Rossi", "Chef", "Trattoria Rossi", "sofia@rossi.it", "", "individual"],
    ["Acme Corp", "", "Acme Corp", "info@acmecorp.com", "020 7946 0000", "organisation"],
    ["Monzo Bank Ltd", "", "Monzo", "hello@monzo.com", "", "organisation"]
  ];
  const ME = "personal-network:me";
  const entities = [];
  const links = [];
  people.forEach((p, i) => {
    const [name, role, org, email, phone, kind] = p;
    const id = "E:person|" + name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    entities.push({ id, type: "person", label: name, identity: name,
      attrs: { role, organisation: org, email, phone, entityKind: kind, strength: 30 + ((i * 7) % 60), sourceType: "google-contacts", sourceRef: "people/c" + i, provenance: "imported", observedAt: now },
      source: "google-contacts", createdBy: "personal-network", ts: 1 });
    if (i % 2 === 0) links.push({ id: "L:" + ME + "|knows|" + id, from: ME, to: id, type: "KNOWS", attrs: {}, source: "manual", createdBy: "personal-network", ts: 1 });
  });
  return { schema: "orbit.case.v1", name: "Demo", updated: 1, entities, links };
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--window-size=1400,900"] });
const page = await browser.newPage();

const CASE = JSON.stringify(seed());
await page.setRequestInterception(true);
page.on("request", (req) => {
  if (/supabase-config\.js/.test(req.url())) {
    req.respond({ status: 200, contentType: "text/javascript", body: "window.ORBIT_SUPABASE_CONFIG = {};" });
  } else req.continue();
});
await page.evaluateOnNewDocument((caseJson) => {
  const iso = "2026-08-01T12:00:00.000Z";
  localStorage.setItem("orbit_local_accounts_v1", JSON.stringify([{ id: "acct_demo", name: "Ben", email: "ben@example.com", profile: {}, salt: "s", hash: "h", createdAt: iso, lastSignIn: iso }]));
  localStorage.setItem("orbit_local_session_v1", JSON.stringify({ accountId: "acct_demo", signedInAt: iso }));
  localStorage.setItem("orbit_case_v1", caseJson);
}, CASE);

const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

// Desktop populated workspace
await page.setViewport({ width: 1366, height: 850, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1800));
const booted = await page.evaluate(() => ({ booted: window.__ORBIT_BOOTED__, appHidden: document.getElementById("network-app").hidden, authHidden: document.getElementById("auth-shell").hidden, status: (document.getElementById("sync-status")||{}).textContent, count: (document.getElementById("network-count")||{}).textContent }));
console.log("boot state:", JSON.stringify(booted));
await page.screenshot({ path: OUT + "/01-workspace-desktop.png" });

// Open "Add person" modal — does it render + can it close?
await page.evaluate(() => document.querySelector('[data-action="add-person"]').click());
await new Promise((r) => setTimeout(r, 400));
const modalOpen = await page.evaluate(() => !document.getElementById("person-modal").hidden);
await page.screenshot({ path: OUT + "/02-add-person-modal.png" });
await page.evaluate(() => document.querySelector('#person-modal [data-action="close-modal"]').click());
await new Promise((r) => setTimeout(r, 300));
const modalClosed = await page.evaluate(() => document.getElementById("person-modal").hidden === true);
console.log("add-person modal: opened=" + modalOpen + " closedByX=" + modalClosed);

// Open Connections modal
await page.evaluate(() => document.querySelector('[data-action="connections"]').click());
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: OUT + "/03-connections-modal.png" });
const connClosed = await page.evaluate(() => { document.querySelector('#connections-modal [data-action="close-connections"]').click(); return true; });
await new Promise((r) => setTimeout(r, 300));
const connHidden = await page.evaluate(() => document.getElementById("connections-modal").hidden === true);
console.log("connections modal: closedByButton=" + connHidden);

// --- Charting: draw + remove a relationship via the QA hook ---
const before = await page.evaluate(() => (document.getElementById("network-count") || {}).textContent);
await page.evaluate(() => { if (window.__ORBIT_LINK__) window.__ORBIT_LINK__("E:person|priya patel", "E:person|james o neill"); });
await new Promise((r) => setTimeout(r, 500));
const afterLink = await page.evaluate(() => (document.getElementById("network-count") || {}).textContent);
console.log("relationships before link:", before, "| after link:", afterLink);
// Show connect-mode UI
await page.evaluate(() => document.querySelector('[data-action="connect-mode"]').click());
await new Promise((r) => setTimeout(r, 300));
const connectHintShown = await page.evaluate(() => !document.getElementById("connect-hint").hidden);
await page.screenshot({ path: OUT + "/07-connect-mode.png" });
await page.evaluate(() => document.querySelector('[data-action="connect-mode"]').click());
console.log("connect-mode hint shown:", connectHintShown);
// Remove the relationship again
await page.evaluate(() => { if (window.__ORBIT_UNLINK__) window.__ORBIT_UNLINK__("E:person|priya patel", "E:person|james o neill"); });
await new Promise((r) => setTimeout(r, 500));
const afterUnlink = await page.evaluate(() => (document.getElementById("network-count") || {}).textContent);
console.log("relationships after unlink:", afterUnlink);

// Open a contact profile deterministically via the QA hook.
await page.evaluate(() => { if (window.__ORBIT_SELECT__) window.__ORBIT_SELECT__("E:person|sarah jones"); });
await new Promise((r) => setTimeout(r, 400));
const dossierShown = await page.evaluate(() => !document.getElementById("person-dossier").hidden);
await page.screenshot({ path: OUT + "/04-contact-profile.png" });
let dossierClosed = null;
if (dossierShown) {
  await page.evaluate(() => document.querySelector('#person-dossier [data-action="close-dossier"]').click());
  await new Promise((r) => setTimeout(r, 300));
  dossierClosed = await page.evaluate(() => document.getElementById("person-dossier").hidden === true);
}
console.log("contact profile: shown=" + dossierShown + " closedByX=" + dossierClosed);

// Phone width
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(URL, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1600));
await page.screenshot({ path: OUT + "/05-workspace-phone.png" });
await page.evaluate(() => document.querySelector('[data-action="add-person"]').click());
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: OUT + "/06-add-person-phone.png" });

console.log("errors:", errors.length ? errors.slice(0, 6) : "none");
await browser.close();
console.log("screenshots written to", OUT);
