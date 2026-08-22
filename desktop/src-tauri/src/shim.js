// ORBIT native bridge - injected as a Tauri initialization script, so it exists
// before any payload script runs. Classic script, no modules, ES5-safe.
//
// PUBLIC CONTRACT (the persistence lane codes against exactly this):
//   window.__ORBIT_NATIVE__.caseFilePath()        -> Promise<string>
//   window.__ORBIT_NATIVE__.readCase()            -> Promise<{json, mtimeMs}|null>
//   window.__ORBIT_NATIVE__.writeCase(jsonString) -> Promise<{mtimeMs}>   rejects without the lock
//   window.__ORBIT_NATIVE__.acquireLock()         -> Promise<{ok:true}|{ok:false, heldBy:{app,pid,sinceISO}}>
//   window.__ORBIT_NATIVE__.releaseLock()         -> Promise<{ok:true}>
//   window.__ORBIT_NATIVE__.forceLock()           -> Promise<{ok:true, tookFrom:{app,pid,sinceISO}}>
//   window.__ORBIT_NATIVE__.lockHolder()          -> Promise<null|{app,pid,sinceISO}>
//   window.__ORBIT_NATIVE__.onCaseChanged(cb)     -> function unsubscribe
//
// ADDITIVE (not in the agreed contract, safe to ignore):
//   window.__ORBIT_NATIVE__.onLockChanged(cb)     -> function unsubscribe
//       Fires with {holder:null, reason:"yielded", to:"<app>"} when this process
//       has given the lock up to a sibling app that called forceLock(). The UI
//       must go read-only when this fires: writeCase() will reject from then on.
//   window.__ORBIT_INFO__  frozen object: surface, app, buildStamp, caseFile, ...
//
// ---------------------------------------------------------------------------
// TWO SHAPES, ONE BRIDGE - read this before "simplifying" anything below.
// ---------------------------------------------------------------------------
// The packaging brief specified a slightly different contract to the one the
// persistence lane actually shipped against. Both are real, and both are live:
//
//   brief shape                     shipped shape (src/_shared/core/case-file.js)
//   -------------------------       --------------------------------------------
//   surface  -> string property     (was absent)
//   readCase()  -> string|null      readCase()  -> {json, mtimeMs}|null
//   writeCase() -> void             writeCase() -> {mtimeMs}
//   {ok:false, holder:{...since}}   {ok:false, heldBy:{...sinceISO}}
//   buildStamp() -> string (sync)   (was absent)
//
// case-file.js at src/_shared/core/case-file.js:18-23 documents and consumes the
// SHIPPED shape. Changing readCase() to return a bare string would break it on
// contact. So: the shipped shape stays authoritative, and everything from the
// brief that does NOT conflict is added alongside it -
//   * `surface` and `buildStamp()` were simply missing. Added.
//   * holder objects now carry BOTH `sinceISO` and a `since` alias, and
//     acquireLock/forceLock results carry BOTH `heldBy`/`tookFrom` and a
//     `holder` alias. Same object, two names, no consumer has to change.
//   * the one true conflict, readCase()'s return type, is resolved by ADDING
//     `readCaseText()` -> Promise<string|null> rather than by breaking either
//     caller. writeCase() needs nothing: a Promise<{mtimeMs}> satisfies a
//     Promise<void> consumer, which ignores the value.
// Aliasing is done here in JS, not in the Rust serde structs, so the wire format
// stays one shape and there is exactly one place to look.
//
// `surface` reports "all" for the conjoined ORBIT.exe. The internal surface key
// for that build is "orbit" (see desktop/surfaces.json); "all" is the name the
// contract uses and the payload should see. window.__ORBIT_INFO__.surface still
// carries the raw key.
//
// Detecting the desktop build from the payload: check window.__ORBIT_NATIVE__.
// In the browser build it is simply absent.

(function () {
  "use strict";
  if (window.__ORBIT_NATIVE__) { return; }

  function invoke(cmd, args) {
    var w = window;
    try {
      if (w.__TAURI_INTERNALS__ && typeof w.__TAURI_INTERNALS__.invoke === "function") {
        return w.__TAURI_INTERNALS__.invoke(cmd, args || {});
      }
      if (w.__TAURI__ && w.__TAURI__.core && typeof w.__TAURI__.core.invoke === "function") {
        return w.__TAURI__.core.invoke(cmd, args || {});
      }
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.reject(new Error("ORBIT: native bridge unavailable (no Tauri IPC on this page)"));
  }

  var caseSubs = [];
  var lockSubs = [];

  var INFO = window.__ORBIT_INFO__ || {};

  /* Add the brief's field names to a holder object without removing the shipped
     ones. Mutates in place and returns it, so callers keep object identity. */
  function alias(holder) {
    if (!holder || typeof holder !== "object") { return holder; }
    if (!("since" in holder) && "sinceISO" in holder) { holder.since = holder.sinceISO; }
    if (!("sinceISO" in holder) && "since" in holder) { holder.sinceISO = holder.since; }
    return holder;
  }

  /* acquireLock/forceLock results: expose the holder under `holder` as well as
     under its shipped name, so both documented shapes read the same object. */
  function aliasResult(res, shippedKey) {
    if (!res || typeof res !== "object") { return res; }
    var h = res[shippedKey];
    if (h) {
      alias(h);
      if (!("holder" in res)) { res.holder = h; }
    }
    return res;
  }

  function subscribe(list, cb) {
    if (typeof cb !== "function") {
      throw new TypeError("ORBIT: listener must be a function");
    }
    list.push(cb);
    var live = true;
    return function unsubscribe() {
      if (!live) { return; }
      live = false;
      var i = list.indexOf(cb);
      if (i >= 0) { list.splice(i, 1); }
    };
  }

  function fan(list, detail) {
    // Copy first: a listener may unsubscribe from inside its own callback.
    var copy = list.slice(0);
    for (var j = 0; j < copy.length; j++) {
      try { copy[j](detail); } catch (e) {
        if (window.console && console.error) { console.error("ORBIT: listener threw", e); }
      }
    }
  }

  var api = {
    contractVersion: 1,

    /* Which application this is: "all" for the conjoined ORBIT.exe, otherwise
       the function name. A plain string, not a promise - the payload needs it
       during module setup, before any IPC round trip could have completed. */
    surface: (INFO.surface === "orbit" ? "all" : (INFO.surface || "all")),

    /* The build stamp compiled into this exe, taken from the payload's own
       window.ORBIT_BUILD at build time (build.rs reads it, never rewrites it).
       Synchronous by contract. Returns "" if this build was not stamped. */
    buildStamp: function () { return String(INFO.buildStamp || ""); },

    caseFilePath: function () { return invoke("case_file_path"); },

    readCase: function () { return invoke("read_case"); },

    /* Same read, flattened to the JSON text alone. For consumers that want the
       brief's Promise<string|null> shape. */
    readCaseText: function () {
      return invoke("read_case").then(function (r) {
        return (r && typeof r.json === "string") ? r.json : null;
      });
    },

    writeCase: function (jsonString) {
      if (typeof jsonString !== "string") {
        return Promise.reject(new TypeError("ORBIT: writeCase expects a JSON string"));
      }
      return invoke("write_case", { json: jsonString });
    },

    acquireLock: function () {
      return invoke("acquire_lock").then(function (r) { return aliasResult(r, "heldBy"); });
    },

    releaseLock: function () { return invoke("release_lock"); },

    forceLock: function () {
      return invoke("force_lock").then(function (r) { return aliasResult(r, "tookFrom"); });
    },

    lockHolder: function () {
      return invoke("lock_holder").then(function (h) { return alias(h); });
    },

    onCaseChanged: function (cb) { return subscribe(caseSubs, cb); },

    onLockChanged: function (cb) { return subscribe(lockSubs, cb); },

    // Called by the Rust poller via webview eval. Not part of the contract.
    _emitCaseChanged: function (detail) { fan(caseSubs, detail); },
    _emitLockChanged: function (detail) { fan(lockSubs, detail); }
  };

  /* -------------------------------------------------------------------------
     IPC SELF-TEST - do not remove, and do not make it silent.
     -------------------------------------------------------------------------
     Both ORBIT payloads carry their own <meta http-equiv="Content-Security-Policy">
     with connect-src 'none' (standalone/build-offline.mjs:333 and
     standalone/build-surface.mjs:483). A meta CSP and a header CSP COMPOSE BY
     INTERSECTION - the stricter of the two wins and neither can loosen the other.
     If the Tauri IPC transport on WebView2 turns out to use fetch() to
     http://ipc.localhost, that meta policy blocks EVERY native call, and the
     failure looks like "saving is broken", not like "CSP blocked something".
     main.rs patches the meta policy's connect-src at serve time to allow the IPC
     origin and nothing else (see PAYLOAD_CSP_PATCH there). This probe proves,
     from inside the page, whether the bridge is actually alive.

     api.ipcReady -> Promise<boolean>. Never rejects, so it is safe to ignore. */
  api.ipcReady = new Promise(function (resolve) {
    function probe() {
      api.caseFilePath().then(
        function () { resolve(true); },
        function (err) {
          if (window.console && console.error) {
            console.error(
              "ORBIT: the native bridge is present but NOT working - every case " +
              "read and write will fail. Most likely cause: the payload's own meta " +
              "Content-Security-Policy is blocking the Tauri IPC transport. " +
              "Diagnose by launching with ORBIT_CSP=off, and see section 8 of " +
              "desktop/README.md. Underlying error:", err
            );
          }
          resolve(false);
        }
      );
    }
    // Give Tauri's own initialization script time to install __TAURI_INTERNALS__.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { setTimeout(probe, 0); });
    } else {
      setTimeout(probe, 0);
    }
  });

  try {
    Object.defineProperty(window, "__ORBIT_NATIVE__", {
      value: api,
      writable: false,
      configurable: false,
      enumerable: true
    });
  } catch (e) {
    window.__ORBIT_NATIVE__ = api;
  }
})();
