/* Mailbox parser tests — the headers of a Gmail Takeout export, read locally.
 * Pure: no browser, no network, no file on disk. Run: node scripts/test-mbox.mjs
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
await import(pathToFileURL(join(HERE, "..", "src", "personal-network", "mbox.js")).href);
const M = globalThis.OrbitMbox;

let passed = 0, failed = 0;
function assert(name, condition, detail) {
  if (condition) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + (detail ? "  →  " + detail : "")); }
}
function eq(name, actual, expected) {
  assert(name, JSON.stringify(actual) === JSON.stringify(expected), "got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected));
}

const DAY = 86400000, now = Date.now();
const ago = (d) => new Date(now - d * DAY).toUTCString();

console.log("\n[1] Reading an address");
eq("a bare address", M.addresses("tom@example.com"), [{ name: "", email: "tom@example.com" }]);
eq("a named address", M.addresses("Katie Rose <kate@example.com>"), [{ name: "Katie Rose", email: "kate@example.com" }]);
eq("a quoted name containing a comma", M.addresses('"Rose, Katie" <kate@example.com>, tom@example.com'),
  [{ name: "Rose, Katie", email: "kate@example.com" }, { name: "", email: "tom@example.com" }]);
eq("a base64 encoded name", M.addresses("=?UTF-8?B?SsO2cmc=?= <j@example.com>")[0].name, "Jörg");
eq("a quoted-printable name", M.addresses("=?UTF-8?Q?Ren=C3=A9?= <r@example.com>")[0].name, "René");
eq("addresses are lowercased", M.addresses("Tom <TOM@Example.COM>")[0].email, "tom@example.com");
eq("rubbish is dropped", M.addresses("not-an-address"), []);
eq("a message id becomes a Gmail link", M.gmailLink("abc@mail"), "https://mail.google.com/mail/u/0/#search/rfc822msgid:abc%40mail");

console.log("\n[2] Reading a mailbox");
function message(n, from, to, subject, daysAgo, body) {
  return ["From " + n + " Mon Jan 01 00:00:00 +0000 2024", "From: " + from, "To: " + to,
    "Subject: " + subject, "Message-ID: <m" + n + "@mail>", "Date: " + ago(daysAgo), "", body || "A body.", ""].join("\n");
}
const mbox = [
  message(1, "Katie Rose <kate@example.com>", "me@orbit.test", "Lunch?", 40),
  message(2, "me@orbit.test", "Katie Rose <kate@example.com>, Tom <tom@example.com>", "=?UTF-8?B?UmU6IEx1bmNo?=", 39),
  message(3, "Katie Rose <kate@example.com>", "me@orbit.test", "Photos", 12, "From now on a body line starting with From must not split this."),
  message(4, "Old Friend <old@example.com>", "me@orbit.test", "Ancient", 500),
  message(5, "me@orbit.test", "me@orbit.test", "Note to self", 2),
  ["From 6 Fri Jan 05 00:00:00 +0000 2024", "From: Folded Sender", "  <folded@example.com>", "To: me@orbit.test",
    "Subject: Wrapped", "  header", "Message-ID: <m6@mail>", "Date: " + ago(5), "", "Body."].join("\n")
].join("");
const out = M.summarise(mbox, { mine: ["me@orbit.test"], since: now - 365 * DAY, keepRecent: 5 });
const by = {}; out.people.forEach((r) => { by[r.email] = r; });
eq("every message is read", out.counts.read, 6);
eq("anything older than the window is left out", out.counts.skippedOld, 1);
eq("a message only to yourself is not a correspondence", out.counts.skippedNoParty, 1);
eq("the correspondents", Object.keys(by).sort(), ["folded@example.com", "kate@example.com", "tom@example.com"]);
eq("counted both ways", [by["kate@example.com"].total, by["kate@example.com"].received, by["kate@example.com"].sent], [3, 2, 1]);
eq("the name comes off the header", by["kate@example.com"].name, "Katie Rose");
eq("a body line starting with From splits nothing", by["kate@example.com"].recent.length, 3);
eq("an encoded subject is readable", by["kate@example.com"].recent[0].subject, "Photos");
assert("every kept message links back", by["kate@example.com"].recent.every((m) => /rfc822msgid:/.test(m.link)));
eq("someone only ever cc'd still counts", by["tom@example.com"].total, 1);
eq("a folded header still parses", by["folded@example.com"].name, "Folded Sender");
eq("busiest first", out.people[0].email, "kate@example.com");
eq("the recent list can be capped", M.summarise(mbox, { mine: ["me@orbit.test"], since: now - 365 * DAY, keepRecent: 1 }).people[0].recent.length, 1);
const none = M.summarise(mbox, { mine: ["me@orbit.test"], since: now - 365 * DAY, keepRecent: 0 });
eq("and turned off entirely", none.people[0].recent.length, 0);
eq("without losing the counts", none.people[0].total, 3);
eq("an empty mailbox is safe", M.summarise("", { mine: [] }).people, []);

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
process.exit(failed ? 1 : 0);
