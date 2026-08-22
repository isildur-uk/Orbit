/* orbit-case.js — OrbitCase: the shared entity/link spine for all three functions.
 *
 * One canonical, subscribable case store (localStorage-backed, in-memory fallback
 * for Node/tests) that Charting, Database and Analyse read + write, so the same
 * entities and links are shared live across the product instead of living in three
 * private stores. Entities/links carry STABLE ids derived from their identity, so
 * writes from any function converge (idempotent merge / dedupe) rather than
 * duplicating. Change events fire locally and cross-tab (storage event) so open
 * surfaces can update.
 *
 * Neutral interchange model (converters to CRModel / SI live in the handoff layer):
 *   entity = { id, type, label, identity?, attrs, source, createdBy, ts }
 *   link   = { id, from, to, type, label?, dir, attrs, source, createdBy, ts }
 *
 * Browser: window.OrbitCase. Node: module.exports (in-memory).
 */
(function () {
  "use strict";
  var KEY = "orbit_case_v1";
  var _cache = null;
  var _mem = null;                    // fallback store when no localStorage
  var _memActive = false;             // true once a write has fallen back to memory
  var _lastWriteOk = true;            // did the LAST write reach durable storage?
  var _subs = [];
  var _errSubs = [];

  /* ---- the shared case file (the four per-function .exes) ----------------
   * BROWSER (Orbit-Offline.html, the dev server, any browser): NOTHING BELOW
   * APPLIES. FILE() returns null without window.__ORBIT_NATIVE__, so every
   * path in this module runs the localStorage bodies it ran before, byte for
   * byte - same key, same staleness rule, same size ruling.
   *
   * NATIVE: the four .exes are separate processes with isolated WebView
   * storage, so orbit_case_v1 in one of them is invisible to the other three -
   * ORBIT-Analyse.exe could not see anything ORBIT-Charting.exe recorded. The
   * spine therefore reads and writes the SHARED CASE FILE instead, through
   * OrbitCaseFile, which owns the file, the lock and the atomic write. The
   * spine is ONE SECTION of that one document (`spine`); CRModel.CaseStore is
   * the other. Neither write touches the other's section - the composition
   * rule lives in case-file.js, so there is ONE persistence path, not two.
   */
  function FILE() {
    if (typeof window === "undefined") return null;
    var F = window.OrbitCaseFile;
    if (!F || typeof F.isActive !== "function" || !F.isActive()) return null;
    return (typeof F.readSpine === "function" && typeof F.saveSpine === "function") ? F : null;
  }
  function store() { try { if (typeof localStorage !== "undefined") return localStorage; } catch (e) {} return null; }
  /* Once a write has fallen back to memory (quota, private mode, a locked
   * profile) the localStorage copy is STALE. Reading it again would silently
   * discard everything written since, so memory wins from that point on.
   * Same precedent as registry/core/merge-decisions.js save()/memActive. */
  function readRaw() {
    /* NATIVE: the shared file is the only source. The boot rule (Analyse,
       Database and Context auto-load; CHARTING BOOTS EMPTY) is applied inside
       readSpine() from OrbitCaseFile.autoLoadOnBoot() - the SAME decision the
       chart takes, not a second one invented here. */
    var F = FILE(); if (F) return F.readSpine();
    var s = store(); if (s && !_memActive) { try { return s.getItem(KEY); } catch (e) {} } return _mem;
  }
  /* Returns TRUE only if the case reached durable storage. This used to swallow
   * the quota failure and fall back to memory in silence, so an analyst was
   * never told their case was not saved. A caller that reports "saved" without
   * checking this return value is lying to them. */
  function writeRaw(v) {
    /* NATIVE: hand the payload to the file adapter. It returns FALSE when the
       write is REFUSED (this app is read-only, the file changed underneath us,
       the boot read has not landed), and that false travels straight through to
       persistedOk() - the analyst is told, exactly as a quota failure tells
       them. There is deliberately NO memory fallback here: the adapter keeps a
       queued payload and reports state().pending, so unlike localStorage a
       later successful write really is durable and _memActive must NOT be set.
       That is why the staleness rule above is a localStorage rule only. */
    var F = FILE();
    if (F) {
      var okf = F.saveSpine(v);
      _lastWriteOk = !!okf;
      /* The refusal is NOT re-announced through fireStorageError. That channel
         is localStorage's: the strip it drives (shell/app.js:459) says "this
         browser refused to store it ... the case is now only in this tab's
         memory", and none of that is true of a refused file write - the payload
         is kept, the reason is a lock or a changed file, and the file adapter
         already states it verbatim in state().refusal and on the masthead.
         Saying it twice, once wrongly, is worse than saying it once. */
      return _lastWriteOk;
    }
    var s = store();
    if (!s) { _mem = v; _memActive = true; _lastWriteOk = false; return false; }
    try { s.setItem(KEY, v); _lastWriteOk = true; return true; }
    catch (e) {
      _mem = v; _memActive = true; _lastWriteOk = false;
      fireStorageError((e && e.name) ? String(e.name) : "write failed");
      return false;
    }
  }
  /* A failed write is SURFACED, not swallowed: subscribers are told, and a DOM
   * event is dispatched as well so a surface not wired to this module still has
   * something to listen for. `level` is "error" (the write did not reach
   * storage) or "warning" (it did, but the case is close to the limit and the
   * next few writes will not). */
  function fireStorageError(reason, level) {
    var info = {
      key: KEY, reason: reason, level: level || "error",
      memoryOnly: _memActive, bytes: _bytes, limitBytes: SOFT_LIMIT
    };
    _errSubs.slice().forEach(function (fn) { try { fn(info); } catch (e) {} });
    try {
      if (typeof window !== "undefined" && window.dispatchEvent && typeof CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("orbitcase:storage-failed", { detail: info }));
      }
    } catch (e) {}
  }

  function str(x) { return (x == null) ? "" : String(x); }
  function norm(x) { return str(x).toLowerCase().replace(/\s+/g, " ").replace(/^ | $/g, ""); }
  function nowTs() { return Date.now(); }

  function emptyCase() { return { schema: "orbit.case.v1", name: "", updated: 0, entities: [], links: [] }; }

  /* Assertions are stored compact (short keys, empties omitted) so the shared
   * case does not grow an order of magnitude the moment values carry their
   * sources. Reading puts them back into the full form the rest of the product
   * uses. Runs once per load, and load() is cached. */
  function expandCase(o) {
    var A = ASSERT(); if (!A || !A.unpackCase) return;
    try { A.unpackCase(o); } catch (e) { /* a corrupt table must not lose the case */ }
  }
  /* The serialised form, with the repeating report-level fields hoisted into one
   * source table. RE-MEASURED (Owen, Phase 4 audit) on 1,000 spine entities from
   * 200 reports carrying 6 attributes each: bare attributes 225 KB; the full
   * assertion form 3.6 MB (16.0x bare); the toJSON compact form 1.64 MB; packed
   * 810 KB - 3.6x bare, and 4.4x smaller than the full form. The earlier figures
   * in this comment (460 KB / 6.7x) were wrong by 1.7x and are corrected here.
   * An independent re-run on the same shape gave 260 KB / 3.67 MB / 889 KB: the
   * absolute figures move with attribute value length and with what "bare" is
   * taken to include, but the band (full ~15x bare, packed ~3.5x bare) holds.
   * The real ceiling that follows: about 5,000 spine entities against the 4 MB
   * soft limit below (re-run: 4,607), and that limit is SHARED with the chart
   * autosave, so the spine's own share is smaller again. */
  function packed() {
    var c = load(), A = ASSERT();
    if (!A || !A.packCase) return c;
    try { return A.packCase(c); } catch (e) { return c; }
  }

  function load() {
    if (_cache) return _cache;
    var raw = readRaw();
    if (raw) { try { var o = JSON.parse(raw); if (o && o.schema) { o.entities = o.entities || []; o.links = o.links || []; expandCase(o); _cache = o; _idx = null; return o; } } catch (e) {} }
    _cache = emptyCase();
    _idx = null;
    return _cache;
  }
  /* ---- honest size limit (P3 close-out ruling: stay on localStorage) ----
   * localStorage gives an origin roughly 5 MB, and the spine SHARES that with
   * the chart autosave (chart_room_case_v1) and everything else Orbit keeps
   * there, so the spine's real share is smaller again. A measured 100,000-entity
   * case serialises to about 18 MB: it cannot live here, and a store that only
   * discovers that at the quota wall is the failure this pass exists to close.
   *
   * So the limit is STATED and watched rather than found by accident. Crossing
   * the warn line tells the analyst BEFORE a write is lost; the quota failure,
   * if it still comes, is surfaced through the same channel. IndexedDB is the
   * right home for a case this size, but its API is asynchronous and the spine
   * is written from inside the chart's synchronous edit path, so that move is a
   * separate piece of work, not a line change. */
  var SOFT_LIMIT = 4 * 1024 * 1024;      // characters of serialised JSON
  var WARN_AT = 0.8;
  var _bytes = 0;                        // size of the LAST serialisation
  var _warned = false;                   // warn once per session, not per write
  var _dirty = false;                    // a deferred write is waiting for flush()

  function persist() {
    var c = load();
    c.updated = nowTs();
    var json = JSON.stringify(packed());
    _bytes = json.length;
    /* The soft limit is a LOCALSTORAGE fact - the ~5 MB origin quota the spine
       shares with the chart autosave. A shared case FILE on disk has no such
       ceiling, so warning a native analyst that they are "close to this
       browser's storage limit" at 3.2 MB would be a false alarm. The
       measurement below still runs and stats() still reports it; only the
       warning is browser-only. The limit itself is unchanged. */
    if (!FILE() && !_memActive && !_warned && _bytes >= SOFT_LIMIT * WARN_AT) {
      _warned = true;
      fireStorageError("approaching the storage limit", "warning");
    }
    var okw = writeRaw(json);
    _dirty = false;
    fire();
    return okw;
  }
  /* `persisted` is the SHARED case reaching durable storage, not the last
   * setItem returning without throwing. Once a write has fallen back to memory
   * the localStorage copy is stale and is never read again, so a later
   * successful setItem does not make the case saved -- reporting persisted:true
   * from that point told the analyst their case was safe when it was not. */
  function persistedOk() { return _lastWriteOk && !_memActive; }
  /* Deferred writes (opts.defer) change the in-memory case and leave the store
   * write to the caller. flush() is how that caller finishes the job. Without
   * it a deferred write is indistinguishable from a lost one. */
  function flush() { if (!_dirty) return persistedOk(); _dirty = false; return persist(); }
  function dirty() { return _dirty; }
  function fire() { var c = load(), meta = { persisted: persistedOk(), memoryOnly: _memActive }; _subs.slice().forEach(function (fn) { try { fn(c, meta); } catch (e) {} }); }

  /* ---- identity → stable id ---- */
  /* Type-aware identifier canonicalisation so the SAME real-world identifier
   * yields the SAME id no matter which function contributed it (Analyse comms,
   * Database IRs, Charting). Closes the "07700 900111" vs "07700900111" gap. */
  function canonicalIdentity(type, value) {
    var t = str(type).toLowerCase(), v = str(value);
    if (t === "phone") {                                          // UK-national canonical so
      if (/[a-zA-Z]/.test(v.replace(/^\s*\+/, ""))) return "";       // corrupt (sci-notation/gibberish)
      var plus = /^\s*\+/.test(v), d = v.replace(/\D/g, "");        // 447.. / +44.. / 0044.. / 07.. / 7..
      if (!d) return "";                                          // all collapse to one 0.. key
      if (plus && d.indexOf("44") === 0) return "0" + d.slice(2);
      if (d.indexOf("0044") === 0) return "0" + d.slice(4);
      if (!plus && d.indexOf("44") === 0 && d.length >= 12) return "0" + d.slice(2);
      if (plus) return "00" + d;                                  // non-UK +CC -> 00CC
      if (d.charAt(0) === "0") return d;                          // already national
      if (d.length === 9 || d.length === 10) return "0" + d;      // dropped leading 0 (07.. -> 7..)
      return d;                                                   // bare non-UK / unknown: stable as-is
    }
    if (t === "vehicle") return v.replace(/\s+/g, "");           // VRM: drop spaces (norm lowercases)
    if (t === "account") return v.replace(/[\s\-]/g, "");        // sort code / acct: drop spaces + dashes
    return v;                                                    // others: norm() handles case + whitespace
  }
  function identityKey(e) {
    var t = str(e.type).toLowerCase();
    var raw = (e.identity != null && str(e.identity) !== "") ? e.identity : e.label;
    return t + "|" + norm(canonicalIdentity(t, raw));
  }
  function entityId(e) { return "E:" + identityKey(e); }
  function linkId(l) { return "L:" + str(l.from) + "|" + str(l.type).toLowerCase() + "|" + str(l.to); }

  function indexBy(arr, key) { var m = {}; arr.forEach(function (x) { m[x[key]] = x; }); return m; }

  /* The id index, CACHED against the current case rather than rebuilt per call.
   * Building it inside merge() was already the fix for "rebuilt per entity", but
   * a caller that merges repeatedly (one chart edit at a time, one Analyse
   * commit at a time) paid O(entities + links) on EVERY call: measured at 8,000
   * one-link merges against a 2,000-entity spine, 5.5 s of pure index building.
   * Invalidated wherever the arrays are replaced wholesale; upserts keep it in
   * step as they push. Nothing outside this module mutates the case arrays
   * (get() is read-only to both of its two callers). */
  var _idx = null;
  function idx() {
    var c = load();
    if (!_idx) _idx = { e: indexBy(c.entities, "id"), l: indexBy(c.links, "id") };
    return _idx;
  }
  function dropIdx() { _idx = null; }

  /* ---- contributions (who asserted this, so it can be withdrawn) ----
   * A spine entity is an index of assertions from several surfaces. `contrib`
   * on a write records WHICH assertion put it there ("registry|IR-123",
   * "charting|ent_x1"). withdraw() then follows the DELETE-vs-DETACH rule that
   * registry/core/deletion.js already sets: an entity another contributor still
   * asserts is DETACHED (that contribution drops, the entity stays); an entity
   * left with no contributor at all is DELETED. An entity that never carried a
   * contribution (legacy rows, Analyse commits) is never removed by a withdraw —
   * silence is not consent to delete someone else's data. */
  /* [P4] ASSERTIONS ON THE SPINE. A contribution used to be recorded against the
   * whole entity, so withdrawing a report could only take the entity away or
   * leave it whole - there was no level at which "this report said the DOB was
   * 01/01/1980, and it no longer does" could be expressed. Now every value
   * written here arrives with the assertion that made it (_shared/core/assertions.js,
   * record_store_PROPOSAL.md 3.1), so withdrawal reaches VALUES: a value another
   * report still asserts stays, a value nothing is left to assert goes, and the
   * entity itself follows the same DETACH-vs-DELETE rule it already followed.
   *
   * A caller that knows its provenance supplies `assertions` (the registry does,
   * carrying URN, item, 3x5x2, handling, marking and PND-share). A caller that
   * supplies only bare attrs has them turned into assertions here, attributed to
   * whatever it named itself. A caller that names nothing writes no assertion:
   * its values are legacy, they are never claimed by a withdrawal, and silence
   * is not consent to delete someone else's data. */
  function ASSERT() {
    if (typeof window !== "undefined" && window.OrbitAssertions) return window.OrbitAssertions;
    if (typeof require === "function") { try { return require("./assertions.js"); } catch (e) { /* absent */ } }
    return null;
  }
  function firstContrib(c) {
    if (c == null) return "";
    return str(Array.isArray(c) ? c[0] : c);
  }
  function mergeAssertions(target, src) {
    var A = ASSERT(); if (!A) return;
    var bag = target.assertions || (target.assertions = {});
    var supplied = src.assertions;
    if (supplied && typeof supplied === "object") {
      Object.keys(supplied).forEach(function (k) {
        (supplied[k] || []).forEach(function (a) {
          if (!A.isAssertion(a)) return;                 // a bare value is not an assertion
          var list = bag[k] || (bag[k] = []);
          for (var i = 0; i < list.length; i++) {
            var x = list[i];
            if (x.value === a.value && x.contrib === a.contrib && x.urn === a.urn && x.assertedBy === a.assertedBy) { x.count++; return; }
          }
          list.push(a);
        });
      });
      return;
    }
    var contrib = firstContrib(src.contrib);
    var by = contrib || str(src.source) || str(src.createdBy);
    if (!by) return;
    var meta = { assertedBy: by, contrib: contrib, surface: str(src.source),
                 assertedAt: new Date().toISOString() };
    try {
      Object.keys(src.attrs || {}).forEach(function (k) {
        var v = src.attrs[k];
        if (k.charAt(0) === "_" || v == null || v === "" || typeof v === "object") return;
        A.add(bag, k, v, meta);
      });
      if (src.label) A.add(bag, "label", src.label, meta);
    } catch (e) { /* an assertion refused for want of a value or an asserter */ }
  }
  /* Take one contributor's assertions out of one entity or link. Returns what
   * actually changed, so a caller can report it rather than claim it. */
  function sweepAssertions(target, keys, out) {
    var A = ASSERT();
    if (!A || !target.assertions) return;
    var r = A.withdraw(target.assertions, Object.keys(keys));
    if (!r.changed) return;
    out.assertionsWithdrawn += r.withdrawn;
    out.valuesDetached += r.detachedKeys.length;
    out.valuesRemoved += r.removedKeys.length;
    /* The legacy bare-value projection follows the assertions: a key nothing
     * asserts any more loses its value; a key another source still asserts keeps
     * one, re-projected from what is left rather than from what was removed. */
    if (target.attrs) {
      r.removedKeys.forEach(function (k) { if (k !== "label") delete target.attrs[k]; });
      r.detachedKeys.forEach(function (k) {
        if (k === "label") return;
        var live = A.order(target.assertions[k]);
        if (live.length) target.attrs[k] = live[0].value;
      });
    }
  }

  function addContribs(target, contrib) {
    if (contrib == null || contrib === "") return;
    var list = Array.isArray(contrib) ? contrib : [contrib];
    if (!target.contribs) target.contribs = [];
    list.forEach(function (c) {
      c = str(c); if (!c) return;
      if (target.contribs.indexOf(c) === -1) target.contribs.push(c);
    });
  }

  /* ---- writes (idempotent) ---- */
  function upsertEntity(e, opts) {
    e = e || {}; opts = opts || {};
    var c = load();
    var id = e.id || entityId(e);
    /* opts.index lets a bulk caller (merge) build the id map ONCE. Without it
     * this rebuilt the whole map per entity, so publishing N entities was
     * O(N^2): 5,000 chart nodes took 1.7 s and a 100k-row CDR import would have
     * taken minutes of pure index rebuilding, inside the chart's edit path. */
    var eIdx = opts.index || idx().e;
    var cur = eIdx[id];
    var ent = cur || { id: id, type: str(e.type) || "entity", label: str(e.label), identity: str(e.identity), attrs: {}, source: str(e.source), createdBy: str(e.createdBy), ts: nowTs() };
    if (e.label && !cur) ent.label = str(e.label);
    if (e.label && cur && !ent.label) ent.label = str(e.label);
    if (e.attrs) { for (var k in e.attrs) if (e.attrs.hasOwnProperty(k) && e.attrs[k] != null && e.attrs[k] !== "") ent.attrs[k] = e.attrs[k]; }
    if (e.source && !ent.source) ent.source = str(e.source);
    addContribs(ent, e.contrib);
    mergeAssertions(ent, e);
    if (!cur) { c.entities.push(ent); eIdx[id] = ent; if (_idx && opts.index) _idx.e[id] = ent; }
    if (opts.defer !== true) persist(); else _dirty = true;
    return ent;
  }
  function upsertLink(l, opts) {
    l = l || {}; opts = opts || {};
    var c = load();
    var id = l.id || linkId(l);
    var lIdx = opts.index || idx().l;
    var cur = lIdx[id];
    var lk = cur || { id: id, from: str(l.from), to: str(l.to), type: str(l.type) || "LINKED_TO", label: str(l.label), dir: l.dir || "->", attrs: {}, source: str(l.source), createdBy: str(l.createdBy), ts: nowTs() };
    if (l.attrs) { for (var k in l.attrs) if (l.attrs.hasOwnProperty(k) && l.attrs[k] != null && l.attrs[k] !== "") lk.attrs[k] = l.attrs[k]; }
    if (l.label && !lk.label) lk.label = str(l.label);
    addContribs(lk, l.contrib);
    mergeAssertions(lk, l);
    if (!cur) { c.links.push(lk); lIdx[id] = lk; if (_idx && opts.index) _idx.l[id] = lk; }
    if (opts.defer !== true) persist(); else _dirty = true;
    return lk;
  }
  // Batch merge a set of entities + links (one persist + one event).
  function merge(part, opts) {
    part = part || {}; opts = opts || {};
    var c = load();
    var m = idx(), eIdx = m.e, lIdx = m.l;      // cached, kept in step by the upserts below
    (part.entities || []).forEach(function (e) { upsertEntity(e, { defer: true, index: eIdx }); });
    (part.links || []).forEach(function (l) { upsertLink(l, { defer: true, index: lIdx }); });
    if (opts.defer !== true) persist(); else _dirty = true;
    return stats();
  }

  /* Withdraw everything one contributor asserted. DETACH where another
   * contributor still asserts the entity, DELETE where none is left; links are
   * dropped with their endpoints. Returns real counts so a caller can say what
   * actually happened rather than claiming a clean removal. */
  function withdraw(contrib, opts) {
    opts = opts || {};
    var key = str(contrib);
    var out = { contrib: key, detached: 0, deleted: 0, linksDetached: 0, linksDeleted: 0,
                assertionsWithdrawn: 0, valuesDetached: 0, valuesRemoved: 0, persisted: persistedOk() };
    if (!key) return out;
    var c = load(), goneIds = {}, myKeys = {};
    myKeys[key] = 1;
    c.entities = c.entities.filter(function (e) {
      /* [P4] Values first: this report's assertions come out of every record
       * that carries them, whether or not the report is the entity's only
       * contributor. A record another source still asserts survives with that
       * source's values; a value nothing is left to assert goes with it. */
      sweepAssertions(e, myKeys, out);
      if (!e.contribs || e.contribs.indexOf(key) === -1) return true;
      e.contribs = e.contribs.filter(function (x) { return x !== key; });
      if (e.contribs.length) { out.detached++; return true; }
      goneIds[e.id] = true; out.deleted++; return false;
    });
    c.links = c.links.filter(function (l) {
      sweepAssertions(l, myKeys, out);
      var endpointGone = goneIds[l.from] || goneIds[l.to];
      var mine = l.contribs && l.contribs.indexOf(key) !== -1;
      if (mine) {
        l.contribs = l.contribs.filter(function (x) { return x !== key; });
        if (l.contribs.length && !endpointGone) { out.linksDetached++; return true; }
        out.linksDeleted++; return false;
      }
      if (endpointGone) { out.linksDeleted++; return false; }
      return true;
    });
    dropIdx();
    if (opts.defer !== true) out.persisted = persist(); else _dirty = true;
    return out;
  }

  /* Withdraw MANY contributors in ONE pass. withdraw() is O(entities + links)
   * per call, so withdrawing D contributions one at a time is O(D x N) — the
   * same quadratic the id-index rebuild had. Clearing a 4,000-node chart took
   * 843 ms of pure filtering (500 -> 17 ms, 1,000 -> 44 ms, 2,000 -> 194 ms,
   * 4,000 -> 843 ms: a clean N^2), and a cleared 100k-row import would have
   * frozen the tab for minutes. Same DETACH-vs-DELETE rule, one traversal.
   * (Priya, P3 audit.) */
  function withdrawMany(contribs, opts) {
    opts = opts || {};
    var list = Array.isArray(contribs) ? contribs : [contribs];
    var keys = {}, n = 0;
    list.forEach(function (x) { var k = str(x); if (k && !keys[k]) { keys[k] = 1; n++; } });
    var out = { contribs: n, detached: 0, deleted: 0, linksDetached: 0, linksDeleted: 0,
                assertionsWithdrawn: 0, valuesDetached: 0, valuesRemoved: 0, persisted: persistedOk() };
    if (!n) return out;
    var c = load(), goneIds = {};
    c.entities = c.entities.filter(function (e) {
      sweepAssertions(e, keys, out);
      if (!e.contribs || !e.contribs.length) return true;
      var kept = e.contribs.filter(function (x) { return !keys[x]; });
      if (kept.length === e.contribs.length) return true;       // none of ours
      e.contribs = kept;
      if (kept.length) { out.detached++; return true; }
      goneIds[e.id] = true; out.deleted++; return false;
    });
    c.links = c.links.filter(function (l) {
      sweepAssertions(l, keys, out);
      var endpointGone = goneIds[l.from] || goneIds[l.to];
      if (l.contribs && l.contribs.length) {
        var kept = l.contribs.filter(function (x) { return !keys[x]; });
        if (kept.length !== l.contribs.length) {
          l.contribs = kept;
          if (kept.length && !endpointGone) { out.linksDetached++; return true; }
          out.linksDeleted++; return false;
        }
      }
      if (endpointGone) { out.linksDeleted++; return false; }
      return true;
    });
    dropIdx();
    if (opts.defer !== true) out.persisted = persist(); else _dirty = true;
    return out;
  }

  /* Hard-remove an entity by id, whatever asserted it. Takes its links and the
   * fact/note entities contributed solely for it ("ent:<id>"). Unlike withdraw()
   * this does not need a contribution, so a legacy or import-created record with
   * no contrib can still be deleted. */
  function removeEntity(id, opts) {
    opts = opts || {};
    id = str(id);
    if (!id) return stats();
    var c = load(), gone = {};
    gone[id] = true;
    c.entities = c.entities.filter(function (e) {
      if (e.id === id) return false;
      if (e.contribs && e.contribs.length === 1 && e.contribs[0] === "ent:" + id) { gone[e.id] = true; return false; }
      return true;
    });
    c.links = c.links.filter(function (l) { return !(gone[l.from] || gone[l.to]); });
    dropIdx();
    if (opts.defer !== true) persist();
    return stats();
  }

  /* ---- reads ---- */
  function get() { return load(); }
  function entities() { return load().entities.slice(); }
  function links() { return load().links.slice(); }
  /* `persisted` travels with every write result on purpose: a count of entities
   * that never reached storage is not a result, it is a false reassurance. */
  function stats() {
    var c = load();
    return {
      entities: c.entities.length, links: c.links.length,
      persisted: persistedOk(), memoryOnly: _memActive,
      bytes: _bytes, limitBytes: SOFT_LIMIT, nearLimit: _bytes >= SOFT_LIMIT * WARN_AT
    };
  }
  /* What the spine will actually hold, so a caller can say so rather than
   * implying the case is unbounded. */
  function limits() { return { bytes: _bytes, limitBytes: SOFT_LIMIT, warnAtBytes: Math.round(SOFT_LIMIT * WARN_AT) }; }
  function memoryOnly() { return _memActive; }
  function lastWriteOk() { return _lastWriteOk; }
  function onStorageError(fn) {
    if (typeof fn !== "function") return function () {};
    _errSubs.push(fn);
    return function () { var i = _errSubs.indexOf(fn); if (i !== -1) _errSubs.splice(i, 1); };
  }
  function name() { return load().name; }
  function setName(n) { load().name = str(n); persist(); return load().name; }
  function clear() { _cache = emptyCase(); _idx = null; _dirty = false; writeRaw(JSON.stringify(_cache)); fire(); }

  /* The shared case file changed and the adapter adopted it. Drop the parsed
     copy so the next read comes from the file, and tell subscribers. Called by
     OrbitCaseFile only, and only when the boot rule allows this surface to take
     the shared case - a Charting process that never opened it is never handed
     one. UNSAVED DEFERRED WRITES ARE NOT DISCARDED: if a caller has changed the
     case and not yet flushed, the in-memory case stands and the analyst is
     told, rather than losing work to another app's save. */
  function fileChanged() {
    if (_dirty) {
      fireStorageError("the shared case file changed while unsaved spine changes were held; they have NOT been discarded", "warning");
      return false;
    }
    _cache = null; _idx = null; _warned = false;
    fire();
    return true;
  }

  /* ---- subscription (local + cross-tab) ---- */
  function subscribe(fn) {
    if (typeof fn !== "function") return function () {};
    _subs.push(fn);
    return function () { var i = _subs.indexOf(fn); if (i !== -1) _subs.splice(i, 1); };
  }
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("storage", function (e) { if (e.key === KEY) { _cache = null; _idx = null; fire(); } });
  }

  var api = {
    KEY: KEY,
    get: get, entities: entities, links: links, stats: stats, limits: limits,
    flush: flush, dirty: dirty,
    upsertEntity: upsertEntity, upsertLink: upsertLink, merge: merge, withdraw: withdraw, withdrawMany: withdrawMany, removeEntity: removeEntity,
    name: name, setName: setName, clear: clear,
    subscribe: subscribe, onStorageError: onStorageError,
    memoryOnly: memoryOnly, lastWriteOk: lastWriteOk,
    entityId: entityId, linkId: linkId, identityKey: identityKey, canonicalIdentity: canonicalIdentity,
    _fileChanged: fileChanged,
    _reset: function () { _cache = null; _idx = null; _mem = null; _memActive = false; _lastWriteOk = true; _bytes = 0; _warned = false; _dirty = false; _subs = []; _errSubs = []; var s = store(); if (s) { try { s.removeItem(KEY); } catch (e) {} } }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.OrbitCase = api;
  /* Hand the spine to the file adapter. case-file.js is loaded FIRST on purpose
     (index.html:501, before model.js and before this file), so this binding is
     made at parse time and the adapter can reach the spine without hunting for
     a global. It falls back to window.OrbitCase if this never runs. */
  if (typeof window !== "undefined" && window.OrbitCaseFile && typeof window.OrbitCaseFile.bindSpine === "function") {
    try { window.OrbitCaseFile.bindSpine(api); } catch (e) { /* the spine must load even if the adapter is broken */ }
  }
})();
