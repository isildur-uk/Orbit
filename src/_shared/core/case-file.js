/* ORBIT - case-file.js
 * The shared case file on disk, and the write lock over it.
 *
 * WHY THIS EXISTS
 * ORBIT ships as one conjoined app AND as four per-function .exes (Analyse,
 * Charting, Database, Context). Separate processes cannot share an in-process
 * spine, so the four .exes share ONE CASE FILE ON DISK instead. That file is
 * the thing that makes them talk to each other.
 *
 * THE ONE RULE THAT OUTRANKS EVERYTHING HERE
 * When window.__ORBIT_NATIVE__ is ABSENT (a plain browser - which is what
 * standalone/Orbit-Offline.html is), this module is INERT. model.js checks
 * isActive() and, when it is false, runs its original localStorage bodies
 * unchanged. Nothing in this file may alter browser behaviour.
 *
 * THE NATIVE CONTRACT (implemented in Rust by the Tauri lane; all Promises)
 *   caseFilePath()        -> string
 *   readCase()            -> {json, mtimeMs} | null
 *   writeCase(jsonString) -> {mtimeMs}   (rejects if we do not hold the lock)
 *   acquireLock()         -> {ok:true} | {ok:false, heldBy:{app,pid,sinceISO}}
 *   releaseLock()         -> {ok:true}
 *   forceLock()           -> {ok:true, tookFrom:{app,pid,sinceISO}}
 *   lockHolder()          -> null | {app,pid,sinceISO}
 *   onCaseChanged(cb)     -> unsubscribe fn
 *
 * ATOMICITY IS A CONTRACT ON writeCase, NOT SOMETHING THIS FILE CAN DO.
 * A case file is an evidential record. writeCase MUST write to a temp file in
 * the same directory and rename() over the target (the pattern already used at
 * src/tools/gen-corpus-reports.js:253). It must never truncate the live file.
 * What this layer can guarantee, and does:
 *   - the payload is fully serialised BEFORE the native call - never a partial
 *     string, never a stream;
 *   - a payload that does not parse as a case is REFUSED, not written;
 *   - only one writeCase is ever in flight (later saves coalesce), so two
 *     half-finished writes can never interleave on one file.
 *
 * TWO STORES, ONE FILE. ORBIT has two case stores, not one:
 *   CRModel.CaseStore  (chart_room_case_v1) - charting, registry/database
 *   window.OrbitCase   (orbit_case_v1)      - the spine, which Analyse reads
 * Analyse holds no CaseStore at all, so wiring only CaseStore through this file
 * left ORBIT-Analyse.exe unable to see anything ORBIT-Charting.exe recorded.
 * Both now share ONE file, as TWO TOP-LEVEL SECTIONS of one document:
 *   { app, version, meta, entities, links, suggestions, events, spineIds,
 *     spine: { schema:"orbit.case.v1", ... } }          <- the spine section
 * ONE file, not two, because the native contract above exposes exactly ONE
 * path, ONE lock and ONE change feed. A second file would need new Rust
 * methods and a second lock protocol, and would let the two halves of one
 * case be saved, copied or restored apart - which for an evidential record is
 * worse than the problem it solves.
 * NEITHER SECTION MAY CLOBBER THE OTHER. Every write here is composed against
 * the newest document this process has committed to writing (the queued
 * payload if one is still waiting, else the last read/write), and replaces
 * ONLY its own section. CaseStore.fromJSON ignores the extra `spine` key
 * (model.js:1198), so no reader had to change.
 *
 * Browser: window.OrbitCaseFile. Node: module.exports (for the test harness).
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * state
   * ------------------------------------------------------------------ */

  var S = {
    native: false,        /* __ORBIT_NATIVE__ present                      */
    ready: false,         /* init() has settled                            */
    app: "",              /* which of the four functions this process is   */
    surface: "",          /* normalised surface key - drives the boot rule  */
    path: "",             /* absolute path of the shared case file         */
    mode: "browser",      /* "browser" | "write" | "read"                  */
    heldBy: null,         /* {app,pid,sinceISO} when mode === "read"       */
    loaded: false,        /* a case has been read from the file this boot  */
    readSettled: false,   /* the boot read of the file has come back       */
    cache: null,          /* {json, mtimeMs} - the last read from disk     */
    lastWriteMtime: 0,    /* mtime the native side returned for OUR write  */
    lastSavedISO: "",
    pending: false,       /* a save is queued or in flight, i.e. UNSAVED   */
    writeError: "",       /* last write failure, verbatim                  */
    refusal: "",          /* last refused write and why                    */
    blocked: false,       /* writes are held - see blockedReason           */
    blockedReason: "",
    initError: ""
  };

  var N = null;                 /* the native bridge object                */
  var _store = null;            /* the page's shared CaseStore             */
  var _spine = null;            /* the page's OrbitCase spine              */
  var _spineOpened = false;     /* the spine section was opened ON DEMAND  */
  var _listeners = [];
  var _unsubChange = null;
  var _unsubLock = null;
  var _pending = null;          /* the newest un-written payload           */
  var _writing = false;

  var RECOVERY_KEY = "orbit_case_recovery_v1";

  function W() { return (typeof window !== "undefined") ? window : null; }
  function nat() { var w = W(); return (w && w.__ORBIT_NATIVE__) || null; }
  function msg(e) { return (e && (e.message || e.reason)) ? String(e.message || e.reason) : String(e || "unknown error"); }
  function fn(o, k) { return (o && typeof o[k] === "function") ? o[k] : null; }

  /* Every native call is wrapped: the bridge may be absent, may lack a method,
     and may reject. A missing method is a rejected promise, never a throw. */
  function call(name, arg) {
    var f = fn(N, name);
    if (!f) { return Promise.reject(new Error("native method missing: " + name)); }
    try { return Promise.resolve(f.call(N, arg)); }
    catch (e) { return Promise.reject(e); }
  }

  /* ------------------------------------------------------------------ *
   * events - the shell subscribes to render the masthead status line
   * ------------------------------------------------------------------ */

  function state() {
    return {
      native: S.native, ready: S.ready, app: S.app, surface: S.surface,
      path: S.path, buildStamp: buildStamp(),
      fileName: baseName(S.path),
      mode: S.mode, heldBy: holder(), loaded: S.loaded,
      readOnly: isReadOnly(), autoLoad: autoLoadOnBoot(),
      canWrite: S.mode === "write" && !S.blocked,
      pending: S.pending, lastSavedISO: S.lastSavedISO,
      writeError: S.writeError, refusal: S.refusal,
      blocked: S.blocked, blockedReason: S.blockedReason,
      initError: S.initError
    };
  }

  function emit() {
    var snap = state();
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](snap); } catch (e) { /* a bad subscriber cannot break persistence */ }
    }
    var w = W();
    if (w && typeof w.CustomEvent === "function" && typeof w.dispatchEvent === "function") {
      try { w.dispatchEvent(new w.CustomEvent("orbit-case-file", { detail: snap })); } catch (e) { /* noop */ }
    }
  }

  function onChange(cb) {
    if (typeof cb !== "function") { return function () {}; }
    _listeners.push(cb);
    try { cb(state()); } catch (e) { /* noop */ }
    return function () {
      var i = _listeners.indexOf(cb);
      if (i >= 0) { _listeners.splice(i, 1); }
    };
  }

  /* ------------------------------------------------------------------ *
   * the five facts a masthead needs. NO UI HERE - another lane owns that.
   * ------------------------------------------------------------------ */

  /* Which case file is loaded. "" in a browser: there is no file, the case
     lives in localStorage, and a masthead must say that rather than invent a
     path. state().fileName is the same fact, shortened. */
  function path() { return S.path || ""; }

  /* TRUE means: saveCase() WILL REFUSE. That is the useful contract - it is the
     question the caller is actually asking - and it deliberately covers both
     reasons a persist is suppressed: the lock is held elsewhere (mode "read"),
     or writes are held because the file changed underneath us (blocked). Read
     state() for which. FALSE in a browser: localStorage is always writable and
     nothing about this adapter changes that. */
  function isReadOnly() {
    if (!isActive()) { return false; }
    return S.mode !== "write" || S.blocked;
  }

  /* Who holds the write lock, when it is not us. Returns a COPY, so a caller
     rendering it cannot mutate our state. null when we hold it, when it is
     free, or in a browser. */
  function holder() {
    if (!S.heldBy) { return null; }
    return { app: S.heldBy.app || "", pid: S.heldBy.pid || 0, sinceISO: S.heldBy.sinceISO || S.heldBy.since || "" };
  }

  /* The payload build stamp the Rust shell compiled in. "" in a browser. */
  function buildStamp() {
    var w = W();
    var info = w && w.__ORBIT_INFO__;
    return (info && info.buildStamp) ? String(info.buildStamp) : "";
  }

  function baseName(p) {
    var s = String(p || "");
    var i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return i >= 0 ? s.slice(i + 1) : s;
  }

  /* ------------------------------------------------------------------ *
   * which of the four functions is this process?
   * ------------------------------------------------------------------ */

  var LABELS = {
    charting: "Charting", analyse: "Analyse", database: "Database",
    context: "Context", personal: "Personal Network", orbit: "ORBIT"
  };

  /* WHICH SURFACE IS THIS PROCESS? The boot rule below turns on the answer, so
     the order of authority matters and is stated here:
       1  window.__ORBIT_INFO__.surface - written by the Rust shell as an
          initialization script BEFORE any payload script runs, from the compiled
          SURFACE_KEY (native.rs:803, build.rs against desktop/surfaces.json).
          An .exe cannot be mistaken for another, so this cannot be wrong.
       2  window.ORBIT_APP - build/test override.
       3  router/hash - LAST RESORT. It names the tab on screen, not the process,
          so it is a weak signal; read once at init() and only if 1 and 2 are absent.
     MEASURED 21/08: nothing in src/ or desktop/ sets window.ORBIT_APP, so a real
     ORBIT-Charting.exe fell through to (3), resolved to "ORBIT" and made
     autoLoadOnBoot() return TRUE - silently reversing Ben's ruling.
     __ORBIT_INFO__ is the only source actually present in the shipped .exe. */
  function detectSurface() {
    var w = W();
    if (!w) { return "orbit"; }
    var info = w.__ORBIT_INFO__;
    if (info && info.surface) { return String(info.surface).toLowerCase(); }
    if (w.ORBIT_APP) { return String(w.ORBIT_APP).toLowerCase(); }
    var cur = "";
    try { cur = (w.OrbitRouter && w.OrbitRouter.current && w.OrbitRouter.current()) || ""; } catch (e) { cur = ""; }
    if (!cur && w.location && w.location.hash) { cur = String(w.location.hash).replace(/^#/, "").split("&")[0]; }
    cur = String(cur).toLowerCase();
    return LABELS[cur] ? cur : "orbit";
  }

  function detectApp() {
    var key = detectSurface();
    if (LABELS[key]) { return LABELS[key]; }
    var w = W();
    return (w && w.ORBIT_APP) ? String(w.ORBIT_APP) : "ORBIT";
  }

  /* BEN'S BOOT RULING (20/08). Analyse, Database and Context auto-load the
     shared case on start. CHARTING BOOTS EMPTY - that preserves the deliberate
     fresh-launch fix (index.html clears chart_room_case_v1 unless
     window.ORBIT_RESTORE_CASE, and the spine merge in shell/app.js:64 is gated
     behind window.ORBIT_PULL_SPINE_ON_BOOT, default off). Charting opens the
     shared case ON DEMAND via openShared(), wired to a masthead control.
     The CONJOINED app (surface key "orbit") CONTAINS Charting, so it takes the
     same answer: it opens clean, exactly as Orbit-Offline.html does today.
     window.ORBIT_CASE_AUTOLOAD (true/false) overrides, for the shell lane. */
  var NO_AUTOLOAD = { charting: true, orbit: true };

  function autoLoadOnBoot() {
    var w = W();
    if (w && typeof w.ORBIT_CASE_AUTOLOAD === "boolean") { return w.ORBIT_CASE_AUTOLOAD; }
    if (w && w.ORBIT_RESTORE_CASE) { return true; }
    return !NO_AUTOLOAD[S.surface || detectSurface()];
  }

  /* ------------------------------------------------------------------ *
   * init
   * ------------------------------------------------------------------ */

  var _initPromise = null;

  function init(opts) {
    if (_initPromise) { return _initPromise; }
    N = nat();
    S.native = !!N;
    var sk = (opts && (opts.surface || opts.app)) ? String(opts.surface || opts.app).toLowerCase() : "";
    S.surface = LABELS[sk] ? sk : detectSurface();
    S.app = (opts && opts.app) ? String(opts.app) : detectApp();
    if (!S.native) {
      S.mode = "browser";
      S.ready = true;
      _initPromise = Promise.resolve(state());
      return _initPromise;
    }
    S.mode = "read";           /* pessimistic until the lock is actually ours */
    _initPromise = call("caseFilePath")
      .then(function (p) { S.path = String(p || ""); }, function (e) { S.initError = msg(e); })
      .then(function () { return call("acquireLock"); })
      .then(function (r) {
        if (r && r.ok) { S.mode = "write"; S.heldBy = null; }
        else { S.mode = "read"; S.heldBy = (r && r.heldBy) || null; }
      }, function (e) {
        /* Could not even ask for the lock. READ-ONLY is the safe answer: an
           analyst must never be told they hold a lock they do not hold. */
        S.mode = "read"; S.initError = S.initError || msg(e);
      })
      /* THE READ IS UNCONDITIONAL; THE BOOT RULE IS APPLIED WHERE THE CASE IS
         APPLIED, NOT WHERE IT IS READ. Charting still boots empty - loadCase()
         and readSpine() are what the rule gates, and model.js:1392 only calls
         loadLocal when autoLoadOnBoot() is true. But a process that has not
         read the file cannot compose a write over it: ORBIT-Charting.exe
         publishing to the spine would have written a document with no chart
         section and no spine section, destroying both. One read at boot is the
         price of never doing that. */
      .then(function () { return prefetch(); })
      .then(function () { subscribeToDisk(); subscribeToLock(); notifySpine(); })
      .then(function () {
        S.ready = true;
        emit();
        return state();
      });
    return _initPromise;
  }

  /* Read the file into the synchronous cache. loadLocal() is synchronous (it is
     called from CaseStore.shared, which cannot await), so the read has to have
     already happened by the time model.js asks. That is why init() prefetches. */
  function prefetch() {
    return call("readCase").then(function (r) {
      if (r && typeof r.json === "string" && r.json) {
        S.cache = { json: r.json, mtimeMs: Number(r.mtimeMs) || 0 };
      } else {
        S.cache = null;      /* no case file yet - a legitimate empty start */
      }
      S.readSettled = true;
      return S.cache;
    }, function (e) {
      S.cache = null;
      S.initError = msg(e);
      /* The read FAILED - that is not the same as "no case file yet". We do not
         know what is on disk, so a write composed from nothing could destroy
         it. Hold writes and say why, rather than overwrite blind. */
      S.readSettled = true;
      S.blocked = true;
      S.blockedReason = "The case file could not be read (" + msg(e) + "). Saving is held so nothing on disk is overwritten.";
      return null;
    });
  }

  function subscribeToDisk() {
    if (_unsubChange) { return; }
    var f = fn(N, "onCaseChanged");
    if (!f) { return; }
    try { _unsubChange = f.call(N, onDiskChanged) || null; }
    catch (e) { _unsubChange = null; }
  }

  /* THE LOCK CAN BE TAKEN OFF US WHILE WE ARE RUNNING. forceLock() in a sibling
     app is a COOPERATIVE YIELD (native.rs: <case>.lock.force + poll), so this
     process gives its handle up and the shell fires onLockChanged. From that
     moment writeCase() rejects. Without this subscription the app would keep
     believing it could write until the next save failed - i.e. it would LOOK
     like it was saving when it was not. That is the one thing this lane must
     never do, so the mode flips the instant we are told, not on next failure.
     onLockChanged is marked ADDITIVE in shim.js, so its absence is not an error. */
  function subscribeToLock() {
    if (_unsubLock) { return; }
    var f = fn(N, "onLockChanged");
    if (!f) { return; }
    try {
      _unsubLock = f.call(N, function (d) {
        var mine = d && d.holder && Number(d.holder.pid) === selfPid();
        if (mine) { S.mode = "write"; S.heldBy = null; emit(); return; }
        if (S.mode === "write") {
          S.mode = "read";
          S.heldBy = (d && d.holder) || null;
          /* An unwritten payload is NOT dropped. It stays queued and pending
             stays true; the analyst is told, and takeOver() flushes it. */
          if (_pending !== null || _writing) {
            S.pending = true;
            S.writeError = "The write lock was taken by " + ((d && d.to) || "another ORBIT app") + " before this change was written. It has NOT been saved.";
          }
          emit();
          refreshHolder();
        }
      }) || null;
    } catch (e) { _unsubLock = null; }
  }

  function selfPid() {
    var w = W();
    var info = w && w.__ORBIT_INFO__;
    return (info && Number(info.pid)) || -1;
  }

  /* ------------------------------------------------------------------ *
   * the model.js seam
   * ------------------------------------------------------------------ */

  function isActive() { return !!(S.native && N); }

  function bindStore(store) { _store = store || null; }

  /* ------------------------------------------------------------------ *
   * the spine seam - window.OrbitCase, the store Analyse actually reads
   * ------------------------------------------------------------------ */

  var SPINE_KEY = "spine";

  function bindSpine(spine) { _spine = spine || null; }
  function spineTarget() { if (_spine) { return _spine; } var w = W(); return (w && w.OrbitCase) || null; }

  /* The newest document THIS process has committed to writing: the queued
     payload if one is still waiting, otherwise the last thing that reached
     disk. Composing against the QUEUE, not just the cache, is what stops the
     two stores clobbering each other while a write is in flight - queueWrite()
     coalesces, so a spine save landing on top of an unwritten chart save must
     carry that chart save forward, and the reverse. */
  function currentDoc() {
    var raw = (_pending !== null) ? _pending : (S.cache && S.cache.json);
    if (typeof raw !== "string" || !raw) { return null; }
    try { var o = JSON.parse(raw); return (o && typeof o === "object") ? o : null; }
    catch (e) { return null; }
  }

  /* Used only when there is genuinely nothing on disk yet and the SPINE is the
     first writer. An empty chart section, so the document still validates as a
     case and Charting can open it. */
  function emptyChartDoc() { return { app: "orbit", version: 1, entities: [], links: [], suggestions: [], events: [] }; }

  /* The spine's own read path. Returns the serialised spine section, or null.
     THE BOOT RULE IS THE SAME ONE Ben ruled for the chart - it is read from
     autoLoadOnBoot(), not re-decided here: Analyse, Database and Context get
     the shared spine on boot; CHARTING GETS NULL until openShared()/takeOver()
     opens the shared case on demand. */
  function readSpine() {
    if (!isActive()) { return null; }
    if (!_spineOpened && !autoLoadOnBoot()) { return null; }
    var doc = currentDoc();
    var sec = doc && doc[SPINE_KEY];
    if (!sec || typeof sec !== "object") { return null; }
    try { return JSON.stringify(sec); } catch (e) { return null; }
  }

  /* The spine's own write path. Same return contract as saveCase(): true means
     serialised, permitted and QUEUED; false means REFUSED and nothing written.
     Takes the serialised spine case (OrbitCase already packs it), replaces ONLY
     the spine section, and leaves the chart section exactly as it stands. */
  function saveSpine(json) {
    if (!isActive()) { return false; }
    if (S.mode !== "write") {
      refuse("Read only - the write lock is held by " + holderLabel() + ". The shared spine was not saved.");
      return false;
    }
    if (S.blocked) { refuse(S.blockedReason + " The shared spine was not saved."); return false; }
    if (!S.readSettled) {
      /* We have not seen the file yet, so we cannot compose over it without
         risking the other section. Refuse honestly; the spine keeps the case
         in memory and the next write persists it. */
      refuse("The shared case file has not been read yet. The shared spine was not saved.");
      return false;
    }
    var sec;
    try { sec = JSON.parse(String(json)); }
    catch (e) { S.writeError = "Refused to write the spine: it did not parse as JSON. The file on disk is unchanged."; emit(); return false; }
    if (!sec || typeof sec !== "object" || !sec.schema) {
      S.writeError = "Refused to write the spine: it did not validate as a spine case. The file on disk is unchanged.";
      emit(); return false;
    }
    var doc = currentDoc() || emptyChartDoc();
    doc[SPINE_KEY] = sec;
    var out;
    try { out = JSON.stringify(doc); }
    catch (e) { S.writeError = "Could not serialise the case: " + msg(e); emit(); return false; }
    if (!looksLikeCase(out)) {
      S.writeError = "Refused to write: the composed case did not validate. The file on disk is unchanged.";
      emit(); return false;
    }
    S.refusal = "";
    queueWrite(out);
    return true;
  }

  /* The file changed under us and we adopted it - tell the spine so it drops
     its parsed copy and re-reads. Gated by the SAME boot rule, so a Charting
     process that never opened the shared case is never handed one. */
  function notifySpine() {
    if (!isActive()) { return false; }
    if (!_spineOpened && !autoLoadOnBoot()) { return false; }
    var sp = spineTarget();
    if (sp && typeof sp._fileChanged === "function") {
      try { sp._fileChanged(); return true; } catch (e) { /* a bad spine cannot break persistence */ }
    }
    return false;
  }

  /* loadLocal() replacement. Synchronous by necessity - serves the snapshot
     init() prefetched. Returns TRUE only if a case was actually applied. */
  function loadCase(store) {
    var target = store || _store;
    if (!target || !S.cache || !S.cache.json) { return false; }
    try {
      target.fromJSON(JSON.parse(S.cache.json));
      S.loaded = true;
      emit();
      return true;
    } catch (e) {
      /* A corrupt case file. Do NOT half-load it and do NOT overwrite it -
         leave the bytes on disk exactly as they are for recovery, and say so. */
      S.initError = "Case file could not be read: " + msg(e);
      S.blocked = true;
      S.blockedReason = "Case file on disk is not readable as a case. It has not been changed.";
      emit();
      return false;
    }
  }

  /* Structural gate. Refuses garbage, but does NOT refuse an EMPTY case: a
     legitimate Case -> Clear produces entities: [] and the analyst is entitled
     to save that. */
  function looksLikeCase(json) {
    if (typeof json !== "string" || json.length < 2) { return false; }
    var o;
    try { o = JSON.parse(json); } catch (e) { return false; }
    if (!o || typeof o !== "object") { return false; }
    if (o.app !== "chart_room" && o.app !== "orbit") { return false; }
    if (!Object.prototype.hasOwnProperty.call(o, "entities")) { return false; }
    return Array.isArray(o.entities);
  }

  function refuse(why) {
    S.refusal = why;
    emit();
  }

  /* saveLocal() replacement.
   * RETURN CONTRACT, stated plainly because it is not the obvious one:
   * true  = serialised, permitted, and QUEUED for the atomic native write.
   * false = REFUSED. Nothing was written and nothing was silently dropped.
   * A queued write that later fails sets state().writeError and leaves
   * state().pending true - the masthead says so, and flush() surfaces it. */
  function saveCase(store) {
    var src = store || _store;
    if (!isActive()) { return false; }
    if (!src) { refuse("No case is bound to the file."); return false; }
    if (S.mode !== "write") {
      refuse("Read only - the write lock is held by " + holderLabel() + ". Nothing was saved.");
      return false;
    }
    if (S.blocked) { refuse(S.blockedReason + " Nothing was saved."); return false; }
    if (!S.readSettled) {
      /* Same rule as saveSpine(): a document composed before we have read the
         file would drop the spine section written by another app. */
      refuse("The shared case file has not been read yet. Nothing was saved.");
      return false;
    }
    var json;
    try {
      var doc = src.toJSON();
      /* THE SPINE SECTION IS CARRIED FORWARD, NEVER DROPPED. CaseStore does not
         know the spine exists, so without this line every chart autosave would
         delete everything Analyse had written. */
      var base = currentDoc();
      if (base && base[SPINE_KEY] != null && doc[SPINE_KEY] == null) { doc[SPINE_KEY] = base[SPINE_KEY]; }
      json = JSON.stringify(doc);
    }
    catch (e) { S.writeError = "Could not serialise the case: " + msg(e); emit(); return false; }
    if (!looksLikeCase(json)) {
      S.writeError = "Refused to write: the serialised case did not validate. The file on disk is unchanged.";
      emit();
      return false;
    }
    S.refusal = "";
    queueWrite(json);
    return true;
  }

  function holderLabel() {
    if (!S.heldBy) { return "another ORBIT window"; }
    var h = S.heldBy;
    return (h.app || "another ORBIT window") + (h.pid ? " (pid " + h.pid + ")" : "");
  }

  /* One writeCase in flight at a time; later saves coalesce onto the newest
     payload. Two half-written cases can therefore never interleave, and a
     600ms autosave burst costs one write, not six. */
  function queueWrite(json) {
    _pending = json;
    S.pending = true;
    emit();
    pump();
  }

  function pump() {
    if (_writing || _pending === null) { return; }
    var payload = _pending;
    _pending = null;
    _writing = true;
    call("writeCase", payload).then(function (res) {
      _writing = false;
      S.lastWriteMtime = (res && Number(res.mtimeMs)) || 0;
      S.cache = { json: payload, mtimeMs: S.lastWriteMtime };
      S.lastSavedISO = new Date().toISOString();
      S.writeError = "";
      S.loaded = true;
      S.pending = _pending !== null;
      emit();
      pump();
    }, function (err) {
      _writing = false;
      /* KEEP THE PAYLOAD. Dropping it here is exactly the silent loss this
         whole lane exists to prevent - the analyst would see a save that
         never happened. It stays queued and state().pending stays true. */
      if (_pending === null) { _pending = payload; }
      S.pending = true;
      S.writeError = msg(err);
      /* The native side rejects a write from a process that no longer holds
         the lock. If that is what happened, stop claiming we can write. */
      if (/lock/i.test(S.writeError)) { S.mode = "read"; refreshHolder(); }
      emit();
    });
  }

  /* Force the queue out and report the truth. Callers that need certainty
     (close, export, hand-off) await this rather than trusting saveCase(). */
  function flush() {
    if (!isActive()) { return Promise.resolve({ ok: true, pending: false }); }
    if (_pending !== null && !_writing) { pump(); }
    if (!_writing && _pending === null) {
      return Promise.resolve({ ok: !S.writeError, pending: false, error: S.writeError });
    }
    return new Promise(function (resolve) {
      var tries = 0;
      (function poll() {
        if (!_writing && _pending === null) { resolve({ ok: !S.writeError, pending: false, error: S.writeError }); return; }
        if (++tries > 200) { resolve({ ok: false, pending: true, error: S.writeError || "write did not complete" }); return; }
        setTimeout(poll, 50);
      })();
    });
  }

  function refreshHolder() {
    call("lockHolder").then(function (h) { S.heldBy = h || null; emit(); }, function () { /* noop */ });
  }

  /* ------------------------------------------------------------------ *
   * the file changed underneath us
   * ------------------------------------------------------------------ */

  function onDiskChanged() {
    call("readCase").then(function (r) {
      if (!r || typeof r.json !== "string") { return; }
      var mt = Number(r.mtimeMs) || 0;
      if (mt && S.lastWriteMtime && mt === S.lastWriteMtime) { return; }   /* our own write echoing back */
      if (S.mode === "write") {
        /* THIS SHOULD NOT HAPPEN. We hold the lock, so nothing else should be
           writing. Ben's ruling: SAY SO rather than overwrite. Writes are held
           until the analyst chooses reloadFromDisk() (which stashes the local
           copy first) or takeOver(). */
        S.blocked = true;
        S.blockedReason = "The case file changed on disk while this app held the write lock. Saving is held so the other change is not overwritten.";
        S.cache = { json: r.json, mtimeMs: mt };
        emit();
        return;
      }
      /* Read-only app: adopt the new case. */
      S.cache = { json: r.json, mtimeMs: mt };
      applyCache();
    }, function (e) { S.writeError = msg(e); emit(); });
  }

  function applyCache() {
    /* The spine first, and INDEPENDENTLY of the chart store: ORBIT-Analyse.html
       contains no CaseStore host at all (index.html:531), so a spine-only
       surface must still be told the file changed. */
    var spineOk = notifySpine();
    if (!_store || !S.cache || !S.cache.json) { return spineOk; }
    try {
      _store.fromJSON(JSON.parse(S.cache.json));
      S.loaded = true;
      emit();
      return true;
    } catch (e) {
      S.blocked = true;
      S.blockedReason = "Case file on disk is not readable as a case. It has not been changed.";
      emit();
      return false;
    }
  }

  /* Stash whatever is in memory before we replace it. Nothing is thrown away
     silently; a discarded local copy is recoverable from this key. */
  function stashLocal() {
    var sp = spineTarget();
    if (!_store && !sp) { return; }
    try {
      var w = W();
      if (!w || typeof w.localStorage === "undefined") { return; }
      /* BOTH sections are stashed. Stashing only the chart would have made the
         spine the one thing a reload could silently throw away. */
      w.localStorage.setItem(RECOVERY_KEY, JSON.stringify({
        ts: new Date().toISOString(), app: S.app, path: S.path,
        case: _store ? _store.toJSON() : null,
        spine: (sp && typeof sp.get === "function") ? sp.get() : null
      }));
    } catch (e) { /* quota or private mode - best effort, never fatal */ }
  }

  /* Explicit "open the shared case" - Charting's on-demand path, and the way
     out of a blocked state. */
  function openShared() {
    if (!isActive()) { return Promise.resolve(false); }
    stashLocal();
    /* "Open the shared case" opens BOTH sections. Set before the read so the
       boot-rule gate in readSpine()/notifySpine() lets Charting through. */
    _spineOpened = true;
    return prefetch().then(function () {
      var ok = applyCache();
      if (ok) { S.blocked = false; S.blockedReason = ""; emit(); }
      return ok;
    });
  }

  var reloadFromDisk = openShared;

  /* ------------------------------------------------------------------ *
   * "Take over editing"
   * ------------------------------------------------------------------ */

  /* forceLock ALONE IS NOT ENOUGH and must never be wired straight to a button.
     The other app has been writing while this one sat read-only, so this
     process is holding a stale snapshot. Taking the lock and then autosaving
     that snapshot is precisely the 12/08 clobber (Priya): the last writer
     overwrites everything the other one did. So: take the lock, THEN re-read
     the file, THEN adopt it - and only then allow writes. */
  function takeOver() {
    if (!isActive()) { return Promise.resolve({ ok: false, reason: "not running natively" }); }
    return call("forceLock").then(function (r) {
      if (!r || !r.ok) { return { ok: false, reason: "lock not transferred" }; }
      S.mode = "write";
      S.heldBy = null;
      stashLocal();
      _spineOpened = true;                 /* taking over adopts both sections */
      return prefetch().then(function () {
        applyCache();
        S.blocked = false;
        S.blockedReason = "";
        S.writeError = "";
        S.refusal = "";
        emit();
        return { ok: true, tookFrom: r.tookFrom || null };
      });
    }, function (e) {
      S.writeError = msg(e);
      emit();
      return { ok: false, reason: msg(e) };
    });
  }

  function release() {
    if (!isActive() || S.mode !== "write") { return Promise.resolve(true); }
    return call("releaseLock").then(function () {
      S.mode = "read";
      refreshHolder();
      emit();
      return true;
    }, function () { return false; });
  }

  /* Best effort on close. The native side MUST ALSO reclaim a lock whose owning
     pid is gone - a crash must not lock the case file forever. */
  (function wireUnload() {
    var w = W();
    if (!w || typeof w.addEventListener !== "function") { return; }
    w.addEventListener("pagehide", function () {
      if (!isActive()) { return; }
      if (_pending !== null || _writing) { pump(); }
      try { if (S.mode === "write") { call("releaseLock"); } } catch (e) { /* noop */ }
    });
  })();

  /* ------------------------------------------------------------------ *
   * export
   * ------------------------------------------------------------------ */

  var OrbitCaseFile = {
    init: init,
    isActive: isActive,
    state: state,
    path: path,
    isReadOnly: isReadOnly,
    holder: holder,
    buildStamp: buildStamp,
    surface: function () { return S.surface || detectSurface(); },
    onChange: onChange,
    bindStore: bindStore,
    bindSpine: bindSpine,
    autoLoadOnBoot: autoLoadOnBoot,
    loadCase: loadCase,
    saveCase: saveCase,
    readSpine: readSpine,
    saveSpine: saveSpine,
    SPINE_KEY: SPINE_KEY,
    flush: flush,
    openShared: openShared,
    reloadFromDisk: reloadFromDisk,
    takeOver: takeOver,
    release: release,
    looksLikeCase: looksLikeCase,
    RECOVERY_KEY: RECOVERY_KEY,
    /* test seam only - lets the harness rebuild a fresh adapter per instance */
    _reset: function () {
      _initPromise = null; N = null; _store = null; _spine = null; _spineOpened = false; _listeners = [];
      _pending = null; _writing = false;
      if (_unsubChange) { try { _unsubChange(); } catch (e) { /* noop */ } }
      if (_unsubLock) { try { _unsubLock(); } catch (e) { /* noop */ } }
      _unsubChange = null; _unsubLock = null;
      S = {
        native: false, ready: false, app: "", surface: "", path: "", mode: "browser",
        heldBy: null, loaded: false, readSettled: false, cache: null, lastWriteMtime: 0,
        lastSavedISO: "", pending: false, writeError: "", refusal: "",
        blocked: false, blockedReason: "", initError: ""
      };
    }
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = OrbitCaseFile; }
  if (typeof window !== "undefined") { window.OrbitCaseFile = OrbitCaseFile; }
})();
