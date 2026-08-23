/* Layout maths tests — the SOLAR-parity arrangements in layouts.js.
 *
 * Verifies each layout returns finite, non-degenerate coordinates for every
 * node (or hands off to physics, for Force), and that the app-owned "orbit"/
 * "free" kinds are left alone. Run: node scripts/test-layouts.mjs
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = join(HERE, "..", "src", "personal-network");
await import(pathToFileURL(join(BASE, "layouts.js")).href);
const L = globalThis.OrbitLayouts;

let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log("  PASS  " + name)) : (failed++, console.log("  FAIL  " + name)); }

const nodes = [
  { id: "ME", label: "ME", group: "me" },
  { id: "a", label: "Alex", group: "individual" },
  { id: "b", label: "Bea", group: "individual" },
  { id: "c", label: "Cy Corp", group: "organisation" },
  { id: "d", label: "Di", group: "individual" },
  { id: "e", label: "Ez", group: "individual" }
];
const links = [["ME", "a"], ["ME", "b"], ["ME", "c"], ["ME", "d"], ["a", "b"], ["e", "a"]].map(([from, to]) => ({ from, to }));
const finite = (r) => Object.keys(r.positions || {}).every((k) => isFinite(r.positions[k].x) && isFinite(r.positions[k].y));
const uniq = (r) => new Set(Object.values(r.positions).map((p) => p.x + "," + p.y)).size;

console.log("\n[layouts] every SOLAR-parity kind places nodes cleanly");
for (const kind of L.kinds) {
  const r = L.compute(kind, nodes, links);
  ok(kind + " returns a result", !!r);
  if (kind === "force") { ok("force defers to physics", r.physics === true && r.positions === null); continue; }
  ok(kind + " positions every node", Object.keys(r.positions).length === nodes.length);
  ok(kind + " all coordinates finite", finite(r));
  ok(kind + " physics disabled (explicit coords)", r.physics === false);
  ok(kind + " nodes are not stacked on one point", uniq(r) >= nodes.length - 1);
}

console.log("\n[layouts] edge cases + app-owned kinds");
ok("orbit is left to the app (null)", L.compute("orbit", nodes, links) === null);
ok("free is left to the app (null)", L.compute("free", nodes, links) === null);
ok("has() recognises a real kind", L.has("peacock") === true);
ok("has() rejects an app kind", L.has("orbit") === false);
ok("empty graph is safe", (() => { const r = L.compute("peacock", [], []); return r && Object.keys(r.positions).length === 0; })());
ok("single node is safe", (() => { const r = L.compute("grouped", [{ id: "x", label: "X", group: "individual" }], []); return finite(r) && Object.keys(r.positions).length === 1; })());
ok("disconnected nodes still placed (peacock foot row)", (() => {
  const r = L.compute("peacock", nodes.concat([{ id: "z", label: "Zed", group: "individual" }]), links);
  return finite(r) && r.positions["z"] && isFinite(r.positions["z"].x);
})());

console.log("\n----------------------------------------");
console.log("  " + passed + " passed, " + failed + " failed");
console.log("----------------------------------------\n");
process.exit(failed ? 1 : 0);
