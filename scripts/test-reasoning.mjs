/* Reasoning tests — the calculations behind what Orbit says about a network.
 *
 * graph.js    which people form a group, who bridges, what is shared, what to suggest
 * query.js    the small query language behind the search box
 * evidence.js where a detail came from, and why a score is what it is
 * brief.js    the whole network written down
 *
 * All pure: no DOM, no browser, no network. Run: node scripts/test-reasoning.mjs
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = join(HERE, "..", "src", "personal-network");
for (const name of ["graph.js", "query.js", "evidence.js", "brief.js"]) {
  await import(pathToFileURL(join(BASE, name)).href);
}
const G = globalThis.OrbitGraph, Q = globalThis.OrbitQuery, E = globalThis.OrbitEvidence, B = globalThis.OrbitBrief;

let passed = 0, failed = 0;
function assert(name, condition, detail) {
  if (condition) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + (detail ? "  →  " + detail : "")); }
}
function eq(name, actual, expected) {
  assert(name, JSON.stringify(actual) === JSON.stringify(expected), "got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected));
}
const L = (a, b) => ({ from: a, to: b });
const ME = "me";

console.log("\n[1] Groups hold together without you");
/* a-b-c and f-g tie together through g-c; d-e are on their own; all reach you. */
const ids = ["me", "a", "b", "c", "d", "e", "f", "g"];
const links = [L(ME, "a"), L(ME, "d"), L(ME, "f"), L("a", "b"), L("b", "c"), L("d", "e"), L("f", "g"), L("g", "c")];
eq("the network falls into groups", G.groups(ids, links, { centre: ME }).map((x) => x.members.join("")), ["abcfg", "de"]);
eq("leaving you out is what makes it mean something", G.groups(ids, links, {}).length, 1);
eq("an empty network has no groups", G.groups([], [], { centre: ME }), []);
eq("someone with no links is a group of one", G.groups(["me", "z"], [L(ME, "z")], { centre: ME }).map((x) => x.size), [1]);

console.log("\n[2] Bridges are whoever holds it together");
eq("the threads are found", G.bridges(ids, links, { centre: ME }).map((x) => x.id).sort(), ["b", "c", "g"]);
assert("a leaf is never a bridge", !G.bridges(ids, links, { centre: ME }).some((x) => x.id === "a"));
assert("each says how far it breaks", G.bridges(ids, links, { centre: ME }).every((x) => x.splitsInto >= 2));
eq("an empty network is safe", G.bridges([], [], {}), []);
/* A long chain must not overflow the stack. */
const chainIds = ["me"], chainLinks = [];
for (let i = 0; i < 4000; i++) { chainIds.push("n" + i); if (i) chainLinks.push(L("n" + (i - 1), "n" + i)); }
chainLinks.push(L(ME, "n0"));
assert("a four-thousand-long chain does not overflow", G.bridges(chainIds, chainLinks, { centre: ME }).length === 3998);

console.log("\n[3] Identifiers held by more than one person");
const holders = [
  { id: "a", selectors: [{ kind: "Phone", value: "07700 900111" }, { kind: "Email", value: "a@acme.com" }] },
  { id: "b", selectors: [{ kind: "Phone", value: "07700 900111" }] },
  { id: "c", selectors: [{ kind: "Phone", value: "07999 000000" }] },
  { id: "d", selectors: [{ kind: "Phone", value: "07700 900111" }, { kind: "Phone", value: "07700 900111" }] }
];
const shared = G.sharedSelectors(holders);
eq("only what is actually shared is reported", shared.map((s) => s.value), ["07700 900111"]);
eq("with every holder", shared[0].holders, ["a", "b", "d"]);
assert("the same value twice on one record is not sharing", G.sharedSelectors([holders[3]]).length === 0);

console.log("\n[4] Relationships the evidence implies");
const suggestions = G.suggestLinks({
  centre: ME,
  people: [
    { id: "E:person|a", organisation: "Acme", selectors: [{ kind: "Phone", value: "07700 900111" }] },
    { id: "E:person|b", organisation: "Acme", selectors: [{ kind: "Phone", value: "07700 900111" }] },
    { id: "E:person|c", organisation: "Acme", selectors: [] },
    { id: "E:person|d", organisation: "", selectors: [] }
  ],
  links: [L("E:person|a", "E:person|b")],
  eventMembers: { msg1: ["E:person|c", "E:person|d"] }
});
const key = (s) => s.a + "+" + s.b;
assert("a relationship already drawn is never suggested", !suggestions.some((s) => key(s) === "E:person|a+E:person|b"));
assert("colleagues are suggested", suggestions.some((s) => key(s) === "E:person|a+E:person|c"));
assert("so are people named on the same message", suggestions.some((s) => key(s) === "E:person|c+E:person|d"));
assert("nothing is suggested about you", !suggestions.some((s) => s.a === ME || s.b === ME));
assert("every suggestion carries its reason", suggestions.every((s) => s.reasons.length && s.reasons.every((r) => !!r.why)));
/* Ids here contain a pipe on purpose: a separator that can appear inside an id
 * used to shred the pair into nonsense. */
assert("an id containing a separator survives intact", suggestions.every((s) => s.a.indexOf("E:person|") === 0 && s.b.indexOf("E:person|") === 0), JSON.stringify(suggestions[0]));
assert("a whole shared work domain is not a relationship", G.suggestLinks({
  centre: ME,
  people: "abcdefgh".split("").map((c) => ({ id: c, organisation: "", selectors: [{ kind: "Email", value: "shared@acme.com" }] })),
  links: []
}).length === 0);

console.log("\n[5] Asking a precise question");
eq("a bare word is a plain search", Q.parse("katie"), [{ field: "text", value: "katie", negated: false }]);
eq("a prefix narrows the field", Q.parse("tag:cycling")[0].field, "tag");
eq("a quoted phrase stays whole", Q.parse('in:"school friends"')[0].value, "school friends");
eq("a minus negates", Q.parse("-tag:work")[0].negated, true);
eq("an unknown prefix is just text", Q.parse("wat:ever")[0].field, "text");
const record = {
  name: "Katie Rose", tags: ["cycling", "uni"], organisation: "Acme Ltd", emails: ["kate@acme.com"],
  kind: "individual", has: ["email", "phone"], groups: ["School friends"],
  lastAt: Date.parse("2026-06-01"), emailTotal: 42, haystack: "katie rose acme cycling"
};
const ok = (q) => Q.matches(record, Q.parse(q));
eq("tag matches", ok("tag:cycling"), true);
eq("tag misses", ok("tag:knitting"), false);
eq("organisation matches loosely", ok("org:acme"), true);
eq("email domain matches", ok("domain:acme.com"), true);
eq("kind matches", ok("is:person"), true);
eq("what is held matches", ok("has:phone"), true);
eq("what is not held misses", ok("has:whatsapp"), false);
eq("a named group matches", ok('in:"school friends"'), true);
eq("a year is understood", ok("since:2026"), true);
eq("and an earlier bound excludes", ok("until:2026-01"), false);
eq("a count comparison works", ok("emails:>10"), true);
eq("and the other way", ok("emails:<10"), false);
eq("negation works", ok("-tag:knitting"), true);
eq("terms narrow together", ok("tag:cycling org:acme has:email"), true);
eq("one failing term fails the query", ok("tag:cycling org:zzz"), false);
eq("an empty query matches everything", Q.matches(record, Q.parse("")), true);
eq("the query says itself back", Q.describe(Q.parse("tag:cycling -org:acme")), "tag cycling and not org acme");

console.log("\n[6] Where a detail came from");
const imported = {
  id: "x", source: "gmail-import",
  attrs: { email: "kate@example.com", phone: "07700 900111", entityKind: "individual", sourceType: "gmail-import", observedAt: "2026-08-01T10:00:00Z" },
  assertions: { email: [{ value: "kate@example.com", surface: "google-contacts", assertedAt: "2026-07-02T09:00:00Z", count: 2 }] }
};
const prov = {}; E.provenance(imported).forEach((r) => { prov[r.key] = r; });
eq("an asserted value names its source", prov.email.source, "Google Contacts");
assert("and when it was learned", /2026-07-02/.test(prov.email.at), prov.email.at);
eq("an unasserted value falls back to the record's source", prov.phone.source, "Your Gmail history");
assert("bookkeeping is not evidence", !prov.entityKind && !prov.sourceType && !prov.observedAt);
eq("fields read in plain words", prov.phone.label, "Phone");
eq("a bare record is safe", E.provenance({}), []);
eq("a hand-typed value says so", E.sourceLabel("manual"), "Typed in by you");
eq("an unknown source is honest", E.sourceLabel(""), "Source not recorded");

console.log("\n[7] Why a score is what it is");
assert("a score you set says so", /set this yourself/i.test(E.scoreBreakdown(78, { explicitStrength: 78 }).parts[0].label));
const derived = E.scoreBreakdown(51, { degree: 3, emailTotal: 42, lastAt: Date.parse("2026-08-18"), now: Date.parse("2026-08-23"), follow: "Mutual follow", sharedGroups: 2 });
const labels = derived.parts.map((x) => x.label).join(" | ");
assert("relationships drawn are counted", /3 relationships drawn/.test(labels), labels);
assert("emails are counted", /42 emails exchanged/.test(labels), labels);
assert("time since contact is stated", /5 days ago/.test(labels), labels);
assert("a mutual follow counts", /Mutual follow/.test(labels), labels);
eq("the score itself is never changed by explaining it", derived.score, 51);
assert("a long silence reads as a negative", E.scoreBreakdown(20, { lastAt: Date.parse("2025-01-01"), now: Date.parse("2026-08-23") }).parts.some((x) => x.weight === "-"));
assert("nothing recorded says what to do about it", E.scoreBreakdown(18, {}).parts.some((x) => /Import a mailbox/.test(x.detail)));

console.log("\n[8] The brief");
const html = B.page({
  owner: "Ben Wilson", generatedAt: "2026-08-23T12:00:00Z",
  stats: { people: 283, relationships: 291 },
  groups: [{ name: "Cycling club", size: 12, sample: ["Katie Rose", "Tom Baker"] }],
  bridges: [{ name: "Katie Rose", splitsInto: 3 }],
  cold: [{ name: "Priya Patel", ring: "Inner circle", days: 150 }],
  mostEmailed: [{ name: "Katie Rose", total: 42, lastAt: "2026-08-18T00:00:00Z" }],
  recent: [{ date: "2026-08-18T00:00:00Z", title: "Re: Lunch", who: "Katie Rose" }],
  shared: [{ value: "07700 900111", kind: "Phone", who: ["Katie Rose", "Tom Baker"] }],
  suggestions: [{ a: "Tom Baker", b: "Mia Wong", why: "Both at Acme" }],
  sources: [{ label: "Your Gmail history", count: 120 }]
});
assert("it is a whole page", /^<!doctype html>/i.test(html));
assert("it names the owner", /Ben Wilson/.test(html));
assert("it reports the counts", /283/.test(html) && /291/.test(html));
assert("it explains what a group is", /without going through you/.test(html));
assert("it says what breaks without a bridge", /falls into 3 pieces/.test(html));
assert("it names who has gone quiet", /Priya Patel/.test(html) && /150/.test(html));
assert("it lists shared identifiers", /07700 900111/.test(html));
assert("it marks suggestions as not drawn", /Not drawn on the chart/.test(html));
assert("it says where everything came from", /Your Gmail history/.test(html));
assert("it says the work was done locally", /on your own machine/.test(html));
assert("markup in a name cannot escape", !/<script>/.test(B.page({ owner: "<script>alert(1)</script>" })));
assert("an empty network still produces a page", /^<!doctype html>/i.test(B.page({})));
assert("without inventing sections it has nothing for", !/Going quiet/.test(B.page({})));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
process.exit(failed ? 1 : 0);
