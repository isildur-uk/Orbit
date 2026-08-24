/* Instagram paste route: the HTML flavour of a copied follower list keeps the
 * avatars, and the owner + direction survive the filename reviewPasted()
 * synthesises. Plain text imports the same accounts with no pictures. */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const BASE = "c:/Users/44752/Documents/Claude/Projects/Personal_Network/src/personal-network";
await import(pathToFileURL(join(BASE, "classify.js")).href);
await import(pathToFileURL(join(BASE, "importers.js")).href);
const I = globalThis.OrbitNetworkImporters;
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); } };

const ACCOUNTS = [
  ["kate_tollworthy", "Katie Rose"], ["tombrimble_2", "Tom"], ["pippasyddall", "Pippa Syddall"],
  ["negeen000", "Negeen Arasteh"], ["____roseane_", ""], ["iainjwilson", "Iain Wilson"], ["leahbowhay", "Leah Bowhay"]
];
const HTML = "<div>" + ACCOUNTS.map(([h, d]) =>
  `<div><img alt="${h}'s profile picture" src="https://scontent.cdninstagram.com/${h}.jpg">` +
  `<a href="/${h}/">${h}</a>${d ? "<span>" + d + "</span>" : ""}<button>Follow</button></div>`).join("") + "</div>";
const PLAIN = ACCOUNTS.map(([h, d]) => d ? h + "\n" + d : h).join("\n");

/* reviewPasted() synthesises this name from ME's handle + the chosen direction. */
const NAME = "benwlsn11_IG_Followers";
ok("synthesised name yields owner + direction",
  JSON.stringify(I.handleListMeta(NAME)) === JSON.stringify({ owner: "benwlsn11", direction: "follower" }),
  JSON.stringify(I.handleListMeta(NAME)));

const c = I.review(HTML, NAME).candidates || [];
console.log("  HTML candidates:", c.length, "| with avatar:", c.filter((x) => x.avatarUrl).length);
ok("every account read from the HTML", c.length === ACCOUNTS.length, "got " + c.length);
ok("every account carries an avatar", c.filter((x) => x.avatarUrl).length === ACCOUNTS.length,
  JSON.stringify(c.map((x) => x.igHandle + "=" + !!x.avatarUrl)));
ok("direction set on every candidate", c.every((x) => x.igDirection === "follower"), JSON.stringify(c.map((x) => x.igDirection)));
ok("owner set on every candidate", c.every((x) => String(x.igOwner || "").toLowerCase() === "benwlsn11"), JSON.stringify(c.map((x) => x.igOwner)));
ok("the account with no display name keeps its OWN avatar",
  (c.find((x) => x.igHandle === "____roseane_") || {}).avatarUrl === "https://scontent.cdninstagram.com/____roseane_.jpg",
  JSON.stringify(c.find((x) => x.igHandle === "____roseane_")));
ok("avatars pair by handle, not by position",
  c.every((x) => x.avatarUrl === "https://scontent.cdninstagram.com/" + x.igHandle + ".jpg"),
  JSON.stringify(c.map((x) => x.avatarUrl)));

const c2 = I.review(HTML, "benwlsn11_IG_Following").candidates || [];
ok("the other direction is read the other way", c2.every((x) => x.igDirection === "following"));

/* Plain text of the same list: what Ben actually has on disk. */
const c3 = I.review(PLAIN, NAME).candidates || [];
ok("plain text still imports the accounts", c3.length === ACCOUNTS.length, String(c3.length));
ok("plain text sets direction + owner too", c3.every((x) => x.igDirection === "follower" && String(x.igOwner || "").toLowerCase() === "benwlsn11"));
ok("plain text carries NO avatars — the original problem", c3.every((x) => !x.avatarUrl));
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
