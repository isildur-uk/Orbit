/* connections.js — provider connection state for Orbit.
 * This stores connection metadata only. OAuth tokens belong in a future
 * authenticated sync service and are deliberately never written here.
 */
(function () {
  "use strict";

  var KEY = "orbit_local_connections_v1";
  var listeners = [];
  var providers = {
    google: {
      label: "Google",
      kind: "contacts",
      description: "Import Google Contacts after you approve access.",
      setup: "Needs the Google People API enabled for Orbit's OAuth client.",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/contacts.readonly"]
    },
    facebook: {
      label: "Facebook",
      kind: "profile",
      description: "Link a Facebook profile where Meta permissions allow it.",
      setup: "Needs a Meta app, Facebook Login configuration and permission review.",
      scopes: ["public_profile"]
    },
    instagram: {
      label: "Instagram",
      kind: "profile",
      description: "Link an Instagram professional account where the API allows it.",
      setup: "Needs a Meta app and an eligible professional Instagram account.",
      scopes: ["instagram_basic"]
    },
    apple: {
      label: "Apple",
      kind: "identity",
      description: "Use Apple as an identity provider for the iOS app.",
      setup: "Will be configured with the native App Store build and Sign in with Apple.",
      scopes: []
    }
  };

  function storage() {
    try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
  }
  function read() {
    var s = storage();
    if (!s) return {};
    try {
      var value = JSON.parse(s.getItem(KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch (e) { return {}; }
  }
  function write(value) {
    var s = storage();
    if (!s) throw new Error("Local storage is unavailable on this device.");
    s.setItem(KEY, JSON.stringify(value));
  }
  function accountId() {
    var auth = window.OrbitCloudAuth && window.OrbitCloudAuth.configured ? window.OrbitCloudAuth : window.OrbitLocalAuth;
    var account = auth && auth.current ? auth.current() : null;
    return account && account.id ? account.id : "anonymous";
  }
  function blank(provider) {
    var definition = providers[provider];
    return {
      provider: provider,
      label: definition.label,
      kind: definition.kind,
      status: "not-connected",
      accountEmail: "",
      scopes: definition.scopes.slice(),
      connectedAt: "",
      lastSync: "",
      importedCount: 0,
      note: ""
    };
  }
  function current() {
    var all = read(), saved = all[accountId()] || {}, result = {};
    Object.keys(providers).forEach(function (key) { result[key] = Object.assign(blank(key), saved[key] || {}); });
    return result;
  }
  function notify() {
    var value = current();
    listeners.slice().forEach(function (listener) { try { listener(value); } catch (e) {} });
  }
  function save(provider, input) {
    if (!providers[provider]) throw new Error("Unknown connection provider.");
    var all = read(), id = accountId(), saved = all[id] || {}, next = Object.assign(blank(provider), saved[provider] || {}, input || {}, { provider: provider, label: providers[provider].label, kind: providers[provider].kind });
    saved[provider] = next;
    all[id] = saved;
    write(all);
    notify();
    return next;
  }
  function disconnect(provider) {
    return save(provider, { status: "not-connected", accountEmail: "", connectedAt: "", lastSync: "", importedCount: 0, note: "" });
  }
  function markSetup(provider, note) {
    return save(provider, { status: "needs-setup", note: note || providers[provider].setup });
  }
  function markConnected(provider, input) {
    return save(provider, Object.assign({ status: "connected", connectedAt: new Date().toISOString() }, input || {}));
  }
  function definition(provider) { return providers[provider] || null; }
  function onChange(listener) { if (typeof listener !== "function") return function () {}; listeners.push(listener); return function () { var i = listeners.indexOf(listener); if (i !== -1) listeners.splice(i, 1); }; }

  window.OrbitConnections = {
    providers: providers,
    current: current,
    definition: definition,
    save: save,
    disconnect: disconnect,
    markSetup: markSetup,
    markConnected: markConnected,
    onChange: onChange
  };
})();
