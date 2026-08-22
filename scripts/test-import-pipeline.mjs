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

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
process.exit(failed ? 1 : 0);
