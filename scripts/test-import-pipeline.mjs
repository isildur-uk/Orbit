/* Import pipeline tests — classification, filtering and duplicate detection.
 *
 * Exercises the real browser modules (classify.js, matching.js, importers.js)
 * in Node by importing them for their globalThis side-effects, then runs the
 * exact fake-import scenario the project brief requires:
 *   noreply@google.com · a normal person · info@company.com ·
 *   a named person at a company · a duplicate by email · a duplicate by phone
 *   with a different name · an ambiguous record.
 *
 * Run: node scripts/test-import-pipeline.mjs
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = join(HERE, "..", "src", "personal-network");
const load = (name) => import(pathToFileURL(join(BASE, name)).href);

await load("classify.js");
await load("matching.js");
await load("importers.js");

const Classify = globalThis.OrbitContactClassify;
const Matching = globalThis.OrbitContactMatching;
const Importers = globalThis.OrbitNetworkImporters;

let passed = 0, failed = 0;
function assert(name, condition, detail) {
  if (condition) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + (detail ? "  →  " + detail : "")); }
}
function eq(name, actual, expected) {
  assert(name, actual === expected, "got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected));
}

console.log("\n[1] Classifier");
eq("noreply@google.com is filtered", Classify.classify({ name: "", organisation: "", emails: ["noreply@google.com"] }).skip, "automated address");
["no-reply@x.com", "donotreply@x.com", "notifications@x.com", "alerts@x.com", "updates@x.com", "newsletter@x.com", "mailer-daemon@x.com", "postmaster@x.com", "calendar-notification@google.com"].forEach((e) => {
  assert(e + " is filtered", !!Classify.classify({ name: "", organisation: "", emails: [e] }).skip);
});
eq("info@company.com → generic inbox", Classify.classify({ name: "", organisation: "Company Ltd", emails: ["info@company.com"] }).category, "generic-inbox");
eq("named person → individual", Classify.classify({ name: "Alex Morgan", organisation: "", emails: ["alex@gmail.com"] }).category, "individual");
eq("Acme Ltd (name only) → organisation", Classify.classify({ name: "Acme Trading Ltd", organisation: "", emails: [] }).category, "organisation");
eq("email-only → ambiguous/unknown", Classify.classify({ name: "", organisation: "", emails: ["someone123@nowhere.net"] }).category, "unknown");
assert("real name containing 'no' not filtered", !Classify.classify({ name: "Noah Reilly", organisation: "", emails: ["noah@x.com"] }).skip);

console.log("\n[2] CSV import + filtering (review)");
const csv = [
  "name,email,phone,organisation",
  ",noreply@google.com,,",
  "Alex Morgan,alex.morgan@gmail.com,07900 123456,",
  ",info@company.com,,Company Ltd",
  "Priya Patel,priya@acmecorp.com,,Acme Corp",
  "Sarah Jones,sarah.jones@example.com,,",
  "Sarah J,,07700 900111,",
  ",someone123@nowhere.net,,"
].join("\n");
const review = Importers.review(csv, "contacts.csv");
eq("candidates parsed (noreply excluded)", review.candidates.length, 6);
eq("skippedCount reports the filtered record", review.skippedCount, 1);
assert("no candidate is the noreply record", !review.candidates.some((c) => /noreply/.test(String(c.email))));
const byName = {};
review.candidates.forEach((c) => { byName[c.name] = c; });
eq("Alex Morgan classified individual", byName["Alex Morgan"].category, "individual");
eq("info@company.com classified generic-inbox", byName["info"].category, "generic-inbox");
eq("Priya Patel (named person at company) individual", byName["Priya Patel"].category, "individual");
eq("email-only record ambiguous", byName["someone123"].category, "unknown");

console.log("\n[3] Duplicate detection with explanations");
const existingPeople = [
  { id: "E:person|sarah jones", label: "Sarah Jones", attrs: { email: "sarah.jones@example.com", phone: "07700 900111" } }
];
const matches = Matching.computeMatches(review.candidates, existingPeople);
const matchByName = {};
review.candidates.forEach((c, i) => { matchByName[c.name] = matches[i]; });
assert("duplicate by email is flagged", !!matchByName["Sarah Jones"]);
eq("email duplicate explains itself", matchByName["Sarah Jones"] && matchByName["Sarah Jones"].reason, "Same email address");
assert("duplicate by phone (different name) is flagged", !!matchByName["Sarah J"]);
eq("phone duplicate explains itself", matchByName["Sarah J"] && matchByName["Sarah J"].reason, "Same phone number");
eq("phone duplicate targets the existing Sarah Jones", matchByName["Sarah J"] && matchByName["Sarah J"].target.label, "Sarah Jones");
assert("a genuinely new person is NOT flagged", !matchByName["Alex Morgan"]);
assert("info inbox is NOT flagged as a person duplicate", !matchByName["info"]);
const flagged = matches.filter(Boolean).length;
eq("exactly two likely matches flagged", flagged, 2);

console.log("\n[4] In-batch duplicate convergence (two duplicates in one file)");
const batch = [
  { name: "Jamie Fox", email: "jamie@studio.com", phone: "07123 456789", sourceRef: "row1" },
  { name: "J Fox", email: "", phone: "07123 456789", sourceRef: "row2" }
];
const batchMatches = Matching.computeMatches(batch, []);
assert("first of an in-batch pair is not pre-matched", !batchMatches[0]);
assert("second of an in-batch pair matches the first", !!batchMatches[1]);
eq("second converges on the first record's name", batchMatches[1] && batchMatches[1].target.label, "Jamie Fox");

console.log("\n[5] Merge selection honours only selected rows (app-logic simulation)");
const alexIndex = review.candidates.indexOf(byName["Alex Morgan"]);
const selected = review.candidates.map((_, i) => i === alexIndex);
const willMerge = review.candidates.filter((_, i) => selected[i]);
eq("only the one selected row would merge", willMerge.length, 1);
eq("the selected row is Alex Morgan", willMerge[0].name, "Alex Morgan");
const remapped = review.candidates.map((c, i) => (matches[i] && matches[i].target ? matches[i].target.label : c.name));
eq("approved phone-duplicate enriches existing profile (name remap)", remapped[review.candidates.indexOf(byName["Sarah J"])], "Sarah Jones");

console.log("\n[6] LinkedIn CSV export (preamble + First/Last Name + Email Address)");
const linkedin = [
  "Notes:",
  '"When exporting your connection data, you may notice that some of the email addresses are missing."',
  "",
  "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
  "Dana,Whitfield,https://www.linkedin.com/in/danaw,dana.whitfield@northwind.io,Northwind,Head of Product,14 Mar 2023",
  "Marcus, True,https://www.linkedin.com/in/marcustrue,,Helix Labs,Engineer,02 Jan 2024"
].join("\n");
const li = Importers.review(linkedin, "Connections.csv");
eq("LinkedIn preamble skipped; both rows parsed", li.candidates.length, 2);
const liByName = {};
li.candidates.forEach((c) => { liByName[c.name] = c; });
assert("First + Last name combined", !!liByName["Dana Whitfield"]);
eq("Email Address column mapped", liByName["Dana Whitfield"] && liByName["Dana Whitfield"].email, "dana.whitfield@northwind.io");
eq("Company mapped to organisation", liByName["Dana Whitfield"] && liByName["Dana Whitfield"].organisation, "Northwind");
eq("Position mapped to role", liByName["Dana Whitfield"] && liByName["Dana Whitfield"].role, "Head of Product");
assert("connection with no shared email still imports", !!liByName["Marcus True"]);

console.log("\n[7] Facebook / Instagram JSON exports");
const fb = JSON.stringify({ friends_v2: [
  { name: "Rowan Ellis", timestamp: 1600000000 },
  { name: "Priti Shah", timestamp: 1610000000 }
] });
const fbReview = Importers.review(fb, "your_friends.json");
eq("Facebook friends parsed by name", fbReview.candidates.length, 2);
assert("Facebook friend note tagged", fbReview.candidates.every((c) => /Facebook friend/.test(String(c.note))));

const igFollowers = JSON.stringify([
  { string_list_data: [{ href: "https://www.instagram.com/coolcat", value: "coolcat", timestamp: 1600000000 }] },
  { string_list_data: [{ href: "https://www.instagram.com/traveljen", value: "traveljen", timestamp: 1600000001 }] }
]);
const igReview = Importers.review(igFollowers, "followers_1.json");
eq("Instagram followers (bare array) parsed", igReview.candidates.length, 2);
eq("Instagram handle becomes the name", igReview.candidates[0].name, "coolcat");
eq("Instagram profile URL captured", igReview.candidates[0].instagram, "https://www.instagram.com/coolcat");

const igFollowing = JSON.stringify({ relationships_following: [
  { string_list_data: [{ href: "https://www.instagram.com/mate", value: "mate" }] }
] });
const igfReview = Importers.review(igFollowing, "following.json");
eq("Instagram following (keyed) parsed", igfReview.candidates.length, 1);

console.log("\n[8] Generic JSON array still filters automated addresses");
const generic = JSON.stringify([
  { name: "Real Person", email: "real@example.com" },
  { name: "", email: "noreply@corp.com" },
  { name: "Ops Team", email: "info@corp.com" }
]);
const genReview = Importers.review(generic, "contacts.json");
assert("noreply record filtered out of JSON too", !genReview.candidates.some((c) => /noreply/.test(String(c.email))));
eq("one automated record reported skipped", genReview.skippedCount, 1);
assert("real person survives JSON import", genReview.candidates.some((c) => c.name === "Real Person"));

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
process.exit(failed ? 1 : 0);
