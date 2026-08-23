/* auth-cloud.js — Supabase-backed Orbit identity.
 * The local auth module remains available as a fallback for offline builds,
 * but a configured Supabase client is the primary account layer.
 */
(function () {
  "use strict";

  var config = window.ORBIT_SUPABASE_CONFIG || {};
  var sdk = window.supabase;
  var client = sdk && sdk.createClient && config.url && config.publishableKey ? sdk.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } }) : null;
  var currentAccount = null;
  var currentSession = null;
  var listeners = [];

  function accountFromUser(user) {
    if (!user) return null;
    var metadata = user.user_metadata || {}, profile = metadata.orbit_profile || {};
    return { id: user.id, name: metadata.full_name || metadata.name || (user.email || "Orbit user").split("@")[0], email: user.email || "", profile: profile, createdAt: user.created_at || "", lastSignIn: user.last_sign_in_at || "" };
  }
  function notify() { listeners.slice().forEach(function (listener) { try { listener(currentAccount); } catch (e) {} }); }
  function requireClient() { if (!client) return Promise.reject(new Error("Supabase is not configured in this build.")); return Promise.resolve(client); }
  function authError(error) { return new Error(error && (error.message || error.error_description) ? (error.message || error.error_description) : "Orbit authentication failed."); }
  function callbackParams() {
    var query = new URLSearchParams(window.location.search || ""), hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
    return { query: query, hash: hash };
  }
  function callbackError() {
    var params = callbackParams(), error = params.query.get("error") || params.hash.get("error"), description = params.query.get("error_description") || params.hash.get("error_description");
    if (!error) return null;
    try { window.history.replaceState({}, document.title, window.location.pathname); } catch (e) {}
    return new Error(description ? decodeURIComponent(description.replace(/\+/g, " ")) : error);
  }
  function sessionAfterCallback(attempt) {
    return client.auth.getSession().then(function (result) {
      if (result.error) throw authError(result.error);
      var session = result.data && result.data.session;
      if (!session && attempt < 8 && new URLSearchParams(window.location.search || "").has("code")) return new Promise(function (resolve) { setTimeout(function () { resolve(sessionAfterCallback(attempt + 1)); }, 250); });
      return session;
    });
  }
  function ready() {
    if (!client) return Promise.resolve(null);
    var failure = callbackError();
    if (failure) return Promise.reject(failure);
    return sessionAfterCallback(0).then(function (session) { currentSession = session || null; currentAccount = accountFromUser(session); return currentAccount; });
  }
  function createAccount(input) {
    input = input || {};
    return requireClient().then(function (supabaseClient) {
      return supabaseClient.auth.signUp({ email: String(input.email || "").trim().toLowerCase(), password: String(input.password || ""), options: { data: { full_name: String(input.name || "").trim(), orbit_profile: {} } } });
    }).then(function (result) {
      if (result.error) throw authError(result.error);
      currentSession = result.data && result.data.session || null;
      currentAccount = accountFromUser(result.data && result.data.user);
      notify();
      if (!result.data || !result.data.session) return { pendingEmail: currentAccount && currentAccount.email };
      return currentAccount;
    });
  }
  function signIn(input) {
    input = input || {};
    return requireClient().then(function (supabaseClient) { return supabaseClient.auth.signInWithPassword({ email: String(input.email || "").trim().toLowerCase(), password: String(input.password || "") }); }).then(function (result) {
      if (result.error) throw authError(result.error);
      currentSession = result.data && result.data.session || null;
      currentAccount = accountFromUser(result.data && result.data.user);
      notify();
      return currentAccount;
    });
  }
  function redirectTo() {
    if (window.ORBIT_AUTH_REDIRECT_URI) return window.ORBIT_AUTH_REDIRECT_URI;
    return window.location.origin + window.location.pathname;
  }
  /* Orbit's button names map to Supabase provider keys. LinkedIn's key is
   * "linkedin_oidc" (Sign In with LinkedIn using OpenID Connect). */
  var PROVIDER_KEYS = { google: "google", apple: "apple", facebook: "facebook", linkedin: "linkedin_oidc", linkedin_oidc: "linkedin_oidc" };
  function openAuthPopup(url) {
    var w = 480, h = 640;
    var y = Math.max(0, Math.round((window.outerHeight - h) / 2 + (window.screenY || 0)));
    var x = Math.max(0, Math.round((window.outerWidth - w) / 2 + (window.screenX || 0)));
    return window.open(url, "orbit-oauth", "width=" + w + ",height=" + h + ",left=" + x + ",top=" + y);
  }
  function signInWithProvider(provider, input) {
    provider = String(provider || "").toLowerCase();
    input = input || {};
    var providerKey = PROVIDER_KEYS[provider];
    if (!providerKey) return Promise.reject(new Error("That sign-in provider is not enabled for Orbit."));
    /* Popup keeps the app in place: OAuth happens in a child window, and the
     * session syncs back to this tab via Supabase's cross-tab broadcast (see the
     * self-close handler below). Falls back to a full-page redirect if blocked. */
    var usePopup = !!input.popup && typeof window.open === "function";
    return requireClient().then(function (supabaseClient) {
      return supabaseClient.auth.signInWithOAuth({ provider: providerKey, options: { redirectTo: redirectTo(), scopes: input.scopes || undefined, skipBrowserRedirect: usePopup, queryParams: provider === "google" ? { access_type: "offline", prompt: "consent" } : undefined } });
    }).then(function (result) {
      if (result.error) throw authError(result.error);
      if (usePopup && result.data && result.data.url) {
        var popup = openAuthPopup(result.data.url);
        if (!popup || popup.closed) { window.location.href = result.data.url; return { redirected: true }; }
        return { popup: true };
      }
      return result.data;
    });
  }
  function beginConnection(provider) {
    try { if (window.sessionStorage) window.sessionStorage.setItem("orbit_pending_connection", String(provider || "")); } catch (e) {}
  }
  function consumeConnectionIntent() {
    var provider = "";
    try { provider = window.sessionStorage ? String(window.sessionStorage.getItem("orbit_pending_connection") || "") : ""; if (provider && window.sessionStorage) window.sessionStorage.removeItem("orbit_pending_connection"); } catch (e) {}
    return provider || null;
  }
  function providerToken() { return currentSession && currentSession.provider_token ? currentSession.provider_token : ""; }
  function updateProfile(input) {
    input = input || {};
    return requireClient().then(function (supabaseClient) {
      var profile = Object.assign({}, currentAccount && currentAccount.profile || {});
      ["phone", "phoneOther", "whatsapp", "signal", "instagram", "facebook", "website", "x", "address", "workAddress", "interests", "note"].forEach(function (key) { profile[key] = String(input[key] == null ? "" : input[key]).trim(); });
      return supabaseClient.auth.updateUser({ data: { full_name: String(input.name || (currentAccount && currentAccount.name) || "").trim(), orbit_profile: profile } });
    }).then(function (result) { if (result.error) throw authError(result.error); currentAccount = accountFromUser(result.data && result.data.user); notify(); return currentAccount; });
  }
  function signOut() { if (!client) return Promise.resolve(); return client.auth.signOut().then(function (result) { if (result.error) throw authError(result.error); currentSession = null; currentAccount = null; notify(); }); }
  function current() { return currentAccount; }
  function hasAccounts() { return false; }
  function onChange(listener) { if (typeof listener !== "function") return function () {}; listeners.push(listener); return function () { var index = listeners.indexOf(listener); if (index !== -1) listeners.splice(index, 1); }; }
  if (client) client.auth.onAuthStateChange(function (_, session) { currentSession = session || null; currentAccount = accountFromUser(session && session.user); notify(); });
  /* If this window IS the OAuth popup, close it once the session lands; the
   * opener tab receives the session through Supabase's cross-tab broadcast. */
  if (client && typeof window !== "undefined" && window.opener && window.name === "orbit-oauth") {
    var popupClosed = false, closePopup = function () { if (popupClosed) return; popupClosed = true; try { window.close(); } catch (e) {} };
    client.auth.onAuthStateChange(function (event, session) {
      if (event !== "SIGNED_IN") return;
      /* Hand the opener the provider token (needed for the Google People API) —
       * it is not reliably carried by Supabase's cross-tab session sync. */
      try { if (window.opener && !window.opener.closed) window.opener.postMessage({ source: "orbit-oauth", provider_token: (session && session.provider_token) || "" }, window.location.origin); } catch (e) {}
      setTimeout(closePopup, 250);
    });
    setTimeout(closePopup, 6000);
  }

  window.OrbitCloudAuth = { configured: !!client, ready: ready, createAccount: createAccount, signIn: signIn, signInWithProvider: signInWithProvider, beginConnection: beginConnection, consumeConnectionIntent: consumeConnectionIntent, providerToken: providerToken, updateProfile: updateProfile, signOut: signOut, current: current, hasAccounts: hasAccounts, onChange: onChange };
})();
