/* auth.js — local Orbit account shell. This is intentionally local-only: it
 * creates a device account and session, but does not claim to be cloud auth. */
(function () {
  "use strict";

  var ACCOUNTS_KEY = "orbit_local_accounts_v1";
  var SESSION_KEY = "orbit_local_session_v1";
  var listeners = [];

  function storage() {
    try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
  }
  function read(key, fallback) {
    var s = storage();
    if (!s) return fallback;
    try { var value = JSON.parse(s.getItem(key) || "null"); return value == null ? fallback : value; } catch (e) { return fallback; }
  }
  function write(key, value) {
    var s = storage();
    if (!s) throw new Error("Local storage is unavailable on this device.");
    s.setItem(key, JSON.stringify(value));
  }
  function normaliseEmail(value) { return String(value || "").trim().toLowerCase(); }
  function randomId(prefix) {
    var bytes = new Uint8Array(12);
    try { if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes); } catch (e) {}
    var raw = Array.prototype.map.call(bytes, function (n) { return n.toString(16).padStart(2, "0"); }).join("");
    return prefix + raw + Date.now().toString(36);
  }
  function randomSalt() { return randomId("salt_"); }
  function fallbackHash(value) {
    var h1 = 2166136261, h2 = 16777619;
    for (var i = 0; i < value.length; i++) {
      h1 ^= value.charCodeAt(i); h1 = Math.imul(h1, 16777619);
      h2 ^= value.charCodeAt(i) + i; h2 = Math.imul(h2, 2246822519);
    }
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }
  function hashPassword(password, salt) {
    var input = String(salt) + "\u0000" + String(password);
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)).then(function (buffer) {
        return Array.prototype.map.call(new Uint8Array(buffer), function (n) { return n.toString(16).padStart(2, "0"); }).join("");
      });
    }
    return Promise.resolve(fallbackHash(input));
  }
  function accounts() { var value = read(ACCOUNTS_KEY, []); return Array.isArray(value) ? value : []; }
  function session() { return read(SESSION_KEY, null); }
  function accountForSession() {
    var current = session();
    if (!current || !current.accountId) return null;
    return accounts().filter(function (account) { return account.id === current.accountId; })[0] || null;
  }
  function publicAccount(account) {
    if (!account) return null;
    return { id: account.id, name: account.name, email: account.email, profile: account.profile || {}, createdAt: account.createdAt, lastSignIn: account.lastSignIn };
  }
  function notify() {
    var current = publicAccount(accountForSession());
    listeners.slice().forEach(function (listener) { try { listener(current); } catch (e) {} });
  }
  function validate(name, email, password) {
    if (String(name || "").trim().length < 2) throw new Error("Enter your name.");
    if (!/^\S+@\S+\.\S+$/.test(normaliseEmail(email))) throw new Error("Enter a valid email address.");
    if (String(password || "").length < 6) throw new Error("Use at least 6 characters for this local password.");
  }
  function createAccount(input) {
    input = input || {};
    var name = String(input.name || "").trim(), email = normaliseEmail(input.email), password = String(input.password || "");
    validate(name, email, password);
    var list = accounts();
    if (list.some(function (account) { return account.email === email; })) return Promise.reject(new Error("An Orbit account already exists for this email."));
    var account = { id: randomId("acct_"), name: name, email: email, profile: {}, salt: randomSalt(), hash: "", createdAt: new Date().toISOString(), lastSignIn: new Date().toISOString() };
    return hashPassword(password, account.salt).then(function (hash) {
      account.hash = hash;
      list.push(account);
      write(ACCOUNTS_KEY, list);
      write(SESSION_KEY, { accountId: account.id, signedInAt: account.lastSignIn });
      notify();
      return publicAccount(account);
    });
  }
  function updateProfile(input) {
    input = input || {};
    var current = accountForSession();
    if (!current) return Promise.reject(new Error("Sign in to update your profile."));
    var name = String(input.name == null ? current.name : input.name).trim();
    if (name.length < 2) return Promise.reject(new Error("Enter your name."));
    var allowed = ["phone", "phoneOther", "whatsapp", "signal", "instagram", "facebook", "website", "x", "address", "workAddress", "interests", "note"];
    var profile = Object.assign({}, current.profile || {});
    allowed.forEach(function (key) { profile[key] = String(input[key] == null ? "" : input[key]).trim(); });
    current.name = name;
    current.profile = profile;
    write(ACCOUNTS_KEY, accounts().map(function (item) { return item.id === current.id ? current : item; }));
    notify();
    return Promise.resolve(publicAccount(current));
  }
  function signIn(input) {
    input = input || {};
    var email = normaliseEmail(input.email), password = String(input.password || ""), account = accounts().filter(function (item) { return item.email === email; })[0];
    if (!account) return Promise.reject(new Error("No local Orbit account was found for that email."));
    return hashPassword(password, account.salt).then(function (hash) {
      if (hash !== account.hash) throw new Error("That password does not match this local account.");
      account.lastSignIn = new Date().toISOString();
      write(ACCOUNTS_KEY, accounts().map(function (item) { return item.id === account.id ? account : item; }));
      write(SESSION_KEY, { accountId: account.id, signedInAt: account.lastSignIn });
      notify();
      return publicAccount(account);
    });
  }
  function signOut() { var s = storage(); if (s) s.removeItem(SESSION_KEY); notify(); }
  function hasAccounts() { return accounts().length > 0; }
  function current() { return publicAccount(accountForSession()); }
  function onChange(listener) { if (typeof listener !== "function") return function () {}; listeners.push(listener); return function () { var i = listeners.indexOf(listener); if (i !== -1) listeners.splice(i, 1); }; }

  window.OrbitLocalAuth = { createAccount: createAccount, signIn: signIn, updateProfile: updateProfile, signOut: signOut, current: current, hasAccounts: hasAccounts, onChange: onChange };
})();
