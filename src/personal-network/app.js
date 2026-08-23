(function () {
  "use strict";

  var D = window.OrbitNetworkDomain;
  var V = window.OrbitNetworkVault;
  var P = window.OrbitNetworkProfile;
  var A = window.OrbitCloudAuth && window.OrbitCloudAuth.configured ? window.OrbitCloudAuth : window.OrbitLocalAuth;
  var C = window.OrbitConnections;
  var T = window.OrbitTags, GR = window.OrbitGraph, QY = window.OrbitQuery, EV = window.OrbitEvidence, BR = window.OrbitBrief;
  var state = { tagFilter: {}, kindFilter: {}, expanded: {}, groupFilter: "", shape: null, coldMode: false, path: null, store: null, ready: null, network: null, snapshot: null, selectedId: "", editingId: "", query: "", opportunityMode: false, profileTab: "summary", mobileView: "network", importDraft: null, workspaceStarted: false, positions: {}, _nodeCount: -1, selectedEdge: null, linkFrom: null, pendingPlace: null, pinned: {}, undoStack: [], redoStack: [], photoLoaded: {}, photoPending: {}, emptyDismissed: false, shiftHeld: false, selectedIds: {}, layout: "orbit", ringAngle: {}, cycleAnchor: "", cycleIndex: -1 };
  var $ = function (selector) { return document.querySelector(selector); };
  var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };

  function lower(value) { return String(value == null ? "" : value).toLowerCase(); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
    });
  }
  function setText(selector, value) { var node = $(selector); if (node) node.textContent = String(value == null ? "" : value); }
  function setAuthStatus(message, error) { var node = $("#auth-status"); if (!node) return; node.textContent = String(message || ""); node.classList.toggle("error", !!error); }
  function setAuthMode(mode) {
    mode = mode === "signup" ? "signup" : "signin";
    $$('[data-auth-mode]').forEach(function (button) {
      var active = button.getAttribute("data-auth-mode") === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$('[data-auth-panel]').forEach(function (panel) { panel.hidden = panel.getAttribute("data-auth-panel") !== mode; });
    setAuthStatus("");
    var form = $(mode === "signup" ? "#auth-signup-form" : "#auth-signin-form");
    if (form) { var first = form.querySelector("input:not([type=hidden])"); if (first) setTimeout(function () { first.focus(); }, 0); }
  }
  function updateAccountUI(account) {
    if (!account) return;
    setText("#account-name", account.name);
    setText("#account-email", account.email);
    setText("#account-modal-name", account.name);
    setText("#account-modal-email", account.email);
    var form = $("#account-form"), profile = account.profile || {};
    if (form) {
      setFormValue(form, "name", account.name);
      ["phone", "phoneOther", "whatsapp", "signal", "instagram", "facebook", "website", "x", "address", "workAddress", "interests", "note"].forEach(function (key) { setFormValue(form, key, profile[key]); });
    }
  }
  /* ---- You, as an entity ----
   * Your node used to be drawn from nothing each render, so it could not be
   * opened, selected or merged into. It is a person record like any other now,
   * projected from the account profile and written back to it, so Account and
   * the chart never tell different stories. */
  var ME_PROFILE_KEYS = ["phone", "phoneOther", "whatsapp", "signal", "instagram", "facebook", "website", "x", "address", "workAddress", "interests", "note"];
  function meAttrsFromAccount(account) {
    var profile = (account && account.profile) || {}, attrs = { entityKind: "individual", isMe: true };
    var email = account && account.email ? String(account.email).trim() : "";
    if (email) attrs.email = email;
    ME_PROFILE_KEYS.forEach(function (key) {
      var value = String(profile[key] == null ? "" : profile[key]).trim();
      if (value) attrs[key] = value;
    });
    return attrs;
  }
  function ensureMeEntity() {
    if (!state.store) return;
    var account = A && A.current ? A.current() : null;
    var existing = state.store.entities ? state.store.entities().filter(function (e) { return String(e.id) === D.ME_ID; })[0] : null;
    /* upsert never rewrites an existing label, so set it here when the account
     * name has changed. */
    if (existing && account && account.name && existing.label !== account.name) existing.label = String(account.name);
    var label = (existing && existing.label) || (account && account.name) || "You";
    state.store.merge({ entities: [{ id: D.ME_ID, type: "person", label: label, identity: "me", source: "manual", createdBy: "personal-network", attrs: meAttrsFromAccount(account) }], links: [] });
  }
  /* Anything that lands on your record — an edit, a merge — goes back to the
   * account profile so it survives on another device. Best effort: an offline
   * or local account simply keeps it in the vault. */
  function syncMeToAccount() {
    if (!A || !A.updateProfile || !A.current) return;
    var account = A.current(), me = personById(D.ME_ID);
    if (!account || !me) return;
    var attrs = D.attrs(me), profile = account.profile || {}, values = { name: me.label || account.name };
    ME_PROFILE_KEYS.forEach(function (key) { values[key] = attrs[key] != null ? String(attrs[key]) : String(profile[key] == null ? "" : profile[key]); });
    Promise.resolve(A.updateProfile(values)).then(function (updated) { if (updated) updateAccountUI(updated); }).catch(function () {});
  }
  function isMe(id) { return String(id) === D.ME_ID; }
  function markBooted() {
    window.__ORBIT_BOOTED__ = true;
    var boot = $("#boot-screen");
    if (boot) boot.hidden = true;
  }
  function showAuth(mode) {
    var shell = $("#auth-shell"), app = $("#network-app");
    if (app) app.hidden = true;
    if (shell) shell.hidden = false;
    markBooted();
    setAuthMode(mode || (A && A.hasAccounts && A.hasAccounts() ? "signin" : "signup"));
  }
  function showWorkspace(account) {
    var shell = $("#auth-shell"), app = $("#network-app");
    if (shell) shell.hidden = true;
    if (app) app.hidden = false;
    markBooted();
    updateAccountUI(account || (A && A.current ? A.current() : null));
    startWorkspace();
  }
  function closeAccountModal() { var modal = $("#account-modal"); if (modal) modal.hidden = true; }
  function openAccountModal() {
    var account = A && A.current ? A.current() : null;
    if (!account) return showAuth("signin");
    updateAccountUI(account);
    $("#account-modal").hidden = false;
    $("#account-form").elements.name.focus();
  }
  /* Development convenience: open ...?dev=1 once to skip the sign-in gate and go
   * straight to the local workspace; it stays on across reloads until you open
   * ...?dev=0 or sign out. Never affects a normal (no-flag) load. */
  function devBypass() {
    try {
      var q = new URLSearchParams(window.location.search || "");
      if (q.get("dev") === "1") window.localStorage.setItem("orbit_dev_bypass", "1");
      if (q.get("dev") === "0") window.localStorage.removeItem("orbit_dev_bypass");
      return window.localStorage.getItem("orbit_dev_bypass") === "1" || window.ORBIT_DEV_BYPASS === true;
    } catch (e) { return window.ORBIT_DEV_BYPASS === true; }
  }
  function clearDevBypass() { try { window.localStorage.removeItem("orbit_dev_bypass"); } catch (e) {} }
  function signOut() { clearDevBypass(); closeAccountModal(); if (A) Promise.resolve(A.signOut()).then(function () { showAuth("signin"); }); else showAuth("signin"); }
  function friendlyAuthMessage(error) {
    var raw = error && error.message ? String(error.message) : "";
    if (/provider is not enabled|unsupported provider|not enabled/i.test(raw)) return "That sign-in is not enabled for Orbit yet. Use email and password for now.";
    if (/redirect|callback/i.test(raw)) return "Sign-in could not complete because the redirect address is not authorised. Add this page's URL to the provider's allowed redirects.";
    if (/network|failed to fetch|load failed/i.test(raw)) return "Orbit could not reach the sign-in service. Check your connection and try again.";
    return raw || "The account could not be opened. Try again, or use email and password.";
  }
  function handleAuthError(error) { setAuthStatus(friendlyAuthMessage(error), true); }
  function handleCreate(form) {
    var data = new FormData(form);
    setAuthStatus("Creating local account…");
    A.createAccount({ name: data.get("name"), email: data.get("email"), password: data.get("password") }).then(function (account) { if (account && account.pendingEmail) setAuthStatus("Check " + account.pendingEmail + " to confirm your Orbit account."); else showWorkspace(account); }).catch(handleAuthError);
  }
  function handleSignIn(form) {
    var data = new FormData(form);
    setAuthStatus("Checking this device…");
    A.signIn({ email: data.get("email"), password: data.get("password") }).then(showWorkspace).catch(handleAuthError);
  }
  var PROVIDER_LABELS = { google: "Google", apple: "Apple", facebook: "Facebook", linkedin: "LinkedIn" };
  function handleProviderSignIn(provider) {
    if (!A || !A.signInWithProvider) { setAuthStatus("Social sign-in is not configured for this build.", true); return; }
    setAuthStatus("Opening " + (PROVIDER_LABELS[provider] || provider) + " in a popup…");
    A.signInWithProvider(provider, { popup: true }).then(function (result) {
      if (result && result.popup) setAuthStatus("Finish signing in with " + (PROVIDER_LABELS[provider] || provider) + " in the popup window…");
    }).catch(handleAuthError);
  }
  function saveAccountProfile(form) {
    var data = new FormData(form), values = { name: data.get("name") };
    ["phone", "phoneOther", "whatsapp", "signal", "instagram", "facebook", "website", "x", "address", "workAddress", "interests", "note"].forEach(function (key) { values[key] = data.get(key); });
    A.updateProfile(values).then(function (account) { updateAccountUI(account); closeAccountModal(); ensureMeEntity(); render(); setText("#sync-status", "PROFILE SAVED"); }).catch(function (error) { var status = $("#account-status"); if (status) { status.textContent = error && error.message ? error.message : "The profile could not be saved."; status.classList.add("error"); } });
  }
  function connectionStatusLabel(status) {
    return ({ "not-connected": "NOT CONNECTED", "needs-setup": "SETUP NEEDED", connected: "CONNECTED", syncing: "SYNCING" })[status] || "NOT CONNECTED";
  }
  function renderConnections() {
    if (!C || !C.current) return;
    var connections = C.current();
    Object.keys(connections).forEach(function (provider) {
      var connection = connections[provider], definition = C.definition(provider), status = $("[data-connection-status=\"" + provider + "\"]"), meta = $("[data-connection-meta=\"" + provider + "\"]"), button = $("[data-connect-provider=\"" + provider + "\"]"), card = $("[data-provider-card=\"" + provider + "\"]");
      if (status) { status.textContent = connectionStatusLabel(connection.status); status.setAttribute("data-state", connection.status); }
      if (meta) {
        meta.textContent = connection.status === "connected" ? (connection.lastSync ? "Last sync " + formatDate(connection.lastSync) : "Ready to sync") : connection.status === "needs-setup" ? (connection.note || (definition && definition.setup)) : (definition ? definition.setup : "Setup required");
      }
      if (button) button.textContent = connection.status === "connected" ? "Disconnect" : connection.status === "needs-setup" ? "View setup" : (provider === "google" ? "Connect Google" : provider === "apple" ? "View setup" : "Set up " + (definition ? definition.label : provider));
      if (card) card.setAttribute("data-state", connection.status);
    });
  }
  function closeConnections() { var modal = $("#connections-modal"); if (modal) modal.hidden = true; }
  function openConnections() {
    var modal = $("#connections-modal");
    if (!modal) return;
    renderConnections();
    setText("#connections-status", "");
    modal.hidden = false;
    var close = modal.querySelector("[data-action=close-connections]"); if (close) close.focus();
  }
  function connectProvider(provider) {
    if (!C || !C.definition(provider)) return;
    var connection = C.current()[provider], definition = C.definition(provider);
    if (connection.status === "connected") {
      C.disconnect(provider);
      setText("#connections-status", definition.label + " disconnected on this device.");
      renderConnections();
      return;
    }
    if (provider === "google" && window.OrbitCloudAuth && window.OrbitCloudAuth.configured && A && A.beginConnection && A.signInWithProvider) {
      A.beginConnection("google");
      setText("#connections-status", "Opening Google consent for read-only contacts access…");
      A.signInWithProvider("google", { popup: true, scopes: "openid email profile https://www.googleapis.com/auth/contacts.readonly" }).then(function (result) {
        if (result && result.popup) setText("#connections-status", "Approve read-only contacts access in the popup window…");
      }).catch(function (error) {
        if (A.consumeConnectionIntent) A.consumeConnectionIntent();
        setText("#connections-status", error && error.message ? error.message : "Google Contacts could not be connected.");
        renderConnections();
      });
      return;
    }
    var message = definition.setup;
    if (provider === "google") message = "Google Contacts needs the Google People API enabled for the OAuth client used by Orbit.";
    if (provider === "facebook") message = "Facebook linking needs a Meta app ID, redirect address and approved permissions. Orbit will not simulate a connection or ask for your Facebook password.";
    if (provider === "instagram") message = "Instagram linking needs a Meta app and an eligible professional account. Orbit will not simulate a connection or ask for your Instagram password.";
    if (provider === "apple") message = "Sign in with Apple will be wired into the native iPhone build after the App Store identifier and Apple service configuration exist.";
    C.markSetup(provider, message);
    setText("#connections-status", message);
    renderConnections();
  }
  function finishPendingConnection(tokenOverride) {
    if (!A || !A.consumeConnectionIntent || !window.OrbitGoogleContacts) return;
    var provider = A.consumeConnectionIntent();
    if (provider !== "google") return;
    var token = tokenOverride || (A.providerToken ? A.providerToken() : "");
    if (!token) {
      C.markSetup("google", "Google did not return contacts access. Choose Connect Google and approve the read-only contacts permission.");
      setText("#sync-status", "GOOGLE CONTACTS NEEDS PERMISSION");
      renderConnections();
      return;
    }
    setText("#sync-status", "READING GOOGLE CONTACTS…");
    window.OrbitGoogleContacts.fetch(token).then(function (result) {
      C.markConnected("google", { accountEmail: A.current() && A.current().email || "", lastSync: new Date().toISOString(), importedCount: 0, note: result.count + " contacts ready for review" });
      state.importDraft = { fileName: "Google Contacts", candidates: result.candidates, skippedCount: result.skippedCount || 0, matches: importMatches(result.candidates), selected: result.candidates.map(function () { return true; }) };
      renderImportPreview();
      $("#import-modal").hidden = false;
      $("#import-select-all").focus();
      setText("#sync-status", result.count ? "GOOGLE CONTACTS READY FOR REVIEW" : "GOOGLE CONTACTS CONNECTED · NO CONTACTS FOUND");
    }).catch(function (error) {
      var message = error && error.message ? error.message : "Google Contacts could not be read.";
      C.markSetup("google", message);
      setText("#sync-status", "GOOGLE CONTACTS ERROR · " + message);
      renderConnections();
    });
  }
  function formatCount(value) { return Number(value || 0).toLocaleString("en-GB"); }
  function normaliseId(id) { return String(id || "") === D.ME_ID ? D.ME_ID : String(id || ""); }
  function displaySource(key) { return key.charAt(0).toUpperCase() + key.slice(1); }
  function formatDate(value) {
    if (!value) return "Undated";
    var d = new Date(value);
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  function sourceLine(item) {
    var bits = [];
    if (item.sourceType && item.sourceType !== "unknown") bits.push(displaySource(item.sourceType));
    if (item.sourceRef) bits.push(item.sourceRef);
    if (item.observedAt || item.occurredAt) bits.push(formatDate(item.observedAt || item.occurredAt));
    return bits.join(" · ") || "No source recorded";
  }
  function contactKindLabel(kind) {
    return ({ email: "Email", phone: "Phone", phoneOther: "Other phone", whatsapp: "WhatsApp", signal: "Signal", facebook: "Facebook", instagram: "Instagram", x: "X", tiktok: "TikTok", website: "Website", social: "Social" })[kind] || String(kind || "Contact");
  }
  /* A handle on its own is the useful thing to read; the address it lives at is
   * the useful thing to click. */
  var SOCIAL_HOME = { instagram: "https://instagram.com/", x: "https://x.com/", facebook: "https://facebook.com/", tiktok: "https://tiktok.com/@" };
  function contactHref(item) {
    var value = String(item && item.value || "").trim(), kind = String(item && item.kind || "");
    if (item && item.url && /^https?:\/\//i.test(item.url)) return item.url;
    if (/^https?:\/\//i.test(value)) return value;
    if (SOCIAL_HOME[kind] && /^@?[A-Za-z0-9._-]{1,40}$/.test(value)) return SOCIAL_HOME[kind] + value.replace(/^@/, "");
    if (kind === "email" && value) return "mailto:" + value.split(/[,; ]/)[0];
    if ((kind === "phone" || kind === "phoneOther" || kind === "whatsapp" || kind === "signal") && /^[+0-9 ()\-\.]+$/.test(value)) return "tel:" + value.replace(/[^+0-9]/g, "");
    return "";
  }
  function contactChip(item) {
    var label = contactKindLabel(item.kind), value = item.value, href = contactHref(item), content = '<strong>' + esc(label) + '</strong> ' + esc(value);
    return href ? '<a class="contact-chip" href="' + esc(href) + '"' + (/^https?:\/\//i.test(href) ? ' target="_blank" rel="noreferrer"' : '') + '>' + content + '</a>' : '<span class="contact-chip">' + content + '</span>';
  }
  /* Why the health score is the number it is, in the terms that produced it. */
  function showScoreReason(x, y) {
    var person = personById(state.selectedId); if (!person || !EV || !state.snapshot) return;
    var a = D.attrs(person);
    var degrees = D.degreeMap(state.snapshot.links);
    var last = D.lastInteractionByPerson(state.snapshot.entities, state.snapshot.links)[String(person.id)];
    var shape = shapeOf(), group = shape.byPerson[String(person.id)];
    var follow = "";
    state.snapshot.links.forEach(function (link) {
      if (!isFollowLink(link)) return;
      var ends = [normaliseId(link.from), normaliseId(link.to)];
      if (ends.indexOf(String(person.id)) === -1) return;
      follow = igFollowLabel(link);
    });
    var breakdown = EV.scoreBreakdown(D.stableScore(person, state.snapshot.links, degrees), {
      explicitStrength: a.strength, degree: degrees[String(person.id)] || 0,
      emailTotal: a.emailTotal, lastAt: last || Date.parse(a.emailLastAt || "") || 0, now: Date.now(),
      follow: follow, sharedGroups: group ? group.size - 1 : 0
    });
    closeCtxMenu(); closeIconPicker();
    setTimeout(function () {
      var pop = document.createElement("div");
      pop.className = "ctx-menu score-why";
      pop.setAttribute("role", "note");
      pop.innerHTML = breakdown.parts.map(function (part) {
        return '<div class="ctx-item"><b>' + esc(part.label) + "</b><span>" + esc(part.detail) + "</span></div>";
      }).join("");
      document.body.appendChild(pop); iconPickerEl = pop;
      var mw = pop.offsetWidth, mh = pop.offsetHeight;
      pop.style.left = Math.min(x, window.innerWidth - mw - 8) + "px";
      pop.style.top = Math.min(y, window.innerHeight - mh - 8) + "px";
    }, 0);
  }
  function nextMoment(profile) {
    var name = profile.header.preferredName || profile.header.name;
    if (profile.opportunities && profile.opportunities.length) return { title: profile.opportunities[0].title, detail: profile.opportunities[0].summary || "An opportunity is linked to this relationship." };
    if (profile.promises && profile.promises.length) return { title: "Follow up on an open promise", detail: profile.promises[0].label || profile.promises[0].value || "A commitment is waiting for attention." };
    if (!profile.relationship.interactionCount) return { title: "Create a first touchpoint", detail: "No dated interaction is recorded yet. Add context or log a conversation when one happens." };
    if (profile.relationship.phase.label === "Quiet relative to history" || profile.relationship.phase.label === "Cooling") return { title: "Reconnect with " + name, detail: "This relationship is quieter than its usual pattern. A small, relevant check-in may be timely." };
    return { title: "Keep the relationship in motion", detail: "Orbit will surface a more specific moment as context, history and opportunities accumulate." };
  }
  function profileItem(title, value, meta, source) {
    return '<div class="profile-item"><div class="profile-item-title"><span>' + esc(title) + '</span>' + (meta ? '<span class="profile-item-meta">' + esc(meta) + '</span>' : '') + '</div>' + (value ? '<div class="profile-item-meta">' + esc(value) + '</div>' : '') + '<div class="profile-item-source">' + esc(source || "") + '</div></div>';
  }
  function setProfileTab(tab) {
    state.profileTab = tab || "summary";
    $$("[data-profile-tab]").forEach(function (button) {
      var active = button.getAttribute("data-profile-tab") === state.profileTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$('[data-profile-panel]').forEach(function (panel) { panel.hidden = panel.getAttribute("data-profile-panel") !== state.profileTab; });
  }
  function syncMobileNav() {
    $$('[data-mobile-view]').forEach(function (button) {
      var target = button.getAttribute("data-mobile-view");
      var active = target === state.mobileView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
      button.disabled = target === "profile" && !state.selectedId;
    });
  }
  function setMobileView(view) {
    state.mobileView = view || "network";
    syncMobileNav();
    if (state.mobileView === "profile" && state.selectedId) openDossier(state.selectedId);
    if (state.mobileView === "network") closeDossier();
  }
  function renderProfile(profile) {
    var context = profile.currentContext || [];
    $("#dossier-contact").innerHTML = (profile.header.contactMethods || []).slice(0, 12).map(contactChip).join("") || '<span class="contact-chip">No contact methods recorded</span>';
    var a = D.attrs(profile.person), mailTotal = Number(a.emailTotal || 0);
    var facts = [
      ["Health score", Math.round(profile.relationship.score) + "/100"],
      ["Relationship", profile.relationship.phase.label],
      ["Recency", profile.relationship.health ? profile.relationship.health.recencyLabel : "Not recorded"],
      ["Frequency", profile.relationship.health ? profile.relationship.health.frequencyLabel : formatCount(profile.relationship.interactionCount)]
    ];
    /* Counted from the mailbox rather than from what is stored, so the number is
     * the real one even though only the recent messages are kept. */
    if (mailTotal) {
      facts.push(["Emails", formatCount(mailTotal) + " · " + formatCount(Number(a.emailSent || 0)) + " out, " + formatCount(Number(a.emailReceived || 0)) + " in"]);
      facts.push(["Last email", a.emailLastAt ? formatDate(a.emailLastAt) : "Not recorded"]);
    } else {
      facts.push(["Shared contacts", formatCount(profile.relationship.sharedContacts)]);
      facts.push(["Open promises", formatCount(profile.promises.length)]);
    }
    /* Someone who holds two parts of the network together should be told so. */
    var bridgeFlag = $("#dossier-bridge"), splits = shapeOf().bridgeIds[String(profile.id)];
    if (bridgeFlag) {
      bridgeFlag.hidden = !splits;
      if (splits) bridgeFlag.textContent = "Without " + (profile.header.preferredName || profile.header.name) +
        ", your network falls into " + splits + " separate pieces. They are the only route between them.";
    }
    $("#dossier-facts").innerHTML = facts.map(function (row, index) {
      var why = index === 0 ? ' data-why-score="1" class="dossier-fact clickable" title="Why this number?"' : ' class="dossier-fact"';
      return "<div" + why + '><span class="dossier-fact-label">' + esc(row[0]) + '</span><span class="dossier-fact-value">' + esc(row[1]) + "</span></div>";
    }).join("");
    var moment = nextMoment(profile);
    setText("#dossier-next-move", moment.title);
    setText("#dossier-next-move-detail", moment.detail);
    var addresses = profile.header.addresses || [], details = profile.header.details || [];
    $("#dossier-addresses").innerHTML = addresses.map(function (item) { return profileItem(item.label, item.value, "Saved profile detail", "User-entered"); }).join("");
    $("#dossier-addresses-empty").hidden = addresses.length > 0;
    $("#dossier-details").innerHTML = details.map(function (item) { return profileItem(item.label, item.value, "Saved profile detail", "User-entered"); }).join("");
    $("#dossier-details-empty").hidden = details.length > 0;
    setText("#dossier-evidence", profile.evidence.length ? formatCount(profile.evidence.length) + " record" + (profile.evidence.length === 1 ? "" : "s") + " from imports and notes." : "Everything here is what you have entered so far.");
    $("#dossier-context").innerHTML = context.map(function (item) {
      return profileItem(item.label || item.type, item.value, item.validUntil ? "Valid until " + formatDate(item.validUntil) : "Current context", sourceLine(item));
    }).join("");
    $("#dossier-context-empty").hidden = context.length > 0;
    $("#dossier-timeline").innerHTML = (profile.history || []).slice(0, 80).map(function (item) {
      /* Anything that came from somewhere you can go back to becomes a link. */
      var safeLink = /^https:\/\//i.test(String(item.link || "")) ? String(item.link) : "";
      var title = safeLink
        ? '<a class="timeline-link" href="' + esc(safeLink) + '" target="_blank" rel="noreferrer">' + esc(item.title || "Untitled record") + '</a>'
        : esc(item.title || "Untitled record");
      return '<div class="timeline-item"><div class="timeline-date">' + esc(formatDate(item.date)) + '</div><div class="timeline-title">' + title + '</div>' + (item.summary ? '<div class="timeline-summary">' + esc(item.summary) + '</div>' : '') + '<div class="timeline-kind">' + esc(item.kind) + (item.sourceType && item.sourceType !== "unknown" ? " · " + esc(item.sourceType) : "") + '</div></div>';
    }).join("");
    $("#dossier-timeline-empty").hidden = (profile.history || []).length > 0;
    /* Every value Orbit holds, with the source that put it there. This is the
     * question a network tool should always be able to answer. */
    var provenance = EV ? EV.provenance(profile.person) : [];
    var provenanceHtml = provenance.map(function (row) {
      return '<div class="evidence-row"><div class="evidence-key">' + esc(row.label) + "</div>" +
        '<div class="evidence-value">' + esc(row.value) + "</div>" +
        '<div class="evidence-where">' + esc(row.source) + (row.at ? " · " + esc(formatDate(row.at)) : "") +
        (row.count > 1 ? " · seen " + row.count + " times" : "") + "</div></div>";
    }).join("");
    $("#dossier-evidence-list").innerHTML = provenanceHtml + (profile.evidence || []).map(function (item) {
      return profileItem(item.label, "", item.kind, sourceLine(item));
    }).join("");
    $("#dossier-evidence-empty").hidden = profile.evidence.length > 0 || provenance.length > 0;
    setProfileTab(state.profileTab);
  }

  function setStats(snapshot) {
    Object.keys(snapshot.stats).forEach(function (key) { setText('[data-stat="' + key + '"]', formatCount(snapshot.stats[key])); });
    var people = formatCount(snapshot.stats.people), rels = formatCount(snapshot.stats.relationships);
    setText("#network-count", people + " people · " + rels + " relationships");
    setText("#toolbar-count", people + " " + (snapshot.stats.people === 1 ? "person" : "people") + " · " + rels + " link" + (snapshot.stats.relationships === 1 ? "" : "s"));
    var connected = snapshot.sources.filter(function (source) { return source.connected; }).length;
    setText("#sync-status", connected ? connected + " SOURCE" + (connected === 1 ? "" : "S") + " CONNECTED" : "AWAITING IMPORT");
    /* The input-source chips moved into the Connect modal; guard in case the
     * legacy sidebar list isn't present. */
    var sourceList = $("#source-list");
    if (sourceList) sourceList.innerHTML = snapshot.sources.map(function (source) {
      return '<div class="source-item' + (source.connected ? " connected" : "") + '"><i class="source-dot"></i><span>' + esc(displaySource(source.key)) + '</span></div>';
    }).join("");
  }

  var RING_RADII = { inner: 150, working: 260, outer: 370, deep: 490 };
  /* A warm→cool tier palette (closest = the Rosso Corsa accent), no blue/purple. */
  var RING_COLOURS = { inner: "#da291c", working: "#e08a2b", outer: "#c9a24b", deep: "#8a8f98" };
  var RING_LABELS = { inner: "Inner circle", working: "Working orbit", outer: "Outer orbit", deep: "Deep field" };
  var RING_META = [
    { key: "inner", label: "INNER CIRCLE" },
    { key: "working", label: "WORKING ORBIT" },
    { key: "outer", label: "OUTER ORBIT" },
    { key: "deep", label: "DEEP FIELD" }
  ];
  function ringAlpha(hex, a) {
    var h = hex.replace("#", ""); var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }
  function mePosition() { return state.layout === "orbit" ? { x: 0, y: 0 } : (state.positions[D.ME_ID] || { x: 0, y: 0 }); }
  /* Which ring band a dropped node lands in (orbit layout). Beyond the outer
   * ring by a margin means "pull it out of orbit" → no ring. */
  var UNPIN_BEYOND = 640;
  function nearestRingByRadius(r) {
    if (r > UNPIN_BEYOND) return "";
    var best = "", bestD = Infinity;
    RING_META.forEach(function (ring) { var d = Math.abs(r - RING_RADII[ring.key]); if (d < bestD) { bestD = d; best = ring.key; } });
    return best;
  }
  /* Handle where node(s) were dropped: always remember the position, and in the
   * orbit layout re-pin to the ring band under the drop (or unpin when dragged
   * out past the outer ring). Called by dragEnd and by the QA drag hook. */
  function applyNodeDrop(nodeIds) {
    if (!state.network) return;
    var positions = state.network.getPositions(nodeIds);
    var me = mePosition(), ringMerges = [], changed = false, lastKey = "", dropped = 0;
    Object.keys(positions).forEach(function (id) {
      state.positions[id] = positions[id];
      if (id === D.ME_ID || state.layout !== "orbit") return;
      dropped++;
      var person = personById(id); if (!person) return;
      var dx = positions[id].x - me.x, dy = positions[id].y - me.y, r = Math.sqrt(dx * dx + dy * dy);
      var had = String(D.attrs(person).ring || "");
      var key = nearestRingByRadius(r);
      if (key) state.ringAngle[String(id)] = Math.atan2(dy, dx); else delete state.ringAngle[String(id)];
      if (key === had) return;
      changed = true; lastKey = key;
      if (key) ringMerges.push({ id: id, type: "person", label: person.label, attrs: { ring: key } });
      else if (person.attrs) delete person.attrs.ring;   /* the store ignores blank attrs, so remove it as clearRing does */
    });
    if (!changed) { if (state.layout === "orbit") render(); return; }
    pushUndo();
    /* A merge (even an empty one) persists the whole case, capturing both the
     * ring re-pins above and any in-place ring deletions. */
    state.store.merge({ entities: ringMerges, links: [] });
    setText("#sync-status", dropped === 1 ? (lastKey ? "PINNED TO " + String(RING_LABELS[lastKey] || "").toUpperCase() : "PULLED OUT OF ORBIT") : "RINGS UPDATED");
    render();
  }
  function stableAngle(id) { var h = 0, s = String(id); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return (h % 360) * Math.PI / 180; }
  function nodePosition(summary, index, total) {
    var angle = ((index / Math.max(total, 1)) * Math.PI * 2) - Math.PI / 2;
    var radius = RING_RADII[summary.ring] || 370;
    var me = mePosition();
    return { x: me.x + Math.cos(angle) * radius, y: me.y + Math.sin(angle) * radius, angle: angle };
  }
  /* Draw the orbit rings INSIDE the vis canvas so they zoom and pan with the
   * graph, centred on ME's live position. Replaces the static DOM backdrop. */
  /* Layout options — Orbit's own rings + free-move, plus the SOLAR-parity
   * arrangements computed in layouts.js. Order sets the picker/menu order. */
  var LAYOUTS = [
    { key: "orbit", label: "Orbit rings", tip: "Your rings, ME at the centre" },
    { key: "peacock", label: "Peacock", tip: "Radial hubs — who is at the centre of activity" },
    { key: "peacock-compact", label: "Compact", tip: "The same hubs, pulled closer together" },
    { key: "force", label: "Force", tip: "Let the shape settle by physics" },
    { key: "hierarchy", label: "Tree", tip: "Top-down tidy tree" },
    { key: "grouped", label: "Grouped", tip: "Cluster by kind — people and organisations" },
    { key: "tags", label: "By tag", tip: "Cluster people into the tags you gave them" },
    { key: "circle", label: "Circle", tip: "Everyone evenly on one ring" },
    { key: "grid", label: "Grid", tip: "Every node on a lattice" },
    { key: "free", label: "Free", tip: "Move anyone anywhere; positions stick" }
  ];
  var LAYOUT_KEYS = LAYOUTS.map(function (l) { return l.key; });
  function layoutMeta(key) { for (var i = 0; i < LAYOUTS.length; i++) if (LAYOUTS[i].key === key) return LAYOUTS[i]; return LAYOUTS[0]; }
  function loadLayout() { try { var v = window.localStorage.getItem("orbit_layout"); return LAYOUT_KEYS.indexOf(v) !== -1 ? v : "orbit"; } catch (e) { return "orbit"; } }
  function setLayout(key) {
    if (LAYOUT_KEYS.indexOf(key) === -1) key = "orbit";
    state.layout = key;
    if (key === "force") state._forceSettled = false;
    try { window.localStorage.setItem("orbit_layout", key); } catch (e) {}
    setText("#sync-status", layoutMeta(key).label.toUpperCase() + " LAYOUT");
    setText("#layout-tool-label", layoutMeta(key).label);
    render();
    recenterView();
  }
  function recenterView() {
    if (!state.network) return;
    if (state.layout === "orbit") {
      var el = $("#network"), w = (el && el.clientWidth) || 800, h = (el && el.clientHeight) || 600;
      var scale = Math.max(0.35, Math.min(1.1, Math.min(w, h) / (2 * 540)));
      try { state.network.moveTo({ position: { x: 0, y: 0 }, scale: scale, animation: true }); } catch (e) { try { state.network.fit({ animation: true }); } catch (e2) {} }
    } else { try { state.network.fit({ animation: true }); } catch (e) {} }
  }
  /* Tag flair: a row of small colour dots under each tagged person, drawn on
   * the canvas because vis has no second label line. Capped at five so a heavily
   * tagged person never grows a stripe wider than their name. */
  function drawTagFlair(ctx) {
    var flair = state.flair;
    if (!ctx || !flair || !flair.length || !state.network) return;
    var RADIUS = 3.1, GAP = 8.4;
    ctx.save();
    for (var i = 0; i < flair.length; i++) {
      var row = flair[i], box;
      try { box = state.network.getBoundingBox(row.id); } catch (e) { continue; }
      if (!box) continue;
      ctx.globalAlpha = row.alpha;
      var cx = (box.left + box.right) / 2, y = box.bottom + 17;
      var startX = cx - ((row.colours.length - 1) * GAP) / 2;
      for (var c = 0; c < row.colours.length; c++) {
        ctx.beginPath();
        ctx.arc(startX + c * GAP, y, RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = row.colours[c];
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(10,10,10,.85)";
        ctx.stroke();
      }
      if (row.extra) {
        ctx.fillStyle = "rgba(220,220,220,.8)";
        ctx.font = "600 8px 'Inter Var', Arial, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("+" + row.extra, startX + row.colours.length * GAP - 2, y + 3);
      }
    }
    ctx.restore();
  }
  function drawRings(ctx) {
    if (!ctx || state.layout !== "orbit") return;
    var me = mePosition();
    ctx.save();
    ctx.font = "600 10px 'Inter Var', Arial, sans-serif";
    ctx.textAlign = "center";
    RING_META.forEach(function (ring) {
      var r = RING_RADII[ring.key], col = RING_COLOURS[ring.key];
      ctx.beginPath(); ctx.arc(me.x, me.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = ringAlpha(col, ring.key === "inner" ? 0.5 : 0.32); ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = ringAlpha(col, 0.7);
      ctx.fillText(ring.label, me.x, me.y - r - 7);
    });
    ctx.restore();
  }
  /* The record a query is asked about. */
  function queryRecord(person) {
    var a = D.attrs(person), shape = state.query.trim() ? shapeOf() : null;
    var group = shape ? shape.byPerson[String(person.id)] : null;
    var has = [];
    [["email", a.email], ["phone", a.phone || a.phoneOther], ["whatsapp", a.whatsapp], ["signal", a.signal],
     ["instagram", a.instagram], ["facebook", a.facebook], ["website", a.website], ["photo", a.photo],
     ["address", a.address || a.workAddress], ["note", a.note], ["birthday", a.birthday], ["tag", (T ? T.parse(a.tags).length : 0) ? "y" : ""]]
      .forEach(function (pair) { if (String(pair[1] || "").trim()) has.push(pair[0]); });
    return {
      name: person.label, tags: T ? T.parse(a.tags) : [], organisation: a.organisation || "",
      emails: String(a.email || "").split(/[,;\s]+/).filter(Boolean),
      kind: a.entityKind || "individual", has: has, groups: group ? [group.name] : [],
      lastAt: Date.parse(a.emailLastAt || "") || 0, emailTotal: Number(a.emailTotal || 0),
      haystack: [person.label, a.preferredName, a.role, a.organisation, a.location, a.email, a.phone, a.phoneOther,
        a.whatsapp, a.instagram, a.facebook, a.website, a.address, a.workAddress, a.interests, a.note,
        (T ? T.parse(a.tags).join(" ") : "")].join(" ").toLowerCase()
    };
  }
  function currentNodeIds(snapshot) {
    /* Your own record is always on the chart; it is not one of the results. */
    var people = snapshot.entities.filter(function (e) { return D.isPerson(e) && !isMe(e.id); });
    var q = state.query.trim();
    var terms = q && QY ? QY.parse(q) : null;
    return people.filter(function (person) {
      var matchesQuery = !terms || !terms.length || QY.matches(queryRecord(person), terms);
      var matchesOpportunity = !state.opportunityMode || snapshot.links.some(function (link) {
        return D.hasOpportunity(link) && (String(link.from) === String(person.id) || String(link.to) === String(person.id));
      }) || D.isOpportunityEntity(person);
      return matchesQuery && matchesOpportunity;
    }).map(function (person) { return String(person.id); });
  }
  /* Only hand a photo to vis once the image has actually loaded — otherwise vis
   * tries to draw a 0-size image and throws. Until then the node is a plain dot;
   * the image load triggers one re-render that swaps it in. */
  var chipCache = Object.create(null);
  function cachedChip(key, options) {
    var id = key + "|" + options.bg + "|" + options.ring + "|" + options.glyph;
    if (chipCache[id] === undefined) chipCache[id] = window.OrbitIcons.chip(key, options);
    return chipCache[id];
  }
  function photoReady(url) {
    if (!url) return false;
    if (state.photoLoaded[url]) return true;
    if (state.photoPending[url]) return false;
    state.photoPending[url] = true;
    var img = new Image();
    img.onload = function () { delete state.photoPending[url]; if ((img.naturalWidth || 0) > 0) { state.photoLoaded[url] = true; if (state.snapshot) renderGraph(state.snapshot); } };
    img.onerror = function () { delete state.photoPending[url]; };
    img.src = url;
    return false;
  }
  /* Push a freshly built list into a live DataSet: update what is there, add
   * what is new, drop what has gone. */
  /* Handing vis all 283 nodes when one of them changed costs more than drawing
   * the frame. Each built item is fingerprinted, and only the ones that actually
   * differ from last time are sent through. */
  function applyToDataSet(dataSet, items, cache) {
    if (!dataSet) return cache;
    var next = Object.create(null), changed = [], i;
    for (i = 0; i < items.length; i++) {
      var id = items[i].id, print = JSON.stringify(items[i]);
      next[id] = print;
      if (cache[id] !== print) changed.push(items[i]);
    }
    var stale = [], ids = dataSet.getIds();
    for (i = 0; i < ids.length; i++) if (next[ids[i]] === undefined) stale.push(ids[i]);
    if (stale.length) dataSet.remove(stale);
    if (changed.length) dataSet.update(changed);
    return next;
  }
  /* Above this many people on screen the chart switches to its plain drawing. */
  var DENSE_AT = 150;
  /* "Person in your network" told you nothing you could not already see. The
   * tooltip now answers the question you hover to ask: who is this, how are we
   * connected, and how much is here. */
  function nodeTooltip(person, summary, degrees, followState, tags) {
    var a = D.attrs(person), id = String(person.id), lines = [];
    var vanity = String(a.preferredName || "").trim();
    if (vanity && vanity.toLowerCase() !== String(person.label || "").toLowerCase()) lines.push(vanity);
    var role = [a.role, a.organisation].filter(Boolean).join(" · ");
    if (role) lines.push(role);
    var kind = String(a.entityKind || "individual");
    var how = followState[id] || (kind === "social" ? "Social handle" : (kind === "email" || kind === "unknown" ? "Email address only" : (kind === "organisation" || kind === "generic-inbox" ? "Organisation" : "")));
    var ring = String(a.ring || summary.ring);
    var count = degrees[id] || 0;
    lines.push([how, RING_LABELS[ring] ? RING_LABELS[ring] : "", count + (count === 1 ? " connection" : " connections")].filter(Boolean).join(" · "));
    if (tags.length) lines.push(tags.slice(0, 4).join(", "));
    return lines.map(esc).join("\n");
  }
  function renderGraph(snapshot) {
    if (!window.vis || !window.vis.DataSet || !window.vis.Network) {
      setText("#sync-status", "GRAPH LIBRARY UNAVAILABLE");
      return;
    }
    var visibleIds = currentNodeIds(snapshot);
    var dense = visibleIds.length > DENSE_AT;
    var visibleSet = Object.create(null);
    visibleIds.forEach(function (id) { visibleSet[id] = true; });
    visibleSet[D.ME_ID] = true;
    /* Your record is drawn as the centre node below, never as one more person
     * in the ring — two nodes with the same id would collide. */
    var people = snapshot.entities.filter(function (entity) { return visibleSet[String(entity.id)] && D.isPerson(entity) && !isMe(entity.id); });
    /* When something is selected, everything else steps back. With a hundred
     * people on screen a slightly thicker border is not enough to find one. */
    var hasSelection = !!state.selectedId || Object.keys(state.selectedIds).length > 0;
    var filtering = activeTags().length > 0 || activeKinds().length > 0 || !!state.groupFilter;
    var cold = coldSet(), coldActive = state.coldMode;
    var pathSet = state.path ? state.path.set : null;
    var narrowed = state.query.trim() || hasSelection || filtering || coldActive || !!pathSet;
    function dimmed(isSelected) { return narrowed && !isSelected ? 0.28 : 1; }
    /* A tag filter, a chain, or the going-cold sweep each put their people in
     * the foreground the same way a selection does — the rest of the network
     * stays visible, just out of the way. */
    function inFocus(person, isSelected) {
      if (isSelected) return true;
      var id = String(person.id);
      if (pathSet) return !!pathSet[id];
      if (coldActive && cold[id]) return true;
      return filtering && personMatchesFilter(person);
    }
    /* SOLAR-parity computed layouts (peacock, tree, grid, force, …) produce a
     * full positions map for ME + every visible person; orbit/free are handled
     * by the ring/saved-position logic below. */
    /* "By tag" is the grouped arrangement fed a different grouping key. */
    var byTag = state.layout === "tags";
    var computedKind = byTag ? "grouped" : (window.OrbitLayouts && window.OrbitLayouts.has(state.layout) ? state.layout : null);
    var layoutPos = null, layoutPhysics = false;
    if (computedKind) {
      var lnodes = [{ id: D.ME_ID, label: "ME", group: "me" }].concat(people.map(function (p) {
        var group = byTag ? (tagsOf(p)[0] || "Untagged") : String(D.attrs(p).entityKind || "individual");
        return { id: String(p.id), label: String(p.label || ""), group: group };
      }));
      var llinks = snapshot.links.filter(function (l) { var ff = normaliseId(l.from), tt = normaliseId(l.to); return visibleSet[ff] && visibleSet[tt]; }).map(function (l) { return { from: normaliseId(l.from), to: normaliseId(l.to) }; });
      var lr = window.OrbitLayouts.compute(computedKind, lnodes, llinks);
      if (lr) { layoutPos = lr.positions; layoutPhysics = !!lr.physics; }
    }
    var mePos = (layoutPos && layoutPos[D.ME_ID]) ? layoutPos[D.ME_ID] : mePosition();
    var meFixed = computedKind ? !layoutPhysics : (state.layout === "orbit" || !!state.pinned[D.ME_ID]);
    var meEntity = snapshot.entities.filter(function (entity) { return isMe(entity.id); })[0] || null;
    var meSelected = isMe(state.selectedId) || !!state.selectedIds[D.ME_ID] || !!(state.path && state.path.set[D.ME_ID]);
    var mePhoto = meEntity && photoReady(D.attrs(meEntity).photo) ? D.attrs(meEntity).photo : "";
    var meNode = { id: D.ME_ID, label: meEntity && meEntity.label ? String(meEntity.label) : "ME", x: mePos.x, y: mePos.y, fixed: meFixed, shape: "dot", size: meSelected ? 30 : 24, borderWidth: meSelected ? 5 : 2, opacity: Math.max(dimmed(meSelected), 0.62), color: { background: "#da291c", border: "#ffffff", highlight: { background: "#ec3325", border: "#ffffff" } }, font: { color: "#ffffff", size: meSelected ? 15 : 13, face: "Inter Var", bold: true, strokeWidth: 5, strokeColor: "#141414" }, shadow: { enabled: true, color: meSelected ? "rgba(255,255,255,.8)" : "rgba(218,41,28,.55)", size: meSelected ? 34 : 26, x: 0, y: 0 } };
    if (mePhoto) { meNode.shape = "circularImage"; meNode.image = mePhoto; meNode.size = meSelected ? 30 : 24; }
    var nodes = [meNode];
    var byId = Object.create(null);
    /* Degrees and opportunity membership in one pass each, rather than a scan of
     * every link for every person. */
    var degrees = D.degreeMap(snapshot.links), flair = [], nodePositions = Object.create(null);
    var followState = Object.create(null);
    snapshot.links.forEach(function (link) {
      if (!isFollowLink(link)) return;
      var la = D.attrs(link), other = normaliseId(link.from) === String(la.igOwner) ? normaliseId(link.to) : normaliseId(link.from);
      followState[other] = la.igFollowsOwner && la.igOwnerFollows ? "Mutual follow" : (la.igFollowsOwner ? "Follows you" : "You follow them");
    });
    var opportunityIds = Object.create(null);
    snapshot.links.forEach(function (link) {
      if (!D.hasOpportunity(link)) return;
      opportunityIds[String(link.from)] = true;
      opportunityIds[String(link.to)] = true;
    });
    people.forEach(function (person, index) {
      var summary = D.personSummary(person, snapshot.links, degrees);
      var ringKey = D.attrs(person).ring;
      var ringPinned = !!(ringKey && RING_RADII[ringKey]);
      var position, nodeFixed;
      if (computedKind) {
        position = (layoutPos && layoutPos[String(person.id)]) || state.positions[String(person.id)] || nodePosition(summary, index, people.length);
        nodeFixed = !layoutPhysics;
      } else if (ringPinned) {
        /* Keep the angle the person was dragged to (so they slide along the ring
         * they were dropped near) and fall back to a stable angle otherwise.
         * fixed:false so a pinned person can still be picked up and moved. */
        var ang = state.ringAngle[String(person.id)] != null ? state.ringAngle[String(person.id)] : stableAngle(person.id);
        position = { x: mePos.x + Math.cos(ang) * RING_RADII[ringKey], y: mePos.y + Math.sin(ang) * RING_RADII[ringKey] };
        nodeFixed = false;
      } else {
        position = state.positions[String(person.id)] || nodePosition(summary, index, people.length);
        nodeFixed = false;
      }
      var selected = state.selectedId === String(person.id) || !!state.selectedIds[String(person.id)];
      var focused = inFocus(person, selected);
      var opportunity = D.isOpportunityEntity(person) || !!opportunityIds[String(person.id)];
      var tipTags = T ? tagsOf(person) : [];
      var kind = String(D.attrs(person).entityKind || "individual");
      var organisation = kind === "organisation" || kind === "generic-inbox";
      var emailOnly = kind === "unknown" || kind === "email";
      var socialOnly = kind === "social";
      byId[String(person.id)] = true;
      nodePositions[String(person.id)] = position;
      if (T) {
        var personTags = tagsOf(person);
        if (personTags.length) {
          var shown = personTags.slice(0, 5), colours = [];
          for (var ti = 0; ti < shown.length; ti++) colours.push(T.colour(shown[ti]));
          flair.push({ id: String(person.id), colours: colours, extra: personTags.length - shown.length, alpha: dimmed(focused) });
        }
      }
      var inner = summary.score >= 55;
      var ringCol = ringPinned ? RING_COLOURS[ringKey] : null;
      var baseBg = opportunity ? "#da291c" : (organisation ? "#241f16" : (emailOnly ? "#1e2226" : (socialOnly ? "#221e26" : (inner ? "#3a3330" : "#2b2b2b"))));
      var overdue = coldActive && !!cold[String(person.id)];
      var baseBorder = selected ? "#ffffff" : (overdue ? "#e08a3c" : (ringCol || (opportunity ? "#ff6a5e" : (organisation ? "#c9a24b" : (emailOnly ? "#6f8592" : (socialOnly ? "#8f7fa6" : (inner ? "#c98b84" : "#8a8a8a")))))));
      var photo = photoReady(D.attrs(person).photo) ? D.attrs(person).photo : "";
      var node = { id: String(person.id), label: String(person.label || "Unnamed person"), x: position.x, y: position.y, fixed: nodeFixed, size: selected ? 24 : (opportunity ? 14 : 9 + Math.round(summary.score / 20)), borderWidth: selected ? 4 : 1.4, color: { background: baseBg, border: baseBorder, highlight: { background: "#da291c", border: "#ffffff" }, hover: { background: baseBg, border: "#ffffff" } }, opacity: dimmed(focused), font: { color: selected ? "#ffffff" : "#e4e4e4", size: selected ? 16 : 12, face: "Inter Var", bold: selected, vadjust: -2, strokeWidth: selected ? 6 : 4, strokeColor: "#181818" }, shadow: selected ? { enabled: true, color: "rgba(255,255,255,.8)", size: 30, x: 0, y: 0 } : { enabled: true, color: "rgba(0,0,0,.5)", size: 7, x: 0, y: 2 }, title: nodeTooltip(person, summary, degrees, followState, tipTags) };
      if (dense) { node.shape = organisation ? "square" : "dot"; node.shadow = { enabled: false }; node.font.strokeWidth = selected ? 4 : 0; }
      else if (photo) { node.shape = "circularImage"; node.image = photo; node.size = selected ? 28 : 18; node.borderWidth = selected ? 4 : 2; if (ringCol && !selected) node.color.border = ringCol; }
      else if (window.OrbitIcons) {
        var Icons = window.OrbitIcons;
        var iconKey = String(D.attrs(person).icon || Icons.defaultKey(kind));
        var chipRing = overdue ? "#e08a3c" : (ringCol || (opportunity ? "#ff6a5e" : (organisation ? "#c9a24b" : (emailOnly ? "#6f8592" : (socialOnly ? "#8f7fa6" : (inner ? "#c98b84" : "#8a8a8a"))))));
        var chipUrl = cachedChip(iconKey, { bg: organisation ? "#241f16" : (emailOnly ? "#1e2226" : (socialOnly ? "#221e26" : "#242424")), ring: chipRing, glyph: organisation ? "#e6c877" : (emailOnly ? "#b6c6cf" : (socialOnly ? "#cbbcdd" : "#e8e8e8")) });
        if (photoReady(chipUrl)) {
          node.shape = "circularImage"; node.image = chipUrl; node.size = selected ? 27 : 16;
          node.color = { border: selected ? "#ffffff" : chipRing, background: "transparent", highlight: { border: "#ffffff" }, hover: { border: "#ffffff" } };
          node.borderWidth = selected ? 4 : 0;
        } else { node.shape = organisation ? "square" : "dot"; }
      } else { node.shape = organisation ? "square" : "dot"; }
      nodes.push(node);
    });
    var edges = snapshot.links.filter(function (link) {
      var from = normaliseId(link.from), to = normaliseId(link.to);
      return (from === D.ME_ID || byId[from]) && (to === D.ME_ID || byId[to]);
    }).map(function (link) {
      var opportunity = D.hasOpportunity(link);
      var from = normaliseId(link.from), to = normaliseId(link.to);
      var touchesMe = from === D.ME_ID || to === D.ME_ID;
      var colour = opportunity ? "rgba(218,41,28,.9)" : (touchesMe ? "rgba(255,255,255,.36)" : "rgba(255,255,255,.2)");
      var follows = isFollowLink(link), followLabel = follows ? igFollowLabel(link) : "";
      var mutual = followLabel === "Mutual follow";
      var relType = String(D.attrs(link).relationshipType || "") || followLabel;
      var onPath = pathSet && pathSet[from] && pathSet[to] && Math.abs(state.path.ids.indexOf(from) - state.path.ids.indexOf(to)) === 1;
      var onSelection = pathSet ? !!onPath : (!hasSelection || from === String(state.selectedId) || to === String(state.selectedId) || !!state.selectedIds[from] || !!state.selectedIds[to]);
      /* One arrowhead when the follow runs one way, two when it is mutual. */
      var arrows = follows ? (mutual
        ? { to: { enabled: true, scaleFactor: 0.45 }, from: { enabled: true, scaleFactor: 0.45 } }
        : { to: { enabled: true, scaleFactor: 0.55 } }) : undefined;
      var showLabel = !dense || onPath || (hasSelection && onSelection);
      /* A hand-set arrow overrides the follow arrows: it is the more deliberate
       * statement of the two. */
      var pointsTo = String(D.attrs(link).pointsTo || "");
      if (pointsTo === to) arrows = { to: { enabled: true, scaleFactor: 0.6 } };
      else if (pointsTo === from) arrows = { from: { enabled: true, scaleFactor: 0.6 } };
      return { id: String(link.id), from: from, to: to, label: showLabel ? (relType || undefined) : undefined, arrows: arrows, width: onPath ? 3 : (onSelection && hasSelection ? 2.2 : (opportunity ? 2.6 : (touchesMe ? 1.3 : 1.1))), dashes: false, color: { color: onPath ? "rgba(255,255,255,.92)" : colour, highlight: opportunity ? "#da291c" : "#ffffff", hover: "#ffffff", opacity: onSelection ? 1 : 0.18 }, font: relType ? { color: "#cfcfcf", size: 10, face: "Inter Var", strokeWidth: 4, strokeColor: "#181818", align: "middle" } : undefined, smooth: dense ? false : { enabled: true, type: "continuous", roundness: .28 }, hidden: false };
    });
    /* Who else holds each identifier, so an expansion can show the overlap. */
    var sharedHolders = Object.create(null);
    if (Object.keys(state.expanded).length) {
      shapeOf().shared.forEach(function (row) { sharedHolders[lower(row.value)] = row.holders; });
    }
    /* Each expanded person fans their parts out around them. */
    Object.keys(state.expanded).forEach(function (personId) {
      if (!byId[personId] && personId !== D.ME_ID) { delete state.expanded[personId]; return; }
      var person = personById(personId); if (!person) return;
      var parts = detailsOf(person);
      if (!parts.length) return;
      var home = personId === D.ME_ID ? mePos : (nodePositions[personId] || mePos);
      var spread = 105 + 11 * parts.length;
      parts.forEach(function (part, index) {
        var angle = ((index + 0.5) / parts.length) * Math.PI * 2 - Math.PI / 2;
        var nodeId = detailId(personId, index);
        nodes.push({
          id: nodeId, label: part.value.length > 26 ? part.value.slice(0, 25) + "…" : part.value,
          x: Math.round(home.x + Math.cos(angle) * spread), y: Math.round(home.y + Math.sin(angle) * spread),
          fixed: true, shape: "box", widthConstraint: { maximum: 150 },
          margin: { top: 4, right: 7, bottom: 4, left: 7 },
          borderWidth: 1, opacity: 1,
          color: { background: "#191919", border: DETAIL_COLOUR[part.kind] || "#8a8a8a", highlight: { background: "#222", border: "#ffffff" }, hover: { background: "#222", border: "#ffffff" } },
          font: { color: "#d8d8d8", size: 10, face: "Inter Var", multi: false },
          shadow: { enabled: false },
          title: esc(part.label + ": " + part.value + (part.href ? "\nClick to open" : ""))
        });
        edges.push({
          id: nodeId + DETAIL_MARK + "edge", from: personId, to: nodeId, label: undefined,
          width: 1, dashes: [2, 3], arrows: undefined, smooth: false,
          color: { color: "rgba(255,255,255,.22)", highlight: "#ffffff", hover: "#ffffff", opacity: 1 }
        });
        /* An identifier somebody else also holds is the interesting kind: draw
         * the line to them too, and mark the node so it reads differently. */
        (sharedHolders[lower(part.value)] || []).forEach(function (otherId) {
          if (otherId === personId || !byId[otherId]) return;
          var node = nodes[nodes.length - 1];
          node.color.border = "#da291c";
          node.borderWidth = 2;
          edges.push({
            id: nodeId + DETAIL_MARK + "shared" + DETAIL_MARK + otherId, from: nodeId, to: otherId,
            label: undefined, width: 1.4, dashes: false, arrows: undefined, smooth: false,
            color: { color: "rgba(218,41,28,.55)", highlight: "#da291c", hover: "#da291c", opacity: 1 }
          });
        });
      });
    });
    var firstBuild = !state.network;
    if (firstBuild) {
      state.nodesDS = new window.vis.DataSet(nodes);
      state.edgesDS = new window.vis.DataSet(edges);
      state.nodePrints = Object.create(null);
      state.edgePrints = Object.create(null);
      nodes.forEach(function (n) { state.nodePrints[n.id] = JSON.stringify(n); });
      edges.forEach(function (e) { state.edgePrints[e.id] = JSON.stringify(e); });
      var data = { nodes: state.nodesDS, edges: state.edgesDS };
      state.network = new window.vis.Network($("#network"), data, { physics: false, autoResize: true, interaction: { hover: true, navigationButtons: false, keyboard: false, zoomView: true, dragView: true, dragNodes: true }, nodes: { borderWidth: 1, chosen: true }, edges: { selectionWidth: 2 }, configure: false });
      state.network.on("click", function (event) {
        var id = event.nodes && event.nodes[0];
        var shift = state.shiftHeld || (event.event && event.event.srcEvent && event.event.srcEvent.shiftKey);
        /* Complete a pending link (started by right-click "Link from here" or a
         * shift-click) — click any other person to connect. */
        if (state.linkFrom) {
          if (id && String(id) !== String(state.linkFrom)) {
            var newLinkId = addRelationship(state.linkFrom, id);
            endLinkFrom();
            if (newLinkId) { var se = event.event && event.event.srcEvent; showRelTypePicker(newLinkId, (se ? se.clientX : window.innerWidth / 2) + 6, (se ? se.clientY : window.innerHeight / 2) + 6); }
            return;
          }
          endLinkFrom();
          return;
        }
        /* A part of a person is a shortcut, not a node to select: clicking it
         * opens the address, the number or the profile it stands for. */
        if (id && isDetailNode(id)) {
          var owner = personById(detailOwner(id));
          var parts = owner ? detailsOf(owner) : [];
          var part = parts[Number(String(id).split(DETAIL_MARK)[2])];
          if (part && part.href) { try { window.open(part.href, /^https?:/i.test(part.href) ? "_blank" : "_self", "noreferrer"); } catch (e) {} }
          else if (part) setText("#sync-status", part.label.toUpperCase() + " · " + part.value.toUpperCase());
          return;
        }
        /* Fast path: shift-click a person to start a link, then click the target. */
        if (id && shift) { startLinkFrom(id); return; }
        /* Ctrl/Cmd-click adds a person to the selection (box-select does the
         * same for people sitting together). Select two, then right-click to
         * merge them into one profile. */
        var srcEvent = event.event && event.event.srcEvent;
        if (id && srcEvent && (srcEvent.ctrlKey || srcEvent.metaKey)) { toggleSelectedId(String(id)); return; }
        if (id) {
          clearEdgeSelection(); clearSelectedIds();

          if (String(id) === state.selectedId) { openDossier(state.selectedId); return; }
          state.selectedId = String(id);
          state.cycleAnchor = String(id); state.cycleIndex = -1;   /* clicking anchors the ←/→ connection walk */
          render();
          openDossier(state.selectedId);
          return;
        }
        var edgeId = event.edges && event.edges[0];
        if (edgeId) { clearSelectedIds(); selectEdge(edgeId); return; }
        clearEdgeSelection(); clearSelectedIds();
        closeDossier();
      });
      /* Right-click context menu — the SOLAR charting model. Touch long-press is
       * wired separately below so the same menus open on a phone. */
      state.network.on("oncontext", function (params) {
        if (params.event && params.event.preventDefault) params.event.preventDefault();
        if (state._panMoved) { state._panMoved = false; return; }   /* that right-click was a pan */
        var clientX = params.event ? params.event.clientX : 0, clientY = params.event ? params.event.clientY : 0;
        openContextMenuAt(clientX, clientY);
      });
      state.network.on("beforeDrawing", function (ctx) { drawRings(ctx); });
      state.network.on("afterDrawing", function (ctx) { drawTagFlair(ctx); });
      /* When the Force layout settles, freeze it and keep the positions so a
       * later re-render doesn't restart physics from the seed layout. */
      state.network.on("stabilizationIterationsDone", function () {
        if (state.layout !== "force") return;
        try { var ps = state.network.getPositions(); Object.keys(ps).forEach(function (id) { state.positions[id] = ps[id]; }); } catch (e) {}
        state._forceSettled = true;
        try { state.network.setOptions({ physics: false }); } catch (e) {}
        try { state.network.fit({ animation: true }); } catch (e) {}
      });
      wireLongPress($("#network"));
      wireBoxSelect($("#network"));
      /* Remember where the user drops a node so a re-render keeps their layout.
       * In the orbit layout a drop also re-pins: land inside a ring band and the
       * person pins to that ring (taking its colour); drag them well past the
       * outer ring and they come off the rings entirely and stay where dropped. */
      state.network.on("dragEnd", function (event) { if (event.nodes && event.nodes.length) applyNodeDrop(event.nodes); });
      /* QA hook, off by default: with ?orbittest=1 expose select-by-id so an
       * automated screenshot can open a profile deterministically. No effect
       * on normal use. */
      if (/[?&]orbittest=1/.test(String(window.location.search || ""))) {
        window.__ORBIT_SELECT__ = function (id) { state.selectedId = String(id); state.cycleAnchor = String(id); state.cycleIndex = -1; render(); openDossier(state.selectedId); };
        window.__ORBIT_LINK__ = function (a, b) { addRelationship(a, b); };
        window.__ORBIT_UNLINK__ = function (a, b) { removeRelationship(a, b); };
        window.__ORBIT_NODE_DOM__ = function (id) { try { var p = state.network.getPositions([id])[id]; return state.network.canvasToDOM(p); } catch (e) { return null; } };
        window.__ORBIT_SETPHOTO__ = function (id, dataUrl) { var person = personById(id); if (!person) return; pushUndo(); state.store.merge({ entities: [{ id: id, type: "person", label: person.label, attrs: { photo: dataUrl } }], links: [] }); };
        window.__ORBIT_SETRELTYPE__ = function (a, b, type) { if (!state.store) return; var k = relationshipKey(a, b); setRelationshipType(state.store.linkId({ from: k[0], to: k[1], type: "KNOWS" }), type); };
        window.__ORBIT_RELTYPE__ = function (a, b) { var k = relationshipKey(a, b); var id = state.store.linkId({ from: k[0], to: k[1], type: "KNOWS" }); var l = linkById(id); return l ? String(D.attrs(l).relationshipType || "") : null; };
        window.__ORBIT_SETICON__ = function (id, key) { setIcon(id, key); };
        window.__ORBIT_ICON__ = function (id) { var p = personById(id); return p ? String(D.attrs(p).icon || "") : null; };
        window.__ORBIT_NODE_FIXED__ = function (id) { try { return !!(state.network.body.nodes[id].options.fixed && state.network.body.nodes[id].options.fixed.x); } catch (e) { return null; } };
        window.__ORBIT_LINKFROM__ = function () { return state.linkFrom; };
        window.__ORBIT_SETLAYOUT__ = function (key) { setLayout(key); };
        window.__ORBIT_LAYOUT__ = function () { return state.layout; };
        window.__ORBIT_POS__ = function (id) { try { return state.network.getPositions([id])[id]; } catch (e) { return null; } };
        window.__ORBIT_RING__ = function (id) { var p = personById(id); return p ? String(D.attrs(p).ring || "") : null; };
        window.__ORBIT_DRAGTO__ = function (id, x, y) { try { var n = state.network.body.nodes[id]; n.x = x; n.y = y; if (n.setX) { n.setX(x); n.setY(y); } applyNodeDrop([id]); return __ORBIT_RING__(id); } catch (e) { return "err:" + e.message; } };
        window.__ORBIT_CYCLE__ = function (dir) { cycleConnection(dir); return state.selectedId; };
        window.__ORBIT_DELETE__ = function (id) { removeContact(String(id)); return trashCount(); };
        window.__ORBIT_TRASH__ = function () { return trashRead().map(function (r) { return { tid: r.tid, label: r.label, links: r.links.length }; }); };
        window.__ORBIT_RESTORE__ = function (tid) { trashRestore(tid); return trashCount(); };
        window.__ORBIT_PEOPLE__ = function () { return state.snapshot ? state.snapshot.entities.filter(function (e) { return D.isPerson(e) && !isMe(e.id); }).length : 0; };
        window.__ORBIT_SELECTED__ = function () { return state.selectedId; };
        window.__ORBIT_MULTI__ = function () { return Object.keys(state.selectedIds); };
        window.__ORBIT_TAGS__ = function (id) { var p = personById(id); return p ? tagsOf(p) : null; };
        window.__ORBIT_SETTAGS__ = function (id, list) { setTags(id, list); return __ORBIT_TAGS__(id); };
        window.__ORBIT_TAGCENSUS__ = function () { return tagCensus(); };
        window.__ORBIT_DUPES__ = function () { return duplicateCandidates().map(function (d) { return { a: String(d.a.id), b: String(d.b.id), reason: d.reason }; }); };
        window.__ORBIT_PATH__ = function (id) { showPathTo(id); return state.path ? state.path.ids : null; };
        window.__ORBIT_COLD__ = function () { return coldList().map(function (r) { return { id: r.id, label: r.label, ring: r.ring, days: r.debt.days, ever: r.debt.everContacted }; }); };
        window.__ORBIT_COLDMODE__ = function () { toggleColdMode(); return state.coldMode; };
        window.__ORBIT_BULKTAG__ = function (ids, tag) { bulkTag(ids, tag); return ids.map(function (i) { return __ORBIT_TAGS__(i); }); };
        window.__ORBIT_TAGFILTER__ = function (key) { toggleTagFilter(key); return Object.keys(state.tagFilter); };
        window.__ORBIT_KINDFILTER__ = function (key) { toggleKindFilter(key); return Object.keys(state.kindFilter); };
        window.__ORBIT_CHIPS__ = function () { return Array.prototype.slice.call(document.querySelectorAll("#tag-bar [data-kind-filter],#tag-bar [data-tag-filter]")).map(function (n) { return n.textContent.replace(/\s+/g, " ").trim(); }); };
        window.__ORBIT_TOOLTIP__ = function (id) { try { return String(state.nodesDS.get(String(id)).title || ""); } catch (e) { return null; } };
        window.__ORBIT_LINKID__ = function (a, b) {
          var found = (state.snapshot ? state.snapshot.links : []).filter(function (l) {
            var f = normaliseId(l.from), t = normaliseId(l.to);
            return (f === String(a) && t === String(b)) || (f === String(b) && t === String(a));
          })[0];
          return found ? String(found.id) : null;
        };
        window.__ORBIT_SETLABEL__ = function (linkId, value) { setRelationshipType(linkId, value); return __ORBIT_LABELOF__(linkId); };
        window.__ORBIT_LABELOF__ = function (linkId) { var l = linkById(linkId); return l ? String(D.attrs(l).relationshipType || "") : null; };
        window.__ORBIT_PASTE__ = function (payload, direction) {
          var I = window.OrbitNetworkImporters;
          var name = "benwlsn11_IG_" + (direction === "following" ? "Following" : "Followers");
          var result = I.review(payload, name);
          openImportReview([{ name: name, candidates: result.candidates || [], skippedCount: result.skippedCount || 0 }]);
          return (result.candidates || []).filter(function (c) { return !!c.avatarUrl; }).length;
        };
        window.__ORBIT_PHOTO__ = function (id) { var p = personById(id); return p ? String(D.attrs(p).photo || "") : null; };
        window.__ORBIT_MAILBOX__ = function (text, name) {
          var Mbox = window.OrbitMbox;
          var summary = Mbox.createSummary({ mine: myAddresses(), since: Date.now() - MBOX_MONTHS * 30.44 * 86400000, keepRecent: MBOX_KEEP_RECENT });
          var reader = Mbox.createReader(function (h) { summary.add(h); });
          String(text).split("\n").forEach(function (line) { reader.line(line); });
          reader.end();
          var result = summary.result();
          openImportReview([{ name: name || "mail.mbox", candidates: mailboxCandidates(result), skippedCount: 0 }], mailboxNote(result));
          return { people: result.people.length, kept: result.counts.kept, old: result.counts.skippedOld };
        };
        window.__ORBIT_MAILSTATS__ = function (id) {
          var p = personById(id); if (!p) return null;
          var a = D.attrs(p);
          return { total: Number(a.emailTotal || 0), sent: Number(a.emailSent || 0), received: Number(a.emailReceived || 0), last: String(a.emailLastAt || "") };
        };
        window.__ORBIT_TIMELINE__ = function (id) {
          var P = window.OrbitNetworkProfile, built = P ? P.buildProfile(state.snapshot, String(id)) : null;
          return built ? built.history.map(function (h) { return { title: h.title, link: h.link || "", kind: h.kind }; }) : null;
        };
        window.__ORBIT_EMPTYPOINT__ = function () {
          var el = document.querySelector("#network"), r = el.getBoundingClientRect();
          for (var y = 70; y < r.height - 70; y += 24) {
            for (var x = 20; x < r.width - 20; x += 24) {
              if (!state.network.getNodeAt({ x: x, y: y }) && !state.network.getEdgeAt({ x: x, y: y })) return { x: r.left + x, y: r.top + y };
            }
          }
          return null;
        };
        window.__ORBIT_SETARROW__ = function (linkId, target) { setLinkArrow(linkId, target); var l = linkById(linkId); return l ? String(D.attrs(l).pointsTo || "") : null; };
        window.__ORBIT_EDGEARROWS__ = function (linkId) { try { var e = state.edgesDS.get(String(linkId)); return e && e.arrows ? e.arrows : null; } catch (err) { return null; } };
        window.__ORBIT_EDGEMENU__ = function (linkId) {
          edgeCtxMenu(String(linkId), 10, 10);
          var items = Array.prototype.slice.call(document.querySelectorAll(".ctx-menu .ctx-item")).map(function (n) { return n.textContent; });
          closeCtxMenu();
          return items;
        };
        window.__ORBIT_NODEOPACITY__ = function (id) { try { var o = state.network.body.nodes[String(id)].options.opacity; return o == null ? 1 : o; } catch (e) { return "err"; } };
        window.__ORBIT_VISIBLE__ = function () { return state.snapshot ? currentNodeIds(state.snapshot).length : 0; };
        window.__ORBIT_ICON_USED__ = function (id) { var p = personById(id); if (!p || !window.OrbitIcons) return null; var a = D.attrs(p); return String(a.icon || window.OrbitIcons.defaultKey(String(a.entityKind || "individual"))); };
        window.__ORBIT_VIEW__ = function () { try { var v = state.network.getViewPosition(); return { scale: Number(state.network.getScale().toFixed(4)), x: Math.round(v.x), y: Math.round(v.y) }; } catch (e) { return null; } };
        window.__ORBIT_TOGGLE__ = function (id) { toggleSelectedId(id); return Object.keys(state.selectedIds); };
        window.__ORBIT_NEIGHBOURS__ = function (id) { return neighboursOf(String(id)).map(personLabel); };
        window.__ORBIT_FOLLOWS__ = function () {
          return (state.snapshot ? state.snapshot.links : []).filter(isFollowLink).map(function (l) {
            return { from: personLabel(normaliseId(l.from)), to: personLabel(normaliseId(l.to)), label: igFollowLabel(l), attrs: D.attrs(l) };
          });
        };
        window.__ORBIT_HANDLE__ = function (id) { var p = personById(id); return p ? String(D.attrs(p).instagram || "") : null; };
        window.__ORBIT_BYHANDLE__ = function (handle) { var p = personByHandle(igHandle(handle)); return p ? String(p.id) : null; };
        window.__ORBIT_SHAPE__ = function () {
          var shape = shapeOf();
          return {
            groups: shape.groups.map(function (g) { return { name: g.name, size: g.size, members: g.members.map(personLabel).sort() }; }),
            bridges: shape.bridges.map(function (b) { return { name: b.name, splitsInto: b.splitsInto }; }),
            shared: shape.shared.map(function (r) { return { value: r.value, who: r.who.sort() }; })
          };
        };
        window.__ORBIT_SUGGESTIONS__ = function () { return linkSuggestions().map(function (r) { return { a: personLabel(r.a), b: personLabel(r.b), why: r.reasons.map(function (x) { return x.why; }) }; }); };
        window.__ORBIT_ACCEPT__ = function (a, b) { addRelationship(a, b); render(); return neighboursOf(a).map(personLabel); };
        window.__ORBIT_REJECT__ = function (a, b) { rejectLink(a, b); renderSuggestions(); return linkSuggestions().length; };
        window.__ORBIT_HISTORY__ = function () { return networkHistory().map(function (r) { return { title: r.title, kind: r.kind, who: r.who, link: r.link }; }); };
        window.__ORBIT_BRIEF__ = function () { return BR.page(briefModel()); };
        window.__ORBIT_PROVENANCE__ = function (id) { var p = personById(id); return p && EV ? EV.provenance(p) : null; };
        window.__ORBIT_GROUPFILTER__ = function (key) { state.groupFilter = key || ""; renderTagBar(); render(); return state.groupFilter; };
        window.__ORBIT_QUERY__ = function (text) { state.query = String(text || ""); render(); return currentNodeIds(state.snapshot).length; };
        window.__ORBIT_EXPAND__ = function (id) { toggleExpanded(id); return Object.keys(state.expanded); };
        window.__ORBIT_DETAILNODES__ = function (id) {
          return state.nodesDS.getIds().filter(function (nodeId) { return isDetailNode(nodeId) && detailOwner(nodeId) === String(id); })
            .map(function (nodeId) { return String(state.nodesDS.get(nodeId).label); });
        };
        window.__ORBIT_DETAILS__ = function (id) { var p = personById(id); return p ? detailsOf(p).map(function (d) { return d.label + "|" + d.value + "|" + d.href; }) : null; };
        window.__ORBIT_BYEMAIL__ = function (address) {
          var want = String(address || "").toLowerCase();
          var hit = (state.snapshot ? state.snapshot.entities : []).filter(function (e) {
            return D.isPerson(e) && String(D.attrs(e).email || "").toLowerCase().split(/[,;s]+/).indexOf(want) !== -1;
          })[0];
          return hit ? String(hit.id) : null;
        };
        window.__ORBIT_RENAME__ = function (id, name) { renameContact(id, name); var p = personById(id); return p ? String(p.label) : null; };
        window.__ORBIT_LABEL__ = function (id) { var p = personById(id); return p ? String(p.label) : null; };
        window.__ORBIT_NETWORK__ = function () { return state.network; };
        window.__ORBIT_MERGE__ = function (survivor, absorbed) { mergeContacts(survivor, absorbed); return state.selectedId; };
        window.__ORBIT_ATTRS__ = function (id) { var p = personById(id); return p ? D.attrs(p) : null; };
        window.__ORBIT_PROFILE__ = function (id) { var P = window.OrbitNetworkProfile; return P ? P.buildProfile(state.snapshot, String(id)) : null; };
        window.__ORBIT_NODEAT__ = function (id) { try { var d = state.network.canvasToDOM(state.network.getPositions([id])[id]); return state.network.getNodeAt(d); } catch (e) { return "err:" + e.message; } };
      }
    } else {
      /* Updating in place leaves the camera alone by construction — setData used
       * to re-frame the chart and had to be undone afterwards — and only touches
       * what actually changed. */
      state.nodePrints = applyToDataSet(state.nodesDS, nodes, state.nodePrints || Object.create(null));
      state.edgePrints = applyToDataSet(state.edgesDS, edges, state.edgePrints || Object.create(null));
    }
    /* Physics runs only for the Force layout, and only until it settles (then it
     * freezes, capturing positions), so selecting or editing never re-shuffles. */
    if (state.network) {
      var wantPhysics = layoutPhysics && !state._forceSettled;
      try {
        state.network.setOptions(wantPhysics
          ? { physics: { enabled: true, solver: "barnesHut", barnesHut: { gravitationalConstant: -6200, centralGravity: 0.15, springLength: 180, springConstant: 0.03, damping: 0.35, avoidOverlap: 0.7 }, stabilization: { iterations: 60, fit: true } } }
          : { physics: false });
      } catch (e) {}
    }
    /* Refit only when people ARRIVE (an import, an undo, a cleared search) or a
     * search narrows the chart. Deleting one of the people on screen leaves the
     * view exactly where it was, so cycling through with ←/→ and deleting as you
     * go never re-frames the chart. */
    var countChanged = state._nodeCount !== people.length, grew = people.length > state._nodeCount;
    if (firstBuild || (countChanged && (grew || state.query.trim()))) {
      if (state.query.trim()) {
        try { state.network.fit({ animation: !firstBuild }); } catch (e) {}   /* frame the search matches */
      } else if (state.layout === "orbit") {
        var el = $("#network"), w = (el && el.clientWidth) || 800, h = (el && el.clientHeight) || 600;
        var scale = Math.max(0.35, Math.min(1.1, Math.min(w, h) / (2 * 540)));
        try { state.network.moveTo({ position: { x: 0, y: 0 }, scale: scale, animation: false }); } catch (e) { state.network.fit({ animation: false }); }
      } else { state.network.fit({ animation: false }); }
    }
    state._nodeCount = people.length;
    $("#network-empty").hidden = snapshot.stats.people > 0 || state.emptyDismissed;
    state.flair = flair;
  }
  function dismissEmpty() { state.emptyDismissed = true; var el = $("#network-empty"); if (el) el.hidden = true; }

  function render() {
    if (!state.store) return;
    state.snapshot = D.snapshot(state.store);
    setStats(state.snapshot);
    renderTagBar();
    renderGraph(state.snapshot);
    if (state.selectedId) openDossier(state.selectedId);
  }
  function openDossier(id) {
    var person = state.snapshot && state.snapshot.entities.find(function (entity) { return String(entity.id) === String(id); });
    if (!person) return;
    var profile = P && P.buildProfile ? P.buildProfile(state.snapshot, id) : null;
    if (!profile) return;
    var heading = $("#dossier-name");
    if (heading) {
      heading.setAttribute("contenteditable", "plaintext-only");
      heading.setAttribute("role", "textbox");
      heading.tabIndex = 0;
      /* Never overwrite what is being typed. */
      if (document.activeElement !== heading) heading.textContent = profile.header.name;
    }
    var isOrg = profile.header.kind === "organisation" || profile.header.kind === "generic-inbox";
    var avatar = $("#dossier-avatar");
    if (avatar) {
      var img = profile.header.photo;
      if (!img && window.OrbitIcons) { var key = profile.header.icon || window.OrbitIcons.defaultKey(profile.header.kind); img = window.OrbitIcons.chip(key, { bg: isOrg ? "#241f16" : "#242424", ring: isOrg ? "#c9a24b" : "#8a8a8a", glyph: isOrg ? "#e6c877" : "#e8e8e8" }); }
      if (img) { avatar.style.backgroundImage = "url('" + img.replace(/'/g, "%27") + "')"; avatar.hidden = false; }
      else { avatar.hidden = true; }
    }
    var ringBadge = $("#dossier-ring"), ringKey = profile.header.ring;
    if (ringBadge) {
      if (ringKey && RING_LABELS[ringKey]) { ringBadge.textContent = RING_LABELS[ringKey]; ringBadge.style.borderColor = RING_COLOURS[ringKey]; ringBadge.style.color = RING_COLOURS[ringKey]; ringBadge.hidden = false; }
      else { ringBadge.hidden = true; }
    }
    var badge = $("#dossier-kind");
    var kindBadge = isOrg ? "Organisation" : (profile.header.kind === "social" ? "Social handle" : (profile.header.kind === "email" || profile.header.kind === "unknown" ? "Email only" : ""));
    if (badge) { badge.textContent = kindBadge; badge.hidden = !kindBadge; }
    var dossier = $("#person-dossier"); if (dossier) dossier.setAttribute("data-kind", isOrg ? "organisation" : "individual");
    /* Your own record has no Delete, and Edit opens Account rather than the
     * contact form. */
    var deleteAction = $('[data-action="delete-contact"]'); if (deleteAction) deleteAction.hidden = isMe(id);
    var pathAction = $('[data-action="show-path"]'); if (pathAction) pathAction.hidden = isMe(id);
    var editAction = $('[data-action="edit-person"]'); if (editAction) editAction.textContent = isMe(id) ? "Edit my details" : "Edit profile";
    var kindWord = isOrg ? "Organisation" : (profile.header.kind === "social" ? "Social handle" : (profile.header.kind === "email" || profile.header.kind === "unknown" ? "Email address only" : ""));
    var vanity = profile.header.preferredName && profile.header.preferredName.toLowerCase() !== profile.header.name.toLowerCase() ? profile.header.preferredName : "";
    var described = [vanity, profile.header.role, profile.header.organisation, profile.header.location, profile.header.relationship, kindWord].filter(Boolean).join(" · ");
    var partCount = detailsOf(profile.person).length;
    setText("#dossier-role", described || (partCount
      ? partCount + (partCount === 1 ? " detail recorded" : " details recorded") + " · right-click to expand"
      : "No details recorded yet"));
    var tagBox = $("#dossier-tags");
    if (tagBox) {
      var tags = tagsOf(person);
      tagBox.hidden = !tags.length;
      tagBox.innerHTML = tags.map(function (tag) {
        return '<span class="tag-chip static" style="--tag-colour:' + esc(T.colour(tag)) + '"><i class="tag-dot"></i><span>' + esc(tag) + '</span></span>';
      }).join("");
    }
    renderProfile(profile);
    state.mobileView = "profile";
    syncMobileNav();
    var panel = $("#person-dossier");
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    panel.setAttribute("data-selected", "true");
  }
  function renameContact(id, value) {
    var person = personById(id); if (!person || !state.store) return false;
    var next = String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, 120);
    if (!next || next === String(person.label || "")) return false;
    pushUndo();
    /* upsert never rewrites an existing label, so the change is made on the
     * record and persisted with an empty merge — the same route setRing takes. */
    person.label = next;
    state.store.merge({ entities: [], links: [] });
    render();
    openDossier(id);
    if (isMe(id)) syncMeToAccount();
    setText("#sync-status", "RENAMED · " + next.toUpperCase());
    return true;
  }
  /* The heading is the input. Enter commits, Escape puts the old name back, and
   * clicking away commits — the same contract as every other inline field. */
  function wireInlineRename() {
    var heading = $("#dossier-name"); if (!heading) return;
    /* The record is the authority on what the name is, so an abandoned or
     * refused edit is put back from it rather than from a remembered string. */
    function currentName() {
      var person = state.selectedId ? personById(state.selectedId) : null;
      return person ? String(person.label || "") : "";
    }
    function restore() { heading.textContent = currentName(); }
    heading.addEventListener("keydown", function (event) {
      /* While the name is being typed the field owns the keyboard: Delete must
       * not delete the contact, and Escape must leave the edit rather than
       * closing the profile out from under it. */
      event.stopPropagation();
      if (event.key === "Enter") { event.preventDefault(); heading.blur(); return; }
      if (event.key === "Escape") { event.preventDefault(); restore(); heading.blur(); }
    });
    heading.addEventListener("blur", function () {
      if (!state.selectedId || !renameContact(state.selectedId, heading.textContent)) restore();
    });
  }
  function closeDossier() {
    state.selectedId = ""; state.profileTab = "summary"; state.mobileView = "network"; syncMobileNav();
    var panel = $("#person-dossier");
    panel.hidden = true; panel.setAttribute("aria-hidden", "true"); panel.removeAttribute("data-selected");
    var heading = $("#dossier-name"); if (heading) heading.removeAttribute("contenteditable");
    if (state.store) renderGraph(state.snapshot);
  }

  /* ---- Undo / redo (snapshot the vault before each edit, SOLAR model) ---- */
  function cloneCase() {
    if (!state.store) return { entities: [], links: [] };
    try { return { entities: JSON.parse(JSON.stringify(state.store.entities())), links: JSON.parse(JSON.stringify(state.store.links())) }; }
    catch (e) { return { entities: [], links: [] }; }
  }
  function pushUndo() {
    if (!state.store) return;
    state.undoStack.push(cloneCase());
    if (state.undoStack.length > 40) state.undoStack.shift();
    state.redoStack.length = 0;
    updateHistoryButtons();
  }
  function restoreCase(snap) {
    if (!state.store || !snap) return;
    if (state.store.raw && typeof state.store.raw.clear === "function") state.store.raw.clear();
    else if (typeof state.store.clear === "function") state.store.clear();
    state.store.merge({ entities: snap.entities || [], links: snap.links || [] });
  }
  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(cloneCase());
    restoreCase(state.undoStack.pop());
    setText("#sync-status", "UNDID LAST CHANGE");
    updateHistoryButtons();
  }
  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(cloneCase());
    restoreCase(state.redoStack.pop());
    setText("#sync-status", "REDID CHANGE");
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    var u = $('[data-action="undo"]'), r = $('[data-action="redo"]');
    if (u) u.disabled = !state.undoStack.length;
    if (r) r.disabled = !state.redoStack.length;
  }

  /* ---- Relationships (draw-to-link on the graph) ---- */
  function relationshipKey(a, b) { return [String(a), String(b)].sort(); }
  function relationshipContrib(a, b) { var k = relationshipKey(a, b); return "rel:" + k[0] + "|" + k[1]; }
  function personLabel(id) {
    if (String(id) === D.ME_ID) return "you";
    var person = state.snapshot && state.snapshot.entities.find(function (e) { return String(e.id) === String(id); });
    return person ? String(person.label || "this contact") : "this contact";
  }
  /* The people directly linked to a person (excluding ME), label-sorted for a
   * stable left/right cycle order. */
  function neighboursOf(id) {
    if (!state.snapshot) return [];
    var set = Object.create(null);
    state.snapshot.links.forEach(function (l) {
      var f = normaliseId(l.from), t = normaliseId(l.to);
      if (f === String(id) && t !== D.ME_ID) set[t] = true;
      else if (t === String(id) && f !== D.ME_ID) set[f] = true;
    });
    return Object.keys(set).filter(function (nid) {
      return state.snapshot.entities.some(function (e) { return String(e.id) === nid && D.isPerson(e); });
    }).sort(function (a, b) { return personLabel(a).localeCompare(personLabel(b)); });
  }
  /* Every person in the network, label-sorted (ME excluded) — the order the
   * left/right keys step through. */
  function allPeopleIds() {
    if (!state.snapshot) return [];
    return state.snapshot.entities.filter(D.isPerson).map(function (e) { return String(e.id); })
      .sort(function (a, b) { return personLabel(a).localeCompare(personLabel(b)); });
  }
  /* With a profile open, left/right flip to the previous/next person (wrapping)
   * and recentre the graph on them, so you can review the whole network by keyboard. */
  function cycleConnection(dir) {
    var list = allPeopleIds();
    if (!list.length) return;
    /* No open profile but people highlighted (a box-select, or a drag that
     * caught them by accident): collapse to the first of them and show who that
     * is, rather than leaving the keys inert. */
    if (!state.selectedId) {
      var highlighted = list.filter(function (p) { return state.selectedIds[p]; });
      var resume = highlighted[0] || (list.indexOf(state.cycleAnchor) !== -1 ? state.cycleAnchor : "");
      if (resume) {
        state.selectedId = resume; state.cycleAnchor = resume; state.cycleIndex = -1;
        clearEdgeSelection(); clearSelectedIds();
        render(); openDossier(resume);
        setText("#sync-status", "PROFILE " + (list.indexOf(resume) + 1) + " OF " + list.length + " · " + personLabel(resume).toUpperCase());
        return;
      }
      return;
    }
    if (list.length < 2) return;
    var cur = list.indexOf(String(state.selectedId));
    var idx = ((cur < 0 ? 0 : cur) + (dir < 0 ? -1 : 1)) % list.length;
    if (idx < 0) idx += list.length;
    var target = list[idx];
    state.selectedId = target;
    clearEdgeSelection(); clearSelectedIds();
    render();               /* highlights the person's node in place */
    openDossier(target);    /* no camera move — cycling drives the profile, not the graph view */
    setText("#sync-status", "PROFILE " + (idx + 1) + " OF " + list.length + " · " + personLabel(target).toUpperCase());
  }
  function addRelationship(a, b) {
    if (!state.store || !a || !b || String(a) === String(b)) return;
    pushUndo();
    var k = relationshipKey(a, b), stamp = new Date().toISOString();
    var link = { id: state.store.linkId({ from: k[0], to: k[1], type: "KNOWS" }), from: k[0], to: k[1], type: "KNOWS", source: "manual", createdBy: "personal-network", contrib: relationshipContrib(a, b), attrs: { sourceType: "user-entered", sourceRef: "manual-relationship", observedAt: stamp } };
    state.store.merge({ entities: [], links: [link] });
    setText("#sync-status", "RELATIONSHIP ADDED");
    return link.id;
  }
  function removeRelationship(a, b) {
    if (!state.store || !state.store.withdraw) return;
    pushUndo();
    state.store.withdraw(relationshipContrib(a, b));
    setText("#sync-status", "RELATIONSHIP REMOVED");
  }
  var RELATIONSHIP_TYPES = ["Friend", "Family", "Partner", "Colleague", "Acquaintance", "Knows"];
  function linkById(id) { return state.snapshot && state.snapshot.links.find(function (l) { return String(l.id) === String(id); }); }
  function setRelationshipType(linkId, type) {
    var link = linkById(linkId); if (!link || !state.store) return;
    pushUndo();
    state.store.merge({ entities: [], links: [{ id: link.id, from: link.from, to: link.to, type: link.type || "KNOWS", attrs: { relationshipType: String(type || "") } }] });
    setText("#sync-status", "RELATIONSHIP SET · " + String(type || "").toUpperCase());
  }
  /* Which end the arrow points at, stored as the id it points to so it survives
   * however the link's own from/to happen to be ordered. */
  function setLinkArrow(linkId, targetId) {
    var link = linkById(linkId); if (!link || !state.store) return;
    pushUndo();
    if (targetId) state.store.merge({ entities: [], links: [{ id: link.id, from: link.from, to: link.to, type: link.type || "KNOWS", attrs: { pointsTo: String(targetId) } }] });
    else { if (link.attrs) delete link.attrs.pointsTo; state.store.merge({ entities: [], links: [] }); }
    render();
    setText("#sync-status", targetId ? "ARROW POINTS AT " + personLabel(targetId).toUpperCase() : "ARROW CLEARED");
  }
  function clearRelationshipType(linkId) {
    var link = linkById(linkId); if (!link || !link.attrs) return;
    pushUndo();
    delete link.attrs.relationshipType;
    state.store.merge({ entities: [], links: [] });
    render();
    setText("#sync-status", "RELATIONSHIP LABEL CLEARED");
  }
  function selectEdge(edgeId) {
    var link = state.snapshot && state.snapshot.links.find(function (l) { return String(l.id) === String(edgeId); });
    if (!link) { clearEdgeSelection(); return; }
    var removable = link.source === "manual" || (link.attrs && link.attrs.sourceRef === "manual-relationship");
    state.selectedEdge = { id: link.id, from: link.from, to: link.to, removable: removable };
    if (state.network) state.network.selectEdges([link.id]);
    var panel = $("#edge-remove"); if (!panel) return;
    setText("#edge-remove-label", personLabel(link.from) === "you" || personLabel(link.to) === "you"
      ? "You know " + (personLabel(link.from) === "you" ? personLabel(link.to) : personLabel(link.from))
      : personLabel(link.from) + " ↔ " + personLabel(link.to));
    var remove = $('[data-action="remove-edge"]');
    if (remove) { remove.hidden = !removable; }
    setText("#edge-remove-note", removable ? "" : "From an import — remove it on the contact instead.");
    panel.hidden = false;
  }
  function clearEdgeSelection() {
    state.selectedEdge = null;
    var panel = $("#edge-remove"); if (panel) panel.hidden = true;
    if (state.network) try { state.network.unselectAll(); } catch (e) {}
  }
  function removeSelectedEdge() {
    if (!state.selectedEdge || !state.selectedEdge.removable) return;
    removeRelationship(state.selectedEdge.from, state.selectedEdge.to);
    clearEdgeSelection();
  }

  /* ---- Canvas background themes (SOLAR-style, user-selectable) ---- */
  var BG_THEMES = {
    charcoal: { label: "Charcoal", swatch: "#1c1c1c", stage: "radial-gradient(circle at 50% 42%,#202020,#141414 72%)" },
    orbit: { label: "Orbit", swatch: "#2a0d0a", stage: "radial-gradient(circle at 70% 26%,rgba(218,41,28,.16),transparent 30%),linear-gradient(135deg,#181818,#181818 52%,#3a0a07)" },
    peacock: { label: "Peacock", swatch: "#0e2f2e", stage: "radial-gradient(circle at 50% 40%,#123a39,#07191a 74%)" },
    midnight: { label: "Midnight", swatch: "#141a30", stage: "radial-gradient(circle at 50% 40%,#161d38,#080b18 74%)" },
    forest: { label: "Forest", swatch: "#13251a", stage: "radial-gradient(circle at 50% 40%,#152e20,#081410 74%)" },
    graphite: { label: "Graphite", swatch: "#242424", stage: "radial-gradient(circle at 50% 40%,#2a2a2a,#161616 74%)" }
  };
  function loadBgTheme() { try { return window.localStorage.getItem("orbit_bg_theme") || "charcoal"; } catch (e) { return "charcoal"; } }
  function applyBgTheme(key) {
    var theme = BG_THEMES[key] || BG_THEMES.charcoal;
    state.bgTheme = BG_THEMES[key] ? key : "charcoal";
    var stage = $(".network-stage"); if (stage) stage.style.background = theme.stage;
    try { window.localStorage.setItem("orbit_bg_theme", state.bgTheme); } catch (e) {}
    if (state.network) try { state.network.redraw(); } catch (e) {}
  }
  function showThemePicker(x, y) {
    closeCtxMenu(); closeIconPicker();
    /* Deferred so the click that opened it doesn't hit the close-on-outside-click
     * handler and dismiss it immediately. */
    setTimeout(function () {
      var pop = document.createElement("div"); pop.className = "icon-picker theme-picker"; pop.setAttribute("role", "menu");
      Object.keys(BG_THEMES).forEach(function (key) {
        var t = BG_THEMES[key];
        var btn = document.createElement("button"); btn.type = "button"; btn.className = "theme-swatch" + (state.bgTheme === key ? " active" : ""); btn.title = t.label;
        btn.innerHTML = '<span class="theme-chip" style="background:' + t.swatch + '"></span><span class="theme-name">' + esc(t.label) + '</span>';
        btn.addEventListener("click", function () { closeIconPicker(); applyBgTheme(key); });
        pop.appendChild(btn);
      });
      document.body.appendChild(pop); iconPickerEl = pop;
      var mw = pop.offsetWidth, mh = pop.offsetHeight;
      pop.style.left = Math.min(x, window.innerWidth - mw - 8) + "px";
      pop.style.top = Math.min(y, window.innerHeight - mh - 8) + "px";
      var first = pop.querySelector("button"); if (first) first.focus();
    }, 0);
  }

  function showLayoutPicker(x, y) {
    closeCtxMenu(); closeIconPicker();
    setTimeout(function () {
      var pop = document.createElement("div"); pop.className = "icon-picker layout-picker"; pop.setAttribute("role", "menu");
      LAYOUTS.forEach(function (l) {
        var btn = document.createElement("button"); btn.type = "button"; btn.className = "layout-item" + (state.layout === l.key ? " active" : ""); btn.title = l.tip;
        btn.innerHTML = '<span class="layout-name">' + (state.layout === l.key ? "✓ " : "") + esc(l.label) + '</span><span class="layout-tip">' + esc(l.tip) + '</span>';
        btn.addEventListener("click", function () { closeIconPicker(); setLayout(l.key); });
        pop.appendChild(btn);
      });
      document.body.appendChild(pop); iconPickerEl = pop;
      var mw = pop.offsetWidth, mh = pop.offsetHeight;
      pop.style.left = Math.min(x, window.innerWidth - mw - 8) + "px";
      pop.style.top = Math.min(y, window.innerHeight - mh - 8) + "px";
      var first = pop.querySelector("button"); if (first) first.focus();
    }, 0);
  }

  /* Shown the moment a connection is drawn, so the relationship type is set in
   * the same gesture. Dismissing it just leaves the link unlabelled. */
  function showRelTypePicker(linkId, x, y) {
    closeCtxMenu(); closeIconPicker();
    setTimeout(function () {
      var pop = document.createElement("div"); pop.className = "icon-picker reltype-picker"; pop.setAttribute("role", "menu");
      var head = document.createElement("div"); head.className = "reltype-head"; head.textContent = "How do they know each other?"; pop.appendChild(head);
      RELATIONSHIP_TYPES.forEach(function (type) {
        var btn = document.createElement("button"); btn.type = "button"; btn.className = "reltype-item";
        btn.textContent = type;
        btn.addEventListener("click", function () { closeIconPicker(); setRelationshipType(linkId, type); });
        pop.appendChild(btn);
      });
      var custom = document.createElement("button"); custom.type = "button"; custom.className = "reltype-item reltype-custom"; custom.textContent = "Custom…";
      custom.addEventListener("click", function () { closeIconPicker(); var v = window.prompt("How do they know each other?", ""); if (v != null && String(v).trim()) setRelationshipType(linkId, String(v).trim()); });
      pop.appendChild(custom);
      document.body.appendChild(pop); iconPickerEl = pop;
      var mw = pop.offsetWidth, mh = pop.offsetHeight;
      pop.style.left = Math.min(x, window.innerWidth - mw - 8) + "px";
      pop.style.top = Math.min(y, window.innerHeight - mh - 8) + "px";
      var first = pop.querySelector("button"); if (first) first.focus();
    }, 0);
  }

  /* ---- Right-click context menu (SOLAR charting model) ---- */
  var ctxMenuEl = null, iconPickerEl = null;
  function closeCtxMenu() { if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; } }
  function closeIconPicker() { if (iconPickerEl) { iconPickerEl.remove(); iconPickerEl = null; } }
  function setIcon(id, key) {
    var person = personById(id); if (!person) return;
    pushUndo();
    state.store.merge({ entities: [{ id: id, type: "person", label: person.label, attrs: { icon: String(key || "") } }], links: [] });
    setText("#sync-status", "ICON SET");
  }
  function resetIcon(id) {
    var person = personById(id); if (!person || !person.attrs) return;
    pushUndo();
    delete person.attrs.icon;
    state.store.merge({ entities: [], links: [] });
    render();
    setText("#sync-status", "ICON RESET");
  }
  function showIconPicker(id, x, y) {
    var Icons = window.OrbitIcons; if (!Icons) return;
    closeCtxMenu(); closeIconPicker();
    setTimeout(function () {
      var pop = document.createElement("div"); pop.className = "icon-picker"; pop.setAttribute("role", "menu");
      var grid = document.createElement("div"); grid.className = "icon-grid";
      Icons.catalogue.forEach(function (key) {
        var btn = document.createElement("button"); btn.type = "button"; btn.className = "icon-swatch"; btn.title = Icons.labels[key] || key; btn.setAttribute("aria-label", Icons.labels[key] || key);
        var img = document.createElement("img"); img.src = Icons.chip(key, { ring: "#9a9a9a", glyph: "#e8e8e8" }); img.width = 34; img.height = 34; img.alt = "";
        btn.appendChild(img);
        btn.addEventListener("click", function () { closeIconPicker(); setIcon(id, key); });
        grid.appendChild(btn);
      });
      pop.appendChild(grid);
      var reset = document.createElement("button"); reset.type = "button"; reset.className = "icon-reset"; reset.textContent = "Use default for this contact";
      reset.addEventListener("click", function () { closeIconPicker(); resetIcon(id); });
      pop.appendChild(reset);
      document.body.appendChild(pop); iconPickerEl = pop;
      var mw = pop.offsetWidth, mh = pop.offsetHeight;
      pop.style.left = Math.min(x, window.innerWidth - mw - 8) + "px";
      pop.style.top = Math.min(y, window.innerHeight - mh - 8) + "px";
      var first = pop.querySelector("button"); if (first) first.focus();
    }, 0);
  }
  function showCtxMenu(x, y, items) {
    closeCtxMenu();
    ctxMenuEl = document.createElement("div");
    ctxMenuEl.className = "ctx-menu";
    ctxMenuEl.setAttribute("role", "menu");
    items.forEach(function (item) {
      if (item === "-") { var sep = document.createElement("div"); sep.className = "ctx-sep"; ctxMenuEl.appendChild(sep); return; }
      var row = document.createElement("div");
      row.className = "ctx-item" + (item.danger ? " danger" : "");
      row.textContent = item.label;
      row.setAttribute("role", "menuitem");
      row.tabIndex = 0;
      function go() { closeCtxMenu(); item.fn(); }
      row.addEventListener("click", go);
      row.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
      ctxMenuEl.appendChild(row);
    });
    document.body.appendChild(ctxMenuEl);
    var mw = ctxMenuEl.offsetWidth, mh = ctxMenuEl.offsetHeight;
    ctxMenuEl.style.left = Math.min(x, window.innerWidth - mw - 8) + "px";
    ctxMenuEl.style.top = Math.min(y, window.innerHeight - mh - 8) + "px";
    var first = ctxMenuEl.querySelector(".ctx-item"); if (first) first.focus();
  }
  /* Resolve what's under a point (node / ME / edge / background) and open the
   * matching menu — shared by right-click and touch long-press. */
  function openContextMenuAt(clientX, clientY) {
    closeCtxMenu();
    if (!state.network) return;
    var container = $("#network"); if (!container) return;
    var rect = container.getBoundingClientRect();
    var dom = { x: clientX - rect.left, y: clientY - rect.top };
    var nodeId = state.network.getNodeAt(dom);
    if (nodeId && isDetailNode(nodeId)) { nodeCtxMenu(detailOwner(nodeId), clientX, clientY); return; }
    if (nodeId) { nodeCtxMenu(String(nodeId), clientX, clientY); return; }
    var edgeId = state.network.getEdgeAt(dom);
    if (edgeId) { edgeCtxMenu(String(edgeId), clientX, clientY); return; }
    var canvasPos = state.network.DOMtoCanvas ? state.network.DOMtoCanvas(dom) : null;
    bgCtxMenu(clientX, clientY, canvasPos);
  }
  /* Touch long-press == right-click (ported from SOLAR chartmenu.js). A small
   * move budget stops it firing during a pan/drag. */
  function wireLongPress(container) {
    if (!container) return;
    var timer = null, start = null, fired = false;
    function clear() { if (timer) { clearTimeout(timer); timer = null; } start = null; }
    container.addEventListener("touchstart", function (ev) {
      if (ev.touches.length !== 1) { clear(); return; }
      var t = ev.touches[0]; start = { x: t.clientX, y: t.clientY }; fired = false;
      timer = setTimeout(function () { timer = null; fired = true; try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {} openContextMenuAt(start.x, start.y); }, 480);
    }, { passive: true });
    container.addEventListener("touchmove", function (ev) {
      if (!start || !ev.touches.length) return;
      var t = ev.touches[0], dx = t.clientX - start.x, dy = t.clientY - start.y;
      if ((dx * dx + dy * dy) > 100) clear();
    }, { passive: true });
    container.addEventListener("touchend", function () { fired = false; clear(); });
    container.addEventListener("touchcancel", clear);
  }
  /* Box / rubber-band select: Shift+drag over empty canvas to select many people
   * at once, then Delete to remove them (SOLAR charting has the same gesture). */
  function nodeIdsInRect(x0, y0, x1, y1) {
    var minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1), ids = [];
    if (!state.network || !state.snapshot) return ids;
    state.snapshot.entities.forEach(function (e) {
      if (!D.isPerson(e)) return;
      try {
        var d = state.network.canvasToDOM(state.network.getPositions([String(e.id)])[String(e.id)]);
        if (d && d.x >= minX && d.x <= maxX && d.y >= minY && d.y <= maxY) ids.push(String(e.id));
      } catch (err) {}
    });
    return ids;
  }
  function setSelectedIds(ids) {
    state.selectedIds = {};
    ids.forEach(function (id) { state.selectedIds[id] = true; });
    var n = Object.keys(state.selectedIds).length;
    if (n) { state.selectedId = ""; closeDossier(); setText("#sync-status", selectionHint(n)); }
    renderGraph(state.snapshot);
  }
  function selectionHint(n) { return n === 2 ? "2 SELECTED · RIGHT-CLICK TO MERGE" : n + " SELECTED · PRESS DELETE TO REMOVE"; }
  /* Ctrl/Cmd-click toggles one person in or out of the selection, so two people
   * anywhere on the chart can be picked without a box big enough to catch both. */
  function toggleSelectedId(id) {
    id = String(id);
    if (state.selectedIds[id]) delete state.selectedIds[id]; else state.selectedIds[id] = true;
    var n = Object.keys(state.selectedIds).length;
    if (n) { state.selectedId = ""; closeDossier(); }
    renderGraph(state.snapshot);
    setText("#sync-status", n ? selectionHint(n) : "READY");
  }
  function clearSelectedIds() { if (Object.keys(state.selectedIds).length) { state.selectedIds = {}; renderGraph(state.snapshot); } }
  function deleteSelectedIds() {
    var ids = Object.keys(state.selectedIds).filter(function (id) { return !isMe(id); });
    if (!ids.length || !state.store) { clearSelectedIds(); return; }
    var successor = nextPersonAfter(ids);
    pushUndo();
    var list = trashRead();
    ids.forEach(function (id) {
      var record = captureForTrash(id); if (record) list.unshift(record);
      delete state.pinned[id]; delete state.positions[id]; delete state.ringAngle[id];
      if (state.store.removeEntity) state.store.removeEntity(String(id), { defer: true });
    });
    trashWrite(list);
    state.store.merge({ entities: [], links: [] }); /* one persist + re-render */
    state.selectedIds = {};
    if (successor) { state.selectedId = successor; state.cycleAnchor = successor; state.cycleIndex = -1; }
    render();
    if (successor) openDossier(successor);
    updateTrashButton();
    setText("#sync-status", ids.length + " MOVED TO RECYCLE BIN");
  }
  /* Mouse: left-drag empty canvas = box select; right-drag = pan (SOLAR model).
   * Touch keeps vis's one-finger pan; long-press opens the menu. */
  function wireBoxSelect(container) {
    if (!container) return;
    var band = $("#rubber-band"), active = false, sx = 0, sy = 0, moved = false;
    var panning = false, panLast = null;
    container.addEventListener("pointerdown", function (e) {
      var r = container.getBoundingClientRect(), dom = { x: e.clientX - r.left, y: e.clientY - r.top };
      /* Right-drag pans (desktop). */
      if (e.button === 2) { panning = true; state._panMoved = false; panLast = { x: e.clientX, y: e.clientY }; return; }
      if (e.button !== 0 || e.pointerType === "touch") return;      /* touch → let vis pan */
      if (state.network && state.network.getNodeAt(dom)) return;    /* on a person → link/drag */
      e.stopPropagation();                                          /* stop vis from panning */
      active = true; sx = dom.x; sy = dom.y; moved = false;
      if (band) { band.style.display = "block"; band.style.left = sx + "px"; band.style.top = sy + "px"; band.style.width = "0px"; band.style.height = "0px"; }
      try { container.setPointerCapture(e.pointerId); } catch (err) {}
    }, true);
    container.addEventListener("pointermove", function (e) {
      if (panning && state.network) {
        var dx = e.clientX - panLast.x, dy = e.clientY - panLast.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) state._panMoved = true;
        panLast = { x: e.clientX, y: e.clientY };
        try { var s = state.network.getScale(), c = state.network.getViewPosition(); state.network.moveTo({ position: { x: c.x - dx / s, y: c.y - dy / s }, animation: false }); } catch (err) {}
        return;
      }
      if (!active) return;
      var r = container.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
      if (Math.abs(cx - sx) + Math.abs(cy - sy) > 3) moved = true;
      if (band) { band.style.left = Math.min(sx, cx) + "px"; band.style.top = Math.min(sy, cy) + "px"; band.style.width = Math.abs(cx - sx) + "px"; band.style.height = Math.abs(cy - sy) + "px"; }
    });
    function done(e) {
      if (panning) { panning = false; return; }
      if (!active) return; active = false;
      if (band) band.style.display = "none";
      var r = container.getBoundingClientRect();
      /* A click on empty canvas is a click, not an empty box-select. This
       * handler swallows the event before vis can see it, so the "clicked
       * nothing" case has to let go of the selection itself. */
      if (!moved) { clearEdgeSelection(); clearSelectedIds(); clearPath(); closeDossier(); return; }
      setSelectedIds(nodeIdsInRect(sx, sy, e.clientX - r.left, e.clientY - r.top));
    }
    container.addEventListener("pointerup", done);
    container.addEventListener("pointercancel", function () { active = false; panning = false; if (band) band.style.display = "none"; });
    container.addEventListener("contextmenu", function (e) { e.preventDefault(); }); /* right-drag shouldn't pop the OS menu */
  }
  /* ---- Tags ----
   * A tag is free text the user invents; its colour comes from the text itself
   * (tags.js), so there is nothing to pick and nothing to keep in step. */
  function tagsOf(person) { return T ? T.parse(D.attrs(person).tags) : []; }
  function setTags(id, list) {
    var person = personById(id); if (!person || !state.store || !T) return;
    pushUndo();
    var tags = T.parse(list);
    /* The store drops empty values, so clearing the last tag has to remove the
     * attribute outright rather than write an empty array. */
    if (tags.length) state.store.merge({ entities: [{ id: String(id), type: "person", label: person.label, attrs: { tags: tags } }], links: [] });
    else { delete person.attrs.tags; state.store.merge({ entities: [], links: [] }); }
    render();
    if (isMe(id)) syncMeToAccount();
    setText("#sync-status", tags.length ? "TAGGED · " + tags.join(", ").toUpperCase() : "TAGS CLEARED");
  }
  function toggleTagOn(id, tag) {
    var person = personById(id); if (!person || !T) return;
    setTags(id, T.toggle(tagsOf(person), tag));
  }
  function tagCensus() {
    if (!T || !state.snapshot) return [];
    return T.census(state.snapshot.entities.filter(D.isPerson), function (e) { return D.attrs(e).tags; });
  }
  /* The chips in front of the tags: not what someone is called, but what Orbit
   * actually holds for them. Each one is a plain test against the record. */
  var KIND_FILTERS = [
    { key: "email", label: "Email", test: function (a) { return !!String(a.email || "").trim(); } },
    { key: "phone", label: "Phone", test: function (a) { return !!String(a.phone || a.phoneOther || a.whatsapp || a.signal || "").trim(); } },
    { key: "social", label: "Social", test: function (a) { return !!String(a.instagram || a.facebook || a.x || a.tiktok || "").trim(); } },
    { key: "photo", label: "Photo", test: function (a) { return !!String(a.photo || "").trim(); } },
    { key: "organisation", label: "Organisations", test: function (a) { var k = String(a.entityKind || ""); return k === "organisation" || k === "generic-inbox"; } },
    { key: "handle-only", label: "Handles only", test: function (a) { var k = String(a.entityKind || ""); return k === "social" || k === "email" || k === "unknown"; } },
    { key: "bare", label: "No details", test: function (a) {
      return !["email", "phone", "phoneOther", "whatsapp", "signal", "instagram", "facebook", "x", "website", "address", "workAddress", "role", "organisation", "birthday", "note"]
        .some(function (key) { return String(a[key] || "").trim(); });
    } }
  ];
  function activeKinds() { return Object.keys(state.kindFilter); }
  function kindFilterMeta(key) { for (var i = 0; i < KIND_FILTERS.length; i++) if (KIND_FILTERS[i].key === key) return KIND_FILTERS[i]; return null; }
  /* Several chips narrow together: someone must satisfy every one that is on. */
  function personMatchesKinds(person) {
    var keys = activeKinds();
    if (!keys.length) return true;
    var a = D.attrs(person);
    return keys.every(function (key) { var meta = kindFilterMeta(key); return meta ? meta.test(a) : true; });
  }
  function toggleKindFilter(key) {
    if (state.kindFilter[key]) delete state.kindFilter[key]; else state.kindFilter[key] = true;
    renderTagBar();
    render();
    var on = activeKinds().map(function (k) { var m = kindFilterMeta(k); return m ? m.label : k; });
    setText("#sync-status", on.length ? "SHOWING " + on.join(" + ").toUpperCase() : "FILTER CLEARED");
  }
  function clearKindFilter() { if (activeKinds().length) { state.kindFilter = {}; renderTagBar(); render(); } }
  function activeTags() { return Object.keys(state.tagFilter); }
  function personMatchesFilter(person) {
    if (state.groupFilter) {
      var group = shapeOf().byPerson[String(person.id)];
      if (!group || group.key !== state.groupFilter) return false;
    }
    if (!personMatchesKinds(person)) return false;
    var active = activeTags();
    if (!active.length) return true;
    var mine = tagsOf(person).map(function (t) { return t.toLowerCase(); });
    return active.some(function (k) { return mine.indexOf(k) !== -1; });
  }
  function toggleTagFilter(key) {
    if (state.tagFilter[key]) delete state.tagFilter[key]; else state.tagFilter[key] = true;
    renderTagBar();
    render();
    var active = activeTags();
    setText("#sync-status", active.length ? "FILTERED BY " + active.join(", ").toUpperCase() : "TAG FILTER CLEARED");
  }
  function clearTagFilter() { if (activeTags().length) { state.tagFilter = {}; renderTagBar(); render(); } }
  function renderTagBar() {
    var bar = $("#tag-bar"); if (!bar) return;
    var people = state.snapshot ? state.snapshot.entities.filter(function (e) { return D.isPerson(e) && !isMe(e.id); }) : [];
    var census = tagCensus();
    bar.hidden = !people.length;
    if (!people.length) { bar.innerHTML = ""; return; }
    /* A chip nobody matches is noise, so each one carries its count and the
     * empty ones are left out. */
    var kinds = KIND_FILTERS.map(function (meta) {
      var count = 0;
      for (var i = 0; i < people.length; i++) if (meta.test(D.attrs(people[i]))) count++;
      return { meta: meta, count: count };
    }).filter(function (row) { return row.count > 0; });
    var html = kinds.map(function (row) {
      var on = !!state.kindFilter[row.meta.key];
      return '<button type="button" class="tag-chip kind' + (on ? " active" : "") + '" data-kind-filter="' + esc(row.meta.key) + '"' +
        ' aria-pressed="' + (on ? "true" : "false") + '"><span>' + esc(row.meta.label) + '</span><b>' + row.count + '</b></button>';
    }).join("");
    /* The groups the network falls into, offered as filters of their own. */
    var groups = shapeOf().groups.slice(0, 5);
    if (kinds.length && groups.length) html += '<span class="tag-bar-split" aria-hidden="true"></span>';
    html += groups.map(function (group) {
      var on = state.groupFilter === group.key;
      return '<button type="button" class="tag-chip group' + (on ? " active" : "") + '" data-group-filter="' + esc(group.key) + '"' +
        ' aria-pressed="' + (on ? "true" : "false") + '" title="A group that holds together without you"><i class="tag-dot"></i><span>' +
        esc(group.name) + "</span><b>" + group.size + "</b></button>";
    }).join("");
    if ((kinds.length || groups.length) && census.length) html += '<span class="tag-bar-split" aria-hidden="true"></span>';
    html += census.map(function (entry) {
      var on = !!state.tagFilter[entry.key];
      return '<button type="button" class="tag-chip' + (on ? " active" : "") + '" data-tag-filter="' + esc(entry.key) + '"' +
        ' style="--tag-colour:' + esc(entry.colour) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
        '<i class="tag-dot"></i><span>' + esc(entry.tag) + '</span><b>' + entry.count + '</b></button>';
    }).join("");
    if (activeTags().length || activeKinds().length || state.groupFilter) html += '<button type="button" class="tag-chip clear" data-tag-clear="1">Clear filter</button>';
    bar.innerHTML = html;
  }
  /* The picker: every tag already in use, plus a line to invent a new one. */
  function showTagPicker(id, x, y) {
    closeCtxMenu(); closeIconPicker();
    var person = personById(id); if (!person || !T) return;
    var mine = tagsOf(person).map(function (t) { return t.toLowerCase(); });
    var census = tagCensus();
    /* Deferred like the icon picker, so the click that opened it doesn't reach
     * the close-on-outside-click handler. */
    setTimeout(function () {
      var pop = document.createElement("div");
      pop.className = "ctx-menu tag-picker";
      pop.setAttribute("role", "menu");
      census.forEach(function (entry) {
        var row = document.createElement("div");
        row.className = "ctx-item tag-row" + (mine.indexOf(entry.key) !== -1 ? " on" : "");
        row.setAttribute("role", "menuitemcheckbox");
        row.setAttribute("aria-checked", mine.indexOf(entry.key) !== -1 ? "true" : "false");
        row.tabIndex = 0;
        row.innerHTML = '<i class="tag-dot" style="--tag-colour:' + esc(entry.colour) + '"></i><span>' + esc(entry.tag) + '</span>';
        function go() { closeIconPicker(); toggleTagOn(id, entry.tag); }
        row.addEventListener("click", go);
        row.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
        pop.appendChild(row);
      });
      if (census.length) { var sep = document.createElement("div"); sep.className = "ctx-sep"; pop.appendChild(sep); }
      var add = document.createElement("div");
      add.className = "ctx-item"; add.textContent = "New tag…"; add.setAttribute("role", "menuitem"); add.tabIndex = 0;
      function invent() {
        closeIconPicker();
        var value = window.prompt("Tag this person (separate several with commas)", T.format(tagsOf(person)));
        if (value != null) setTags(id, value);
      }
      add.addEventListener("click", invent);
      add.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); invent(); } });
      pop.appendChild(add);
      document.body.appendChild(pop); iconPickerEl = pop;
      var mw = pop.offsetWidth, mh = pop.offsetHeight;
      pop.style.left = Math.min(x, window.innerWidth - mw - 8) + "px";
      pop.style.top = Math.min(y, window.innerHeight - mh - 8) + "px";
      var first = pop.querySelector(".ctx-item"); if (first) first.focus();
    }, 0);
  }
  /* ---- Expanding a person ----
   * Merging an account into someone is the right call — one person, one record —
   * but it buries what they are made of in a list of attributes. Expanding puts
   * those parts back on the chart as their own nodes hanging off the person:
   * their handles, their addresses, their numbers.
   *
   * These nodes are drawn, not stored. Nothing is added to the vault, so
   * expanding costs nothing and collapsing leaves no trace. */
  var DETAIL_MARK = "\u0000detail\u0000";
  function detailId(personId, index) { return DETAIL_MARK + personId + DETAIL_MARK + index; }
  function isDetailNode(id) { return String(id).indexOf(DETAIL_MARK) === 0; }
  function detailOwner(id) { return String(id).split(DETAIL_MARK)[1] || ""; }
  var DETAIL_COLOUR = {
    email: "#6f8592", phone: "#7f9a7a", phoneOther: "#7f9a7a", whatsapp: "#7f9a7a", signal: "#7f9a7a",
    instagram: "#8f7fa6", facebook: "#8f7fa6", x: "#8f7fa6", tiktok: "#8f7fa6", social: "#8f7fa6",
    website: "#c9a24b", address: "#a08b6f", workAddress: "#a08b6f"
  };
  /* What a person is made of, in the order it reads best. */
  function detailsOf(person) {
    if (!P || !P.contactMethods) return [];
    var out = P.contactMethods(person).map(function (method) {
      return { kind: method.kind, label: contactKindLabel(method.kind), value: method.value, href: contactHref(method) };
    });
    (P.addresses ? P.addresses(person) : []).forEach(function (row) {
      out.push({ kind: "address", label: row.label, value: row.value, href: "" });
    });
    return out;
  }
  function toggleExpanded(id) {
    id = String(id);
    if (state.expanded[id]) delete state.expanded[id]; else state.expanded[id] = true;
    render();
    var person = personById(id);
    setText("#sync-status", state.expanded[id]
      ? "EXPANDED · " + (person ? String(person.label).toUpperCase() : "") + " · " + detailsOf(person).length + " DETAILS"
      : "COLLAPSED");
  }
  function collapseAll() {
    if (!Object.keys(state.expanded).length) return false;
    state.expanded = {};
    render();
    return true;
  }
  /* ---- What the shape of the network says ----
   * Groups, bridges and shared identifiers all read the same graph, so they are
   * worked out together and cached until the case changes. None of it is
   * stored: it is a reading of what is already there. */
  function peopleForShape() {
    if (!state.snapshot) return [];
    return state.snapshot.entities.filter(function (e) { return D.isPerson(e) && !isMe(e.id); });
  }
  /* The identifiers a person holds, in the form the graph reasoner wants. */
  function selectorsOf(person) {
    var a = D.attrs(person), out = [];
    [["Phone", a.phone], ["Phone", a.phoneOther], ["Email", a.email], ["Address", a.address], ["Address", a.workAddress]].forEach(function (pair) {
      String(pair[1] == null ? "" : pair[1]).split(/[;,]/).forEach(function (value) {
        var v = value.trim(); if (v) out.push({ kind: pair[0], value: v });
      });
    });
    return out;
  }
  function shapeOf() {
    if (!GR || !state.snapshot) return { groups: [], bridges: [], shared: [], byPerson: {}, bridgeIds: {} };
    var stamp = state.snapshot.entities.length + "|" + state.snapshot.links.length + "|" + (state.snapshot.stats ? state.snapshot.stats.relationships : 0);
    if (state.shape && state.shape.stamp === stamp) return state.shape;
    var people = peopleForShape(), ids = people.map(function (e) { return String(e.id); });
    var links = state.snapshot.links.map(function (l) { return { from: normaliseId(l.from), to: normaliseId(l.to) }; });
    var raw = GR.groups(ids.concat([D.ME_ID]), links, { centre: D.ME_ID });
    /* A group of one is a person, not a group. */
    var groups = raw.filter(function (g) { return g.size > 1; }).map(function (g, index) {
      return { key: "g" + (index + 1), name: groupName(g.members), members: g.members, size: g.size };
    });
    var byPerson = Object.create(null);
    groups.forEach(function (group) { group.members.forEach(function (id) { byPerson[id] = group; }); });
    var bridgeIds = Object.create(null);
    var bridges = GR.bridges(ids.concat([D.ME_ID]), links, { centre: D.ME_ID }).map(function (row) {
      bridgeIds[row.id] = row.splitsInto;
      return { id: row.id, name: personLabel(row.id), splitsInto: row.splitsInto };
    });
    var shared = GR.sharedSelectors(people.map(function (person) {
      return { id: String(person.id), selectors: selectorsOf(person) };
    })).map(function (row) {
      return { kind: row.kind, value: row.value, holders: row.holders, who: row.holders.map(personLabel) };
    });
    state.shape = { stamp: stamp, groups: groups, bridges: bridges, shared: shared, byPerson: byPerson, bridgeIds: bridgeIds };
    return state.shape;
  }
  /* Name a group after what its members have in common, falling back to whoever
   * is most connected inside it. */
  function groupName(members) {
    var tally = Object.create(null);
    members.forEach(function (id) {
      var person = personById(id); if (!person) return;
      var a = D.attrs(person);
      if (a.organisation) tally["org:" + a.organisation] = (tally["org:" + a.organisation] || 0) + 1;
      (T ? T.parse(a.tags) : []).forEach(function (tag) { tally["tag:" + tag] = (tally["tag:" + tag] || 0) + 1; });
    });
    var best = "", bestCount = 1;
    Object.keys(tally).forEach(function (key) { if (tally[key] > bestCount) { bestCount = tally[key]; best = key; } });
    if (best) return best.slice(best.indexOf(":") + 1);
    var names = members.map(personLabel).sort();
    return names[0] + " and " + (members.length - 1) + " other" + (members.length === 2 ? "" : "s");
  }
  function personById(id) { return state.snapshot && state.snapshot.entities.find(function (e) { return String(e.id) === String(id) && D.isPerson(e); }); }
  function nodeCtxMenu(id, x, y) {
    var person = personById(id); if (!person) return;
    var mine = isMe(id);
    var pinned = !!state.pinned[String(id)];
    var hasPhoto = !!(person.attrs && person.attrs.photo);
    var items = [
      { label: mine ? "Open my profile" : "Open profile", fn: function () { state.selectedId = String(id); render(); openDossier(state.selectedId); } },
      { label: mine ? "Edit my details…" : "Edit contact…", fn: function () { if (mine) openAccountModal(); else openModal(id); } },
      { label: "Link from here →", fn: function () { startLinkFrom(id); } },
      { label: hasPhoto ? "Change photo…" : "Set photo…", fn: function () { setPhoto(id); } }
    ];
    if (hasPhoto) items.push({ label: "Remove photo", fn: function () { removePhoto(id); } });
    items.push({ label: "Choose icon…", fn: function () { showIconPicker(id, x, y); } });
    items.push({ label: "Tags…", fn: function () { showTagPicker(id, x, y); } });
    var partCount = detailsOf(person).length;
    if (partCount) items.push({
      label: (state.expanded[String(id)] ? "Collapse details" : "Expand details") + " (" + partCount + ")",
      fn: function () { toggleExpanded(id); }
    });
    if (!mine) items.push({ label: "How do I know them?", fn: function () { showPathTo(id); } });
    items.push({ label: "Suggested relationships…", fn: openSuggestions });
    /* You sit at the centre by definition, so the ring and pin controls — and
     * deletion — are not yours. The chart controls take their place. */
    if (mine) {
      items.push("-");
      items.push({ label: "Add person here…", fn: function () { addPersonAt(null); } });
      items.push({ label: "Fit chart to view", fn: function () { if (state.network) state.network.fit({ animation: true }); } });
      items.push({ label: "Layout: " + layoutMeta(state.layout).label + " ▸", fn: function () { showLayoutPicker(x, y); } });
      items.push({ label: "Chart background…", fn: function () { showThemePicker(x, y); } });
    } else {
      items.push("-");
      var currentRing = String(D.attrs(person).ring || "");
      RING_META.forEach(function (ring) {
        items.push({ label: (currentRing === ring.key ? "✓ " : "") + "Pin to " + RING_LABELS[ring.key].toLowerCase(), fn: function () { setRing(id, ring.key); } });
      });
      if (currentRing) items.push({ label: "Unpin from ring", fn: function () { clearRing(id); } });
      items.push({ label: pinned ? "Unpin position" : "Pin position", fn: function () { togglePin(id); } });
      items.push("-");
      items.push({ label: "Delete contact", danger: true, fn: function () { removeContact(id); } });
    }
    /* With exactly two people selected, offer the merge in both directions so
     * which profile survives is never a guess. */
    var picked = Object.keys(state.selectedIds);
    /* Anything you can do to one person, you should be able to do to the set. */
    if (picked.length > 1 && picked.indexOf(String(id)) !== -1) {
      items = [
        { label: "Tag these " + picked.length + " people…", fn: function () { showBulkTagPicker(picked, x, y); } },
        "-"
      ].concat(items);
    }
    if (picked.length === 2 && picked.indexOf(String(id)) !== -1) {
      var other = picked[0] === String(id) ? picked[1] : picked[0];
      items = [
        { label: "Merge " + personLabel(other) + " into " + personLabel(id), fn: function () { mergeContacts(id, other); } },
        { label: "Merge " + personLabel(id) + " into " + personLabel(other), fn: function () { mergeContacts(other, id); } },
        "-"
      ].concat(items);
    }
    showCtxMenu(x, y, items);
  }
  function edgeCtxMenu(linkId, x, y) {
    var link = linkById(linkId);
    if (!link) return;
    var removable = link.source === "manual" || (link.attrs && link.attrs.sourceRef === "manual-relationship");
    var attrs = D.attrs(link), current = String(attrs.relationshipType || ""), pointsTo = String(attrs.pointsTo || "");
    var from = normaliseId(link.from), to = normaliseId(link.to);
    var items = [{ label: "Show relationship", fn: function () { selectEdge(linkId); } }];
    /* Describing a relationship is not the same as owning it: an imported link
     * can be labelled and pointed even though only a manual one can be deleted. */
    items.push("-");
    RELATIONSHIP_TYPES.forEach(function (type) {
      items.push({ label: (current === type ? "✓ " : "") + type, fn: function () { setRelationshipType(linkId, type); } });
    });
    items.push({ label: current ? "Edit label…" : "Custom label…", fn: function () {
      var v = window.prompt("How do they know each other?", current);
      if (v != null) setRelationshipType(linkId, String(v).trim());
    } });
    if (current) items.push({ label: "Clear label", fn: function () { clearRelationshipType(linkId); } });
    items.push("-");
    items.push({ label: (pointsTo === to ? "✓ " : "") + "Point at " + personLabel(to), fn: function () { setLinkArrow(linkId, to); } });
    items.push({ label: (pointsTo === from ? "✓ " : "") + "Point at " + personLabel(from), fn: function () { setLinkArrow(linkId, from); } });
    if (pointsTo) items.push({ label: "No direction", fn: function () { setLinkArrow(linkId, ""); } });
    if (removable) {
      items.push("-");
      items.push({ label: "Delete relationship", danger: true, fn: function () { removeRelationship(link.from, link.to); clearEdgeSelection(); } });
    }
    showCtxMenu(x, y, items);
  }
  function bgCtxMenu(x, y, canvasPos) {
    showCtxMenu(x, y, [
      { label: "Add person here…", fn: function () { addPersonAt(canvasPos); } },
      { label: "Fit chart to view", fn: function () { if (state.network) state.network.fit({ animation: true }); } },
      "-",
      { label: "Layout: " + layoutMeta(state.layout).label + " ▸", fn: function () { showLayoutPicker(x, y); } },
      { label: "Chart background…", fn: function () { showThemePicker(x, y); } }
    ]);
  }
  function startLinkFrom(id) {
    state.linkFrom = String(id);
    var hint = $("#connect-hint"); if (hint) { hint.textContent = "Click another person to connect them to " + personLabel(id) + " · Esc to cancel"; hint.hidden = false; }
    updateLinkGhost();
  }
  function endLinkFrom() { state.linkFrom = null; var hint = $("#connect-hint"); if (hint) hint.hidden = true; hideLinkGhost(); }
  /* A line that follows the cursor from the link source, so linking feels direct
   * rather than a menu hunt. */
  function linkGhostEl() { return $("#link-ghost"); }
  function hideLinkGhost() { var g = linkGhostEl(); if (g) g.style.display = "none"; }
  function updateLinkGhost() {
    var g = linkGhostEl(); if (!g || !state.network || !state.linkFrom) { hideLinkGhost(); return; }
    var stage = $(".network-stage"); if (!stage) return;
    var stageRect = stage.getBoundingClientRect();
    var netRect = $("#network").getBoundingClientRect();
    var pos;
    try { pos = state.network.canvasToDOM(state.network.getPositions([state.linkFrom])[state.linkFrom]); } catch (e) { return; }
    if (!pos) return;
    var x1 = (netRect.left - stageRect.left) + pos.x, y1 = (netRect.top - stageRect.top) + pos.y;
    var x2 = state._cursor ? state._cursor.x : x1, y2 = state._cursor ? state._cursor.y : y1;
    var line = g.querySelector("line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1); line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    var dot = g.querySelector("circle"); dot.setAttribute("cx", x1); dot.setAttribute("cy", y1);
    g.style.display = "block";
  }
  function togglePin(id) {
    var key = String(id);
    if (state.pinned[key]) { delete state.pinned[key]; } else {
      if (state.network) { try { var p = state.network.getPositions([key])[key]; if (p) state.positions[key] = p; } catch (e) {} }
      state.pinned[key] = true;
    }
    renderGraph(state.snapshot);
  }
  function addPersonAt(canvasPos) { state.pendingPlace = canvasPos || null; openModal(); }
  function setRing(id, key) {
    var person = personById(id); if (!person || !state.store) return;
    pushUndo();
    delete state.positions[String(id)];
    state.store.merge({ entities: [{ id: id, type: "person", label: person.label, attrs: { ring: String(key || "") } }], links: [] });
    setText("#sync-status", "PINNED TO " + String(RING_LABELS[key] || key).toUpperCase());
  }
  function clearRing(id) {
    var person = personById(id); if (!person || !person.attrs) return;
    pushUndo();
    delete person.attrs.ring;
    state.store.merge({ entities: [], links: [] });
    render();
    setText("#sync-status", "UNPINNED FROM RING");
  }
  /* Face photos on nodes — SOLAR's circularImage model, kept local + small. */
  function downscaleImage(dataUrl, max) {
    return new Promise(function (resolve) {
      var img = new Image();
      var remote = !/^data:/i.test(String(dataUrl || ""));
      /* Anything not already inline needs permission to be read back out of the
       * canvas; without it the browser taints the canvas and we keep nothing. */
      if (remote) img.crossOrigin = "anonymous";
      img.onload = function () {
        /* An image that loaded with no pixels — a broken or expired address —
         * is nothing. Substituting a default size here used to manufacture a
         * blank picture and hand it to the chart. */
        var natW = img.naturalWidth || img.width || 0, natH = img.naturalHeight || img.height || 0;
        if (!natW || !natH) { resolve(remote ? "" : dataUrl); return; }
        var scale = Math.min(1, max / Math.max(natW, natH));
        var w = Math.max(1, Math.round(natW * scale)), h = Math.max(1, Math.round(natH * scale));
        try {
          var canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        } catch (e) { resolve(remote ? "" : dataUrl); }
      };
      img.onerror = function () { resolve(remote ? "" : dataUrl); };
      img.src = dataUrl;
    });
  }
  function setPhoto(id) {
    var person = personById(id); if (!person) return;
    var input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.addEventListener("change", function () {
      var file = input.files && input.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        downscaleImage(String(reader.result || ""), 220).then(function (photo) {
          if (!photo) return;
          pushUndo();
          state.store.merge({ entities: [{ id: id, type: "person", label: person.label, attrs: { photo: photo } }], links: [] });
          setText("#sync-status", "PHOTO ADDED");
        });
      };
      reader.readAsDataURL(file);
    });
    input.click();
  }
  function removePhoto(id) {
    var person = personById(id); if (!person || !person.attrs) return;
    pushUndo();
    delete person.attrs.photo;
    state.store.merge({ entities: [], links: [] });
    render();
    setText("#sync-status", "PHOTO REMOVED");
  }
  /* ---- Recycle bin: delete is frictionless (no prompt) but reversible. A
   * deleted person + their notes, links and pinned position are captured to a
   * local bin so they can be restored or purged. ---- */
  var TRASH_KEY = "orbit_trash_v1";
  function trashRead() { try { var v = JSON.parse(window.localStorage.getItem(TRASH_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function trashWrite(list) { try { window.localStorage.setItem(TRASH_KEY, JSON.stringify(list)); } catch (e) {} }
  function contribsOf(entity) { return entity.contribs || (entity.contrib ? [entity.contrib] : []); }
  function captureForTrash(id) {
    id = String(id);
    var snap = state.snapshot; if (!snap) return null;
    var entity = snap.entities.find(function (e) { return String(e.id) === id; });
    if (!entity) return null;
    var owned = snap.entities.filter(function (e) { return String(e.id) !== id && contribsOf(e).indexOf("ent:" + id) !== -1; });
    var removed = Object.create(null); removed[id] = true; owned.forEach(function (e) { removed[String(e.id)] = true; });
    var links = snap.links.filter(function (l) { return removed[normaliseId(l.from)] || removed[normaliseId(l.to)]; });
    return { tid: id + "|" + Date.now(), id: id, label: entity.label || "Unnamed", deletedAt: new Date().toISOString(), entities: [entity].concat(owned), links: links, pinned: !!state.pinned[id], position: state.positions[id] || null, ringAngle: state.ringAngle[id] != null ? state.ringAngle[id] : null };
  }
  function trashCount() { return trashRead().length; }
  function updateTrashButton() {
    var n = trashCount(), btn = $('[data-action="recycle-bin"]'), badge = $("#recycle-count");
    if (badge) { badge.textContent = n ? String(n) : ""; badge.hidden = !n; }
    if (btn) btn.setAttribute("title", n ? "Recycle bin (" + n + ")" : "Recycle bin (empty)");
  }
  /* ---- Merging two contacts into one profile ----
   * Everything unique on the absorbed record is carried over: a second email or
   * number joins the survivor's field as another chip, notes and interests are
   * appended, and their relationships, facts and interactions are re-parented.
   * The absorbed record goes to the recycle bin as a bare profile — undo is the
   * clean reversal, and it reverses the whole merge in one step. */
  var MERGE_MULTI = ["email", "phone", "phoneOther", "whatsapp", "signal", "instagram", "facebook", "x", "tiktok", "website"];
  var MERGE_APPEND = ["note", "interests"];
  var MERGE_ADDRESS = { address: "Home", workAddress: "Work" };
  function splitValues(value) {
    return String(value == null ? "" : value).split(/[;,]/).map(function (v) { return v.trim(); }).filter(Boolean);
  }
  function joinUnique(mine, theirs) {
    var seen = Object.create(null), out = [];
    splitValues(mine).concat(splitValues(theirs)).forEach(function (v) {
      var k = v.toLowerCase(); if (seen[k]) return; seen[k] = true; out.push(v);
    });
    return out.join(", ");
  }
  function sameText(a, b) { return String(a == null ? "" : a).trim().toLowerCase() === String(b == null ? "" : b).trim().toLowerCase(); }
  function appendText(mine, theirs) {
    var a = String(mine == null ? "" : mine).trim(), b = String(theirs == null ? "" : theirs).trim();
    if (!b || a.toLowerCase().indexOf(b.toLowerCase()) !== -1) return a;
    return a ? a + " · " + b : b;
  }
  /* Only the differences are returned, so the survivor's own values stand and
   * the store's merge writes nothing it does not need to. */
  function mergeAttrs(survivor, absorbed) {
    var sa = D.attrs(survivor), aa = D.attrs(absorbed), out = {}, extraAddresses = [];
    Object.keys(aa).forEach(function (key) {
      var mine = sa[key], theirs = aa[key];
      if (theirs == null || theirs === "" || (Array.isArray(theirs) && !theirs.length)) return;
      if (MERGE_MULTI.indexOf(key) !== -1) {
        var joined = joinUnique(mine, theirs);
        if (joined && joined !== String(mine == null ? "" : mine)) out[key] = joined;
        return;
      }
      if (MERGE_APPEND.indexOf(key) !== -1) {
        var appended = appendText(mine, theirs);
        if (appended && appended !== String(mine == null ? "" : mine)) out[key] = appended;
        return;
      }
      if (MERGE_ADDRESS[key]) {
        if (!String(mine == null ? "" : mine).trim()) out[key] = theirs;
        else if (!sameText(mine, theirs)) extraAddresses.push({ label: MERGE_ADDRESS[key], value: String(theirs) });
        return;
      }
      if (Array.isArray(theirs)) {
        var union = (Array.isArray(mine) ? mine : []).slice();
        theirs.forEach(function (item) {
          var json = JSON.stringify(item);
          if (!union.some(function (x) { return JSON.stringify(x) === json; })) union.push(item);
        });
        if (union.length) out[key] = union;
        return;
      }
      if (mine == null || mine === "") out[key] = theirs;
    });
    if (extraAddresses.length) {
      var base = out.addresses || (Array.isArray(sa.addresses) ? sa.addresses.slice() : []);
      out.addresses = base.concat(extraAddresses);
    }
    /* A different name on the absorbed record is an alias worth keeping. */
    var alias = String(absorbed.label || "").trim();
    if (alias && !sameText(alias, survivor.label)) {
      var note = appendText(out.note != null ? out.note : sa.note, "Also known as " + alias);
      if (note) out.note = note;
    }
    return out;
  }
  function mergeContacts(survivorId, absorbedId) {
    if (!state.store || !state.snapshot) return;
    survivorId = String(survivorId); absorbedId = String(absorbedId);
    if (survivorId === absorbedId) return;
    if (isMe(absorbedId)) { setText("#sync-status", "YOUR OWN RECORD CANNOT BE MERGED AWAY"); return; }
    var survivor = personById(survivorId), absorbed = personById(absorbedId);
    if (!survivor || !absorbed) return;
    var absorbedName = String(absorbed.label || "this contact");
    pushUndo();
    /* Their relationships become the survivor's. A link between the two
     * themselves has nowhere left to point. */
    var links = [];
    state.snapshot.links.forEach(function (l) {
      var from = normaliseId(l.from), to = normaliseId(l.to);
      if (from !== absorbedId && to !== absorbedId) return;
      var newFrom = from === absorbedId ? survivorId : from, newTo = to === absorbedId ? survivorId : to;
      if (newFrom === newTo) return;
      var type = l.type || "KNOWS";
      var contrib = Array.isArray(l.contribs) ? l.contribs[0] : l.contrib;
      if (String(type).toUpperCase() === "KNOWS") {
        var k = relationshipKey(newFrom, newTo); newFrom = k[0]; newTo = k[1];
        contrib = relationshipContrib(newFrom, newTo);   /* so it stays removable */
      } else if (contrib === "ent:" + absorbedId) { contrib = "ent:" + survivorId; }
      links.push({ id: state.store.linkId({ from: newFrom, to: newTo, type: type }), from: newFrom, to: newTo, type: type, label: l.label, source: l.source, createdBy: l.createdBy || "personal-network", contrib: contrib, attrs: Object.assign({}, l.attrs || {}) });
    });
    /* Facts and interactions filed under the absorbed record are re-parented, so
     * they stay with the survivor instead of being swept away with it. */
    var moved = 0;
    state.snapshot.entities.forEach(function (e) {
      if (String(e.id) === absorbedId) return;
      var list = e.contribs || (e.contrib ? [e.contrib] : []);
      var at = list.indexOf("ent:" + absorbedId);
      if (at === -1) return;
      list[at] = "ent:" + survivorId;
      e.contribs = list.filter(function (c, i) { return list.indexOf(c) === i; });
      if (e.contrib === "ent:" + absorbedId) e.contrib = "ent:" + survivorId;
      moved++;
    });
    var attrs = mergeAttrs(survivor, absorbed), gained = Object.keys(attrs).length;
    var part = { entities: [], links: links };
    if (gained) part.entities.push({ id: survivorId, type: "person", label: survivor.label, attrs: attrs });
    state.store.merge(part);
    /* Bin the absorbed record without its links — they belong to the survivor
     * now, and undo is what puts a merge back the way it was. */
    var record = captureForTrash(absorbedId);
    if (record) { record.links = []; var bin = trashRead(); bin.unshift(record); trashWrite(bin); }
    delete state.pinned[absorbedId]; delete state.positions[absorbedId]; delete state.ringAngle[absorbedId];
    if (state.store.removeEntity) state.store.removeEntity(absorbedId);
    else if (state.store.withdraw) state.store.withdraw("ent:" + absorbedId);
    state.selectedIds = {};
    state.selectedId = survivorId; state.cycleAnchor = survivorId; state.cycleIndex = -1;
    render();
    openDossier(survivorId);
    updateTrashButton();
    if (isMe(survivorId)) syncMeToAccount();
    setText("#sync-status", "MERGED " + absorbedName.toUpperCase() + " INTO " + String(survivor.label || "").toUpperCase() +
      (gained ? " · " + gained + " DETAIL" + (gained === 1 ? "" : "S") + " ADDED" : "") +
      (moved ? " · " + moved + " RECORD" + (moved === 1 ? "" : "S") + " MOVED" : ""));
  }
  /* Where the ←/→ walk lands once these people are gone — the next person after
   * the last of them, wrapping. "" when the network would be left with nobody. */
  function nextPersonAfter(ids) {
    var all = allPeopleIds(), going = Object.create(null), last = -1;
    (Array.isArray(ids) ? ids : [ids]).forEach(function (i) { going[String(i)] = true; });
    all.forEach(function (person, index) { if (going[person]) last = index; });
    for (var step = 1; step <= all.length; step++) {
      var candidate = all[((last < 0 ? 0 : last) + step) % all.length];
      if (!going[candidate]) return candidate;
    }
    return "";
  }
  function removeContact(id) {
    if (!state.store) return;
    id = String(id);
    if (isMe(id)) { setText("#sync-status", "YOUR OWN RECORD CANNOT BE DELETED"); return; }
    var record = captureForTrash(id);
    /* Deleting the profile you are reading moves on to the next contact rather
     * than dropping you back to an empty panel. */
    var successor = id === state.selectedId ? nextPersonAfter([id]) : "";
    pushUndo();
    if (successor) { state.selectedId = successor; state.cycleAnchor = successor; state.cycleIndex = -1; }
    else if (id === state.selectedId) closeDossier();
    delete state.pinned[id]; delete state.positions[id]; delete state.ringAngle[id];
    if (state.store.removeEntity) state.store.removeEntity(id);
    else if (state.store.withdraw) state.store.withdraw("ent:" + id);
    if (record) { var list = trashRead(); list.unshift(record); trashWrite(list); }
    render();
    if (successor) openDossier(successor);
    updateTrashButton();
    setText("#sync-status", record ? "MOVED TO RECYCLE BIN" : "CONTACT DELETED");
  }
  function trashRestore(tid) {
    var list = trashRead(), idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].tid === tid) { idx = i; break; }
    if (idx === -1 || !state.store) return;
    var record = list[idx];
    pushUndo();
    state.store.merge({ entities: record.entities, links: record.links });
    if (record.pinned) state.pinned[record.id] = true;
    if (record.position) state.positions[record.id] = record.position;
    if (record.ringAngle != null) state.ringAngle[record.id] = record.ringAngle;
    list.splice(idx, 1); trashWrite(list);
    render(); updateTrashButton(); renderTrashModal();
    setText("#sync-status", "RESTORED · " + String(record.label).toUpperCase());
  }
  function trashPurge(tid) { trashWrite(trashRead().filter(function (r) { return r.tid !== tid; })); updateTrashButton(); renderTrashModal(); setText("#sync-status", "REMOVED FROM RECYCLE BIN"); }
  function trashClear() { trashWrite([]); updateTrashButton(); renderTrashModal(); setText("#sync-status", "RECYCLE BIN EMPTIED"); }
  function renderTrashModal() {
    var listEl = $("#recycle-list"), emptyEl = $("#recycle-empty"), clearBtn = $('[data-action="empty-bin"]');
    if (!listEl) return;
    var list = trashRead();
    if (emptyEl) emptyEl.hidden = list.length > 0;
    if (clearBtn) clearBtn.disabled = !list.length;
    listEl.innerHTML = list.map(function (r) {
      var meta = [formatDate(r.deletedAt), (r.links.length ? r.links.length + " link" + (r.links.length === 1 ? "" : "s") : "no links")].filter(Boolean).join(" · ");
      return '<div class="recycle-row"><span class="recycle-row-copy"><strong>' + esc(r.label) + '</strong><span>' + esc(meta) + '</span></span>' +
        '<span class="recycle-row-actions"><button type="button" class="toolbar-button" data-restore="' + esc(r.tid) + '">Restore</button>' +
        '<button type="button" class="toolbar-button danger" data-purge="' + esc(r.tid) + '">Delete forever</button></span></div>';
    }).join("");
  }
  function openRecycleBin() { renderTrashModal(); var m = $("#recycle-modal"); if (m) { m.hidden = false; var c = m.querySelector("[data-action=close-recycle]"); if (c) c.focus(); } }
  function closeRecycleBin() { var m = $("#recycle-modal"); if (m) m.hidden = true; }
  function setFormValue(form, name, value) { if (form.elements[name]) form.elements[name].value = value == null ? "" : value; }
  function socialProfilesText(value) { return (Array.isArray(value) ? value : []).map(function (item) { return typeof item === "string" ? item : (item.platform ? item.platform + ": " : "") + (item.value || item.handle || item.url || ""); }).join("\n"); }
  function openModal(id) {
    var form = $("#person-form"), person = id && state.snapshot ? state.snapshot.entities.filter(function (entity) { return String(entity.id) === String(id) && D.isPerson(entity); })[0] : null, a = person ? D.attrs(person) : {};
    state.editingId = person ? String(person.id) : "";
    form.reset();
    setText("#person-modal-title", person ? "Edit contact profile" : "Add person");
    setText("#person-submit-label", person ? "Save changes" : "Add to network");
    if (person) {
      ["name", "preferredName", "role", "organisation", "location", "email", "phone", "phoneOther", "whatsapp", "signal", "instagram", "facebook", "website", "x", "address", "workAddress", "birthday", "interests", "relationship", "note"].forEach(function (key) { setFormValue(form, key, key === "name" ? person.label : a[key]); });
      setFormValue(form, "tags", T ? T.format(a.tags) : "");
      setFormValue(form, "socialProfiles", socialProfilesText(a.socialProfiles));
      setFormValue(form, "strength", a.strength == null ? 50 : a.strength);
    } else {
      setFormValue(form, "strength", 50);
    }
    setText("#strength-value", form.elements.strength ? form.elements.strength.value : "50");
    $("#person-modal").hidden = false;
    form.elements.name.focus();
  }
  function closeModal() { $("#person-modal").hidden = true; $("#person-form").reset(); state.editingId = ""; state.pendingPlace = null; setText("#person-modal-title", "Add person"); setText("#person-submit-label", "Add to network"); setText("#strength-value", "50"); }
  function openVault() { $("#vault-modal").hidden = false; $("#vault-status").textContent = "Ready. Imports merge into this local workspace."; $("#vault-modal").querySelector("[data-action=close-vault]").focus(); }
  function closeVault() { $("#vault-modal").hidden = true; }
  function setVaultStatus(message) { setText("#vault-status", message); }
  function readFileText(file) {
    if (!file) return Promise.reject(new Error("No file was selected."));
    if (typeof file.text === "function") return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("The selected file could not be read.")); };
      reader.readAsText(file);
    });
  }
  /* ---- Every shortcut in one place ----
   * Read straight off the handlers below, so the card cannot drift from the
   * behaviour. Half of this app is gestures; nothing announced them until now. */
  var SHORTCUTS = [
    { group: "Asking a question", rows: [
      { keys: ["tag:"], what: "Narrow the search to a tag — also org:, domain:, is:, has:, in:" },
      { keys: ["has:phone"], what: "Only people you actually hold a number for" },
      { keys: ["-tag:work"], what: "A minus excludes; several terms narrow together" },
      { keys: ['in:"…"'], what: "Quote a phrase to keep it whole" }
    ] },
    { group: "Getting around", rows: [
      { keys: ["←", "→"], what: "Step to the previous or next contact, wrapping" },
      { keys: ["Esc"], what: "Back out: picker, menu, selection, tag filter, path, panel" },
      { keys: ["?"], what: "Open this card" },
      { keys: ["Right-drag"], what: "Pan the chart" },
      { keys: ["Scroll"], what: "Zoom in and out" }
    ] },
    { group: "Selecting", rows: [
      { keys: ["Click"], what: "Open a person's profile" },
      { keys: ["Ctrl", "Click"], what: "Add a person to the selection" },
      { keys: ["Left-drag"], what: "Box-select everyone inside the box" },
      { keys: ["Right-click"], what: "The full menu for a person, a link or the chart" },
      { keys: ["Long-press"], what: "The same menu on a touchscreen" }
    ] },
    { group: "Building the network", rows: [
      { keys: ["Shift", "Click"], what: "Start a link from a person, then click who they know" },
      { keys: ["Drag"], what: "Move a person; drop them on a ring to pin them there" },
      { keys: ["Del"], what: "Delete the selected person, link, or whole selection" },
      { keys: ["Ctrl", "Z"], what: "Undo" },
      { keys: ["Ctrl", "Y"], what: "Redo" }
    ] },
    { group: "With several selected", rows: [
      { keys: ["Tags…"], what: "Tag everyone in the selection at once" },
      { keys: ["Right-click"], what: "With exactly two: merge them into one profile, either direction" }
    ] }
  ];
  function renderShortcuts() {
    var body = $("#shortcuts-body"); if (!body) return;
    body.innerHTML = SHORTCUTS.map(function (section) {
      return '<div class="shortcut-group"><h3>' + esc(section.group) + '</h3>' + section.rows.map(function (row) {
        return '<div class="shortcut-row"><span>' + esc(row.what) + '</span><span class="shortcut-keys">' +
          row.keys.map(function (k) { return "<kbd>" + esc(k) + "</kbd>"; }).join("") + '</span></div>';
      }).join("") + '</div>';
    }).join("");
  }
  function openShortcuts() { renderShortcuts(); var m = $("#shortcuts-modal"); if (m) { m.hidden = false; var c = m.querySelector("[data-action=close-shortcuts]"); if (c) c.focus(); } }
  function closeShortcuts() { var m = $("#shortcuts-modal"); if (m) m.hidden = true; }

  /* ================== 2. Tagging a whole selection at once ================= */
  /* Tagging thirty people one right-click at a time is not tagging. If any of
   * them lack the tag they all gain it; if they all have it, they all lose it. */
  function bulkTag(ids, tag) {
    if (!state.store || !T) return;
    var clean = T.clean(tag); if (!clean) return;
    var people = ids.map(personById).filter(Boolean);
    if (!people.length) return;
    var adding = people.some(function (person) { return !T.has(tagsOf(person), clean); });
    pushUndo();
    var part = { entities: [], links: [] };
    people.forEach(function (person) {
      var next = adding ? T.add(tagsOf(person), clean) : T.remove(tagsOf(person), clean);
      if (next.length) part.entities.push({ id: String(person.id), type: "person", label: person.label, attrs: { tags: next } });
      else if (person.attrs) delete person.attrs.tags;
    });
    state.store.merge(part);
    render();
    setText("#sync-status", (adding ? "TAGGED " : "UNTAGGED ") + people.length + " · " + clean.toUpperCase());
  }
  function showBulkTagPicker(ids, x, y) {
    closeCtxMenu(); closeIconPicker();
    if (!T) return;
    var census = tagCensus();
    setTimeout(function () {
      var pop = document.createElement("div");
      pop.className = "ctx-menu tag-picker";
      pop.setAttribute("role", "menu");
      census.forEach(function (entry) {
        var row = document.createElement("div");
        row.className = "ctx-item tag-row";
        row.setAttribute("role", "menuitem"); row.tabIndex = 0;
        row.innerHTML = '<i class="tag-dot" style="--tag-colour:' + esc(entry.colour) + '"></i><span>' + esc(entry.tag) + '</span>';
        function go() { closeIconPicker(); bulkTag(ids, entry.tag); }
        row.addEventListener("click", go);
        row.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } });
        pop.appendChild(row);
      });
      if (census.length) { var sep = document.createElement("div"); sep.className = "ctx-sep"; pop.appendChild(sep); }
      var add = document.createElement("div");
      add.className = "ctx-item"; add.textContent = "New tag…"; add.setAttribute("role", "menuitem"); add.tabIndex = 0;
      function invent() {
        closeIconPicker();
        var value = window.prompt("Tag these " + ids.length + " people", "");
        if (value != null) T.parse(value).forEach(function (tag) { bulkTag(ids, tag); });
      }
      add.addEventListener("click", invent);
      add.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); invent(); } });
      pop.appendChild(add);
      document.body.appendChild(pop); iconPickerEl = pop;
      var mw = pop.offsetWidth, mh = pop.offsetHeight;
      pop.style.left = Math.min(x, window.innerWidth - mw - 8) + "px";
      pop.style.top = Math.min(y, window.innerHeight - mh - 8) + "px";
      var first = pop.querySelector(".ctx-item"); if (first) first.focus();
    }, 0);
  }

  /* ===================== 3. Sweeping for duplicates ======================= */
  /* The same scorer the import review uses, turned on the vault itself. A pair
   * you say is not a duplicate stays dismissed. */
  var DUPES_KEY = "orbit_not_duplicates_v1";
  function dismissedPairs() { try { var v = JSON.parse(window.localStorage.getItem(DUPES_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function pairKey(a, b) { return [String(a), String(b)].sort().join("||"); }
  function dismissPair(a, b) { var list = dismissedPairs(); list.push(pairKey(a, b)); try { window.localStorage.setItem(DUPES_KEY, JSON.stringify(list)); } catch (e) {} }
  function restoreDismissed() { try { window.localStorage.removeItem(DUPES_KEY); } catch (e) {} renderDupes(); }
  function duplicateCandidates() {
    var M = window.OrbitContactMatching;
    if (!M || !M.duplicatePairs || !state.snapshot) return [];
    var people = state.snapshot.entities.filter(function (e) { return D.isPerson(e) && !isMe(e.id); });
    var dismissed = dismissedPairs();
    return M.duplicatePairs(people).filter(function (pair) { return dismissed.indexOf(pairKey(pair.a.id, pair.b.id)) === -1; });
  }
  function renderDupes() {
    var list = $("#dupes-list"), summary = $("#dupes-summary");
    if (!list) return;
    var pairs = duplicateCandidates();
    if (summary) setText("#dupes-summary", pairs.length
      ? formatCount(pairs.length) + " pair" + (pairs.length === 1 ? "" : "s") + " look like one person twice. Merging keeps every unique detail from both."
      : "Nothing looks like a duplicate. Contacts are matched on email, phone, source record and name.");
    list.innerHTML = pairs.map(function (pair) {
      return '<div class="dupe-row" data-pair="' + esc(pairKey(pair.a.id, pair.b.id)) + '">' +
        '<div class="dupe-pair"><strong>' + esc(pair.a.label || "Unnamed") + '</strong><em>and</em><strong>' + esc(pair.b.label || "Unnamed") + '</strong></div>' +
        '<div class="dupe-why">' + esc(pair.reason) + '</div>' +
        '<div class="dupe-actions">' +
        '<button type="button" class="toolbar-button" data-merge-into="' + esc(pair.a.id) + '" data-merge-from="' + esc(pair.b.id) + '">Keep ' + esc(pair.a.label || "the first") + '</button>' +
        '<button type="button" class="toolbar-button" data-merge-into="' + esc(pair.b.id) + '" data-merge-from="' + esc(pair.a.id) + '">Keep ' + esc(pair.b.label || "the second") + '</button>' +
        '<button type="button" class="toolbar-button" data-not-a="' + esc(pair.a.id) + '" data-not-b="' + esc(pair.b.id) + '">Not a duplicate</button>' +
        '</div></div>';
    }).join("") || '<div class="dupes-empty">Nothing to review.</div>';
  }
  function openDupes() { renderDupes(); var m = $("#dupes-modal"); if (m) { m.hidden = false; var c = m.querySelector("[data-action=close-dupes]"); if (c) c.focus(); } }
  function closeDupes() { var m = $("#dupes-modal"); if (m) m.hidden = true; }

  /* ================ 4. How do I know them? (the chain) ==================== */
  function showPathTo(id) {
    if (!state.snapshot) return;
    var chain = D.shortestPath(state.snapshot.links.map(function (l) { return { from: normaliseId(l.from), to: normaliseId(l.to) }; }), D.ME_ID, String(id));
    var strip = $("#path-strip");
    if (!chain || chain.length < 2) {
      state.path = null;
      if (strip) strip.hidden = true;
      render();
      setText("#sync-status", "NO CHAIN OF RELATIONSHIPS REACHES " + personLabel(id).toUpperCase());
      return;
    }
    /* Only people belong in a chain the user is asked to read. */
    var names = chain.map(function (nodeId) { return isMe(nodeId) ? "You" : personLabel(nodeId); });
    state.path = { ids: chain, set: chain.reduce(function (map, nodeId) { map[nodeId] = true; return map; }, Object.create(null)) };
    if (strip) {
      strip.hidden = false;
      $("#path-strip-chain").innerHTML = names.map(function (name) { return esc(name); }).join('<i>\u2192</i>');
    }
    render();
    var between = chain.length - 2;
    setText("#sync-status", between === 0 ? "DIRECT CONNECTION" : between + (between === 1 ? " PERSON" : " PEOPLE") + " BETWEEN YOU");
  }
  function clearPath() {
    if (!state.path) return;
    state.path = null;
    var strip = $("#path-strip"); if (strip) strip.hidden = true;
    render();
  }

  /* ================== 5. Who is going cold ============================== */
  /* A relationship at each ring has an allowance before it is worth a nudge
   * (domain.js owns the numbers). This lists who is past theirs, worst first. */
  function coldList() {
    if (!state.snapshot) return [];
    var last = D.lastInteractionByPerson(state.snapshot.entities, state.snapshot.links);
    var now = Date.now();
    return state.snapshot.entities.filter(function (e) { return D.isPerson(e) && !isMe(e.id); }).map(function (person) {
      var summary = D.personSummary(person, state.snapshot.links);
      var ring = String(D.attrs(person).ring || summary.ring);
      /* A mailbox import records a last-email date even where it kept no
       * message; a relationship with a known last contact is not "never". */
      var known = last[String(person.id)];
      if (known == null) { var stamped = Date.parse(String(D.attrs(person).emailLastAt || "")); if (!isNaN(stamped)) known = stamped; }
      var debt = D.contactDebt(ring, known == null ? null : known, now);
      return { id: String(person.id), label: person.label || "Unnamed", ring: ring, debt: debt };
    }).filter(function (row) { return row.debt.days > 0; })
      .sort(function (a, b) { return b.debt.days - a.debt.days || a.label.localeCompare(b.label); });
  }
  function coldSet() {
    var map = Object.create(null);
    if (state.coldMode) coldList().forEach(function (row) { map[row.id] = row; });
    return map;
  }
  function toggleColdMode() {
    state.coldMode = !state.coldMode;
    var button = $('[data-action="going-cold"]');
    if (button) button.setAttribute("aria-pressed", String(state.coldMode));
    render();
    if (!state.coldMode) { setText("#network-mode", state.opportunityMode ? "OPPORTUNITY VIEW" : "ORBIT VIEW"); setText("#sync-status", "READY"); return; }
    var rows = coldList();
    setText("#network-mode", "GOING COLD");
    setText("#sync-status", rows.length
      ? formatCount(rows.length) + " OVERDUE · LONGEST " + rows[0].label.toUpperCase() + " (" + rows[0].debt.days + "D PAST DUE)"
      : "NOBODY IS OVERDUE");
  }
  /* ================= Suggested relationships ==========================
   * The evidence often implies a relationship nobody has drawn. Nothing is
   * created here without being accepted, and a pair you reject stays rejected. */
  var SUGGEST_KEY = "orbit_rejected_links_v1";
  function rejectedLinks() { try { var v = JSON.parse(window.localStorage.getItem(SUGGEST_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function rejectLink(a, b) { var list = rejectedLinks(); list.push(pairKey(a, b)); try { window.localStorage.setItem(SUGGEST_KEY, JSON.stringify(list)); } catch (e) {} }
  function restoreRejected() { try { window.localStorage.removeItem(SUGGEST_KEY); } catch (e) {} renderSuggestions(); }
  /* People named on the same message or meeting, from the links already drawn. */
  function eventMembers() {
    var out = Object.create(null);
    if (!state.snapshot) return out;
    var interactions = Object.create(null);
    state.snapshot.entities.forEach(function (entity) { if (D.isInteraction(entity)) interactions[String(entity.id)] = true; });
    state.snapshot.links.forEach(function (link) {
      var from = normaliseId(link.from), to = normaliseId(link.to);
      var event = interactions[from] ? from : (interactions[to] ? to : "");
      if (!event) return;
      var person = event === from ? to : from;
      if (isMe(person) || !personById(person)) return;
      (out[event] = out[event] || []).push(person);
    });
    return out;
  }
  function linkSuggestions() {
    if (!GR || !state.snapshot) return [];
    var rejected = rejectedLinks();
    var people = peopleForShape().map(function (person) {
      return { id: String(person.id), organisation: String(D.attrs(person).organisation || ""), selectors: selectorsOf(person) };
    });
    return GR.suggestLinks({
      centre: D.ME_ID, people: people, links: state.snapshot.links.map(function (l) { return { from: normaliseId(l.from), to: normaliseId(l.to) }; }),
      eventMembers: eventMembers()
    }).filter(function (row) { return rejected.indexOf(pairKey(row.a, row.b)) === -1; })
      .filter(function (row) { return personById(row.a) && personById(row.b); });
  }
  function renderSuggestions() {
    var list = $("#suggest-list"); if (!list) return;
    var rows = linkSuggestions();
    setText("#suggest-summary", rows.length
      ? formatCount(rows.length) + " relationship" + (rows.length === 1 ? "" : "s") + " the evidence already implies. Nothing is drawn until you say so."
      : "Nothing to suggest. Orbit looks for shared identifiers, shared organisations, and people named on the same message.");
    list.innerHTML = rows.slice(0, 60).map(function (row) {
      return '<div class="dupe-row">' +
        '<div class="dupe-pair"><strong>' + esc(personLabel(row.a)) + "</strong><em>and</em><strong>" + esc(personLabel(row.b)) + "</strong></div>" +
        '<div class="dupe-why">' + esc(row.reasons.map(function (r) { return r.why; }).join(" · ")) + "</div>" +
        '<div class="dupe-actions">' +
        '<button type="button" class="toolbar-button" data-accept-a="' + esc(row.a) + '" data-accept-b="' + esc(row.b) + '">Draw it</button>' +
        '<button type="button" class="toolbar-button" data-reject-a="' + esc(row.a) + '" data-reject-b="' + esc(row.b) + '">Not related</button>' +
        "</div></div>";
    }).join("") || '<div class="dupes-empty">Nothing to review.</div>';
  }
  function openSuggestions() { renderSuggestions(); var m = $("#suggest-modal"); if (m) { m.hidden = false; var c = m.querySelector("[data-action=close-suggest]"); if (c) c.focus(); } }
  function closeSuggestions() { var m = $("#suggest-modal"); if (m) m.hidden = true; }

  /* ================= What the shape says ============================== */
  function insightRow(title, detail, action) {
    return '<div class="insight-row"><strong>' + esc(title) + "</strong>" +
      (action ? action : '<span>' + esc(detail) + "</span>") + "</div>";
  }
  function insightGroup(title, note, body) {
    return '<div class="insight-group"><h3>' + esc(title) + "</h3>" +
      (note ? '<p class="insight-note">' + esc(note) + "</p>" : "") +
      (body || '<div class="insight-empty">Nothing yet.</div>') + "</div>";
  }
  function renderInsights() {
    var body = $("#insights-body"); if (!body) return;
    var shape = shapeOf(), suggestions = linkSuggestions(), cold = coldList();
    var parts = [];
    parts.push(insightGroup("Groups", "People who reach each other without going through you.",
      shape.groups.slice(0, 8).map(function (group) {
        return insightRow(group.name, group.size + (group.size === 1 ? " person" : " people"),
          '<button type="button" data-show-group="' + esc(group.key) + '">Show ' + group.size + "</button>");
      }).join("")));
    parts.push(insightGroup("Who holds it together", "Remove one of these and part of your network stops being connected to the rest.",
      shape.bridges.slice(0, 8).map(function (row) {
        return insightRow(row.name, "splits into " + row.splitsInto,
          '<button type="button" data-open-person="' + esc(row.id) + '">Open</button>');
      }).join("")));
    parts.push(insightGroup("Identifiers held by more than one person", "A household, a workplace, or the same person recorded twice.",
      shape.shared.slice(0, 8).map(function (row) {
        return insightRow(row.value, row.kind + " · " + row.who.join(", "));
      }).join("")));
    parts.push(insightGroup("Relationships the evidence implies", "",
      suggestions.slice(0, 6).map(function (row) {
        return insightRow(personLabel(row.a) + " ↔ " + personLabel(row.b), row.reasons[0].why,
          '<button type="button" data-open-suggestions="1">Review ' + suggestions.length + "</button>");
      }).join("")));
    parts.push(insightGroup("Going quiet", "",
      cold.slice(0, 6).map(function (row) {
        return insightRow(row.label, row.days + " days overdue",
          '<button type="button" data-open-person="' + esc(row.id) + '">Open</button>');
      }).join("")));
    body.innerHTML = parts.join("");
  }
  function openInsights() { renderInsights(); var m = $("#insights-modal"); if (m) { m.hidden = false; var c = m.querySelector("[data-action=close-insights]"); if (c) c.focus(); } }
  function closeInsights() { var m = $("#insights-modal"); if (m) m.hidden = true; }

  /* ================= Everything that has happened ===================== */
  function networkHistory() {
    if (!state.snapshot) return [];
    var owners = Object.create(null);
    state.snapshot.links.forEach(function (link) {
      var from = normaliseId(link.from), to = normaliseId(link.to);
      var a = personById(from), b = personById(to);
      if (a && !b) (owners[to] = owners[to] || []).push(from);
      else if (b && !a) (owners[from] = owners[from] || []).push(to);
    });
    return state.snapshot.entities.filter(function (entity) {
      return D.isInteraction(entity) || (String(entity.type || "").toLowerCase() === "fact" && D.attrs(entity).validFrom);
    }).map(function (entity) {
      var a = D.attrs(entity);
      return {
        id: String(entity.id), title: String(entity.label || "Record"),
        at: Date.parse(a.occurredAt || a.validFrom || a.observedAt || "") || 0,
        kind: D.isInteraction(entity) ? String(a.channel || a.interactionType || "interaction") : "note",
        link: String(a.link || ""), who: (owners[String(entity.id)] || []).map(personLabel)
      };
    }).filter(function (row) { return row.at > 0; })
      .sort(function (x, y) { return y.at - x.at; });
  }
  function renderHistory() {
    var list = $("#history-list"); if (!list) return;
    var rows = networkHistory();
    setText("#history-summary", rows.length
      ? formatCount(rows.length) + " dated record" + (rows.length === 1 ? "" : "s") + " across the whole network, most recent first."
      : "Nothing dated yet. Import a mailbox or a calendar, or log an interaction.");
    list.innerHTML = rows.slice(0, 300).map(function (row) {
      var safe = /^https:\/\//i.test(row.link) ? row.link : "";
      var title = safe ? '<a href="' + esc(safe) + '" target="_blank" rel="noreferrer">' + esc(row.title) + "</a>" : esc(row.title);
      return '<div class="history-row"><div class="history-when">' + esc(formatDate(new Date(row.at).toISOString())) + "</div>" +
        '<div><div class="history-what">' + title + "</div>" +
        '<div class="history-who">' + esc([row.kind, row.who.join(", ")].filter(Boolean).join(" · ")) + "</div></div></div>";
    }).join("") || '<div class="dupes-empty">Nothing to show.</div>';
  }
  function openHistory() { renderHistory(); var m = $("#history-modal"); if (m) { m.hidden = false; var c = m.querySelector("[data-action=close-history]"); if (c) c.focus(); } }
  function closeHistory() { var m = $("#history-modal"); if (m) m.hidden = true; }

  /* ================= The brief ======================================== */
  function briefModel() {
    var shape = shapeOf(), account = A && A.current ? A.current() : null;
    var sources = Object.create(null);
    (state.snapshot ? state.snapshot.entities : []).forEach(function (entity) {
      var label = EV ? EV.sourceLabel(entity.source || D.attrs(entity).sourceType) : String(entity.source || "");
      sources[label] = (sources[label] || 0) + 1;
    });
    var emailed = peopleForShape().map(function (person) {
      var a = D.attrs(person);
      return { name: person.label, total: Number(a.emailTotal || 0), lastAt: a.emailLastAt || "" };
    }).filter(function (row) { return row.total > 0; }).sort(function (x, y) { return y.total - x.total; });
    return {
      owner: (account && account.name) || "Your network",
      generatedAt: new Date().toISOString(),
      stats: state.snapshot ? state.snapshot.stats : {},
      groups: shape.groups.map(function (g) { return { name: g.name, size: g.size, sample: g.members.slice(0, 4).map(personLabel) }; }),
      bridges: shape.bridges,
      cold: coldList().map(function (row) { return { name: row.label, ring: RING_LABELS[row.ring] || "", days: row.debt.days }; }),
      mostEmailed: emailed,
      recent: networkHistory().slice(0, 20).map(function (row) { return { date: new Date(row.at).toISOString(), title: row.title, who: row.who.join(", ") }; }),
      shared: shape.shared,
      suggestions: linkSuggestions().map(function (row) { return { a: personLabel(row.a), b: personLabel(row.b), why: row.reasons[0].why }; }),
      sources: Object.keys(sources).sort().map(function (label) { return { label: label, count: sources[label] }; })
    };
  }
  function writeBrief() {
    if (!BR) return;
    try {
      var blob = new Blob([BR.page(briefModel())], { type: "text/html" });
      var url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url;
      link.download = "orbit-brief-" + new Date().toISOString().slice(0, 10) + ".html";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      setText("#sync-status", "BRIEF WRITTEN");
    } catch (error) { setText("#sync-status", "THE BRIEF COULD NOT BE WRITTEN"); }
  }

  function visibleModal() {
    return $$(".modal-layer").filter(function (layer) { return !layer.hidden; })[0] || null;
  }
  /* Clicking the dimmed backdrop dismisses a modal, so the X is never the only
   * way out. Press and release must both land on the backdrop, so a text drag
   * that finishes outside the panel doesn't close it. */
  function wireBackdropClose() {
    var closers = {
      "person-modal": closeModal, "vault-modal": closeVault, "import-modal": closeImport,
      "record-modal": closeRecord, "account-modal": closeAccountModal,
      "connections-modal": closeConnections, "recycle-modal": closeRecycleBin,
      "shortcuts-modal": closeShortcuts, "dupes-modal": closeDupes,
      "insights-modal": closeInsights, "suggest-modal": closeSuggestions, "history-modal": closeHistory
    };
    $$(".modal-layer").forEach(function (layer) {
      var close = closers[layer.id]; if (!close) return;
      var armed = false;
      layer.addEventListener("pointerdown", function (event) { armed = event.target === layer; });
      layer.addEventListener("click", function (event) { var go = armed && event.target === layer; armed = false; if (go) close(); });
    });
  }
  function trapModalTab(event) {
    var layer = visibleModal();
    if (!layer || event.key !== "Tab") return;
    var panel = layer.querySelector("[role=dialog], form"), focusable = panel ? Array.prototype.slice.call(panel.querySelectorAll("button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[href]")) : [];
    if (!focusable.length) return;
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  function exportVault() {
    if (!state.store || !V || !V.open) return;
    try {
      var payload = V.open(state.store).exportJSON();
      var blob = new Blob([payload], { type: "application/json" });
      var url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url;
      link.download = "orbit-vault-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      setVaultStatus("Vault exported · " + formatCount(state.snapshot.entities.length) + " entities · " + formatCount(state.snapshot.links.length) + " links");
    } catch (error) { setVaultStatus(error && error.message ? error.message : "The vault could not be exported."); }
  }
  function importVault(file) {
    if (!file || !state.store || !V || !V.open) return;
    readFileText(file).then(function (value) {
      var result = V.open(state.store).importJSON(value);
      render();
      setVaultStatus("Vault merged · " + formatCount(result.imported.entities) + " entities · " + formatCount(result.imported.links) + " links received");
    }).catch(function (error) {
      setVaultStatus(error && error.message ? error.message : "The vault could not be imported.");
    });
  }
  /* Profile pictures come down once, small, and are kept inline from then on.
   * Instagram's addresses are signed and expire, so nothing remote is ever
   * stored — only the pixels, at the size a node actually draws.
   *
   * A few at a time: 280 simultaneous requests would be throttled, and a
   * failure is not an error. A picture that cannot be read back leaves the
   * account with its handle glyph, which is what it had before. */
  var AVATAR_PIXELS = 64, AVATAR_AT_ONCE = 6;
  function fetchAvatars(candidates, onProgress) {
    var queue = candidates.slice(), done = 0, kept = 0;
    function next() {
      var person = queue.shift();
      if (!person) return Promise.resolve();
      return downscaleImage(person.avatarUrl, AVATAR_PIXELS).then(function (photo) {
        if (photo && /^data:image\//i.test(photo)) { person.photo = photo; kept++; }
        done++;
        if (onProgress) onProgress(done, kept);
        return next();
      }).catch(function () { done++; return next(); });
    }
    var runners = [];
    for (var i = 0; i < Math.min(AVATAR_AT_ONCE, queue.length); i++) runners.push(next());
    return Promise.all(runners).then(function () { return kept; });
  }
  /* ---- Gmail history, read on this machine ----
   * A Takeout mailbox is far too big to hold in memory, so it is streamed past
   * a line at a time and only the headers are kept. Nothing is uploaded, no
   * message body is read, and the file itself is never stored.
   *
   * What lands in Orbit is a count per correspondent and a handful of recent
   * messages, each linking back to the thread in Gmail. */
  var MBOX_MONTHS = 12, MBOX_KEEP_RECENT = 5;
  function myAddresses() {
    var out = [], account = A && A.current ? A.current() : null;
    if (account && account.email) out.push(String(account.email).toLowerCase());
    var me = personById(D.ME_ID);
    if (me) String(D.attrs(me).email || "").split(/[,;]/).forEach(function (address) {
      var a = address.trim().toLowerCase(); if (a.indexOf("@") > 0 && out.indexOf(a) === -1) out.push(a);
    });
    return out;
  }
  function readMailbox(file, onProgress) {
    var Mbox = window.OrbitMbox;
    if (!Mbox) return Promise.reject(new Error("The mailbox reader is unavailable in this build."));
    var since = Date.now() - MBOX_MONTHS * 30.44 * 86400000;
    var summary = Mbox.createSummary({ mine: myAddresses(), since: since, keepRecent: MBOX_KEEP_RECENT });
    var reader = Mbox.createReader(function (headers) { summary.add(headers); });
    var seen = 0, bytes = 0;
    function feed(chunk) {
      var lines = chunk.split("\n");
      for (var i = 0; i < lines.length; i++) reader.line(lines[i]);
      seen += lines.length;
    }
    /* Streaming keeps a multi-gigabyte export off the heap; a browser without
     * streams falls back to reading it whole. */
    if (file.stream && typeof TextDecoder === "function") {
      var decoder = new TextDecoder("utf-8"), tail = "";
      var stream = file.stream().getReader();
      return (function pump() {
        return stream.read().then(function (step) {
          if (step.done) { feed(tail); reader.end(); return summary.result(); }
          bytes += step.value.length;
          var chunk = tail + decoder.decode(step.value, { stream: true });
          var cut = chunk.lastIndexOf("\n");
          tail = cut === -1 ? chunk : chunk.slice(cut + 1);
          if (cut !== -1) feed(chunk.slice(0, cut));
          if (onProgress) onProgress(bytes, file.size || 0);
          return pump();
        });
      })();
    }
    return readFileText(file).then(function (value) {
      feed(value); reader.end();
      return summary.result();
    });
  }
  /* One contact per correspondent, plus their recent messages as interactions —
   * the same shape the calendar import already produces, so the review screen
   * and the merge need no special case. */
  function mailboxCandidates(result) {
    var out = [];
    result.people.forEach(function (row) {
      out.push({
        kind: "contact",
        name: row.name || row.email.split("@")[0],
        email: row.email,
        category: row.name ? "individual" : "email",
        emailTotal: row.total, emailSent: row.sent, emailReceived: row.received,
        emailFirstAt: row.firstAt ? new Date(row.firstAt).toISOString() : "",
        emailLastAt: row.lastAt ? new Date(row.lastAt).toISOString() : "",
        sourceType: "gmail-import", sourceRef: "gmail:" + row.email
      });
      row.recent.forEach(function (message) {
        out.push({
          kind: "interaction",
          title: message.subject,
          summary: (message.direction === "sent" ? "You wrote to " : "From ") + (row.name || row.email),
          occurredAt: new Date(message.at).toISOString(),
          channel: "email",
          direction: message.direction === "sent" ? "outbound" : "inbound",
          link: message.link,
          attendees: [{ name: row.name, email: row.email }],
          sourceType: "gmail-import",
          sourceRef: message.id ? "gmail:" + message.id : "gmail:" + row.email + ":" + message.at
        });
      });
    });
    return out;
  }
  function mailboxNote(result) {
    return formatCount(result.counts.kept) + " message" + (result.counts.kept === 1 ? "" : "s") +
      " from the last " + MBOX_MONTHS + " months, across " + formatCount(result.people.length) +
      " correspondent" + (result.people.length === 1 ? "" : "s") + ". " +
      formatCount(result.counts.skippedOld) + " older message" + (result.counts.skippedOld === 1 ? " was" : "s were") +
      " left out. No message body was read and the mailbox itself is not stored.";
  }
  function reviewMailbox(file) {
    setText("#sync-status", "READING " + String(file.name || "MAILBOX").toUpperCase() + "…");
    return readMailbox(file, function (bytes, total) {
      if (total && bytes % (4 * 1024 * 1024) < 65536) setText("#sync-status", "READING MAILBOX · " + Math.round(bytes / total * 100) + "%");
    }).then(function (result) {
      openImportReview([{ name: file.name, candidates: mailboxCandidates(result), skippedCount: 0 }], mailboxNote(result));
    });
  }
  function openImportPicker() { $("#contact-file").click(); }
  function openCalendarPicker() { $("#calendar-file").click(); }
  /* Duplicate detection lives in the shared, tested matching module. It returns
   * one entry per candidate: null, or { target, reason, score }. */
  function importMatches(candidates) {
    var M = window.OrbitContactMatching;
    if (!M || !M.computeMatches) return candidates.map(function () { return null; });
    var people = state.snapshot ? state.snapshot.entities.filter(function (entity) { return D.isPerson(entity); }) : [];
    return M.computeMatches(candidates, people);
  }
  function importSummary(candidates) {
    var CL = window.OrbitContactClassify;
    var selected = candidates.filter(function (_, index) { return state.importDraft.selected[index]; }).length;
    var events = candidates.length && candidates[0].kind === "interaction";
    var matches = (state.importDraft.matches || []).filter(Boolean).length;
    var organisations = candidates.filter(function (item) { return item.kind !== "interaction" && (CL && CL.isOrganisationCategory ? CL.isOrganisationCategory(item.category) : (item.category === "organisation" || item.category === "generic-inbox")); }).length;
    setText("#import-modal-title", events ? "Import calendar" : "Import contacts");
    var filtered = state.importDraft.skippedCount ? " " + formatCount(state.importDraft.skippedCount) + " automated or incomplete record" + (state.importDraft.skippedCount === 1 ? " was" : "s were") + " filtered out." : "";
    var orgNote = organisations ? " " + formatCount(organisations) + " look" + (organisations === 1 ? "s" : "") + " like organisations." : "";
    var matched = matches ? " " + formatCount(matches) + " likely existing match" + (matches === 1 ? " is" : "es are") + " flagged for review." : "";
    setText("#import-summary", candidates.length ? formatCount(candidates.length) + (events ? " calendar events found. Review them before anything is added to Orbit." : " contacts found. Review the rows before anything is added to Orbit.") + filtered + orgNote + matched : (filtered || "No usable records were found in that file."));
    setText("#import-selected-count", selected + " of " + formatCount(candidates.length) + " selected");
    $("[data-action=merge-import]").disabled = selected === 0;
  }
  function renderImportPreview() {
    var draft = state.importDraft, preview = $("#import-preview"), empty = $("#import-empty");
    if (!draft) { preview.innerHTML = ""; empty.hidden = true; return; }
    var CL = window.OrbitContactClassify;
    preview.innerHTML = draft.candidates.map(function (item, index) {
      var follow = item.igDirection === "following" ? "You follow @" + item.igHandle : (item.igDirection === "follower" ? "@" + item.igHandle + " follows you" : "");
      var event = item.kind === "interaction", detail = event ? [item.occurredAt ? formatDate(item.occurredAt) : "Undated", item.location, (item.attendees || []).map(function (attendee) { return attendee.name || attendee.email; }).join(", ")].filter(Boolean).join(" · ") : [item.role, item.organisation, item.email, item.phone, follow].filter(Boolean).join(" · ");
      var category = item.category || "individual";
      var label = event ? item.sourceType.replace(/-import$/, "") : (CL && CL.categoryLabel ? CL.categoryLabel(category) : category);
      var match = draft.matches && draft.matches[index], matchNote = match ? "Possible match: " + (match.target && match.target.label || "existing contact") + (match.reason ? " (" + match.reason + ")" : "") : "";
      var rowClass = "import-row" + (event ? "" : " import-cat-" + category) + (match ? " import-matched" : "");
      return '<label class="' + rowClass + '" role="listitem"><input type="checkbox" data-import-index="' + index + '"' + (draft.selected[index] ? " checked" : "") + '><span class="import-row-copy"><strong>' + esc(event ? item.title : item.name) + '</strong><span>' + esc([detail || (event ? "No attendees or location" : "No additional details"), matchNote].filter(Boolean).join(" · ")) + '</span></span><small class="import-row-tag">' + esc(label) + '</small></label>';
    }).join("");
    empty.hidden = draft.candidates.length > 0;
    $("#import-select-all").checked = draft.candidates.length > 0 && draft.selected.every(function (value) { return value; });
    importSummary(draft.candidates);
  }
  /* Several files review together, so a followers list and a following list
   * land in one pass and every mutual follow is known before anything merges. */
  /* A pasted list has no file name, so the two things a name would have said —
   * whose list it is and which way it runs — are asked for once. */
  function reviewPasted(payload, x, y) {
    var I = window.OrbitNetworkImporters; if (!I) return;
    var me = personById(D.ME_ID), mine = me ? igHandle(D.attrs(me).instagram) : "";
    function go(direction) {
      var name = (mine || "instagram") + "_IG_" + (direction === "following" ? "Following" : "Followers");
      var result = I.review(payload, name);
      openImportReview([{ name: name, candidates: result.candidates || [], skippedCount: result.skippedCount || 0 }]);
    }
    showCtxMenu(x, y, [
      { label: "These accounts follow me", fn: function () { go("follower"); } },
      { label: "These are accounts I follow", fn: function () { go("following"); } }
    ]);
  }
  function openImportReview(results, note) {
    var candidates = [], skipped = 0;
    results.forEach(function (result) { candidates = candidates.concat(result.candidates); skipped += result.skippedCount; });
    var label = results.length > 1 ? results.map(function (r) { return r.name; }).join(" + ") : (results[0] ? results[0].name : "");
    state.importDraft = { fileName: label, candidates: candidates, skippedCount: skipped, matches: importMatches(candidates), selected: candidates.map(function () { return true; }) };
    renderImportPreview();
    $("#import-modal").hidden = false;
    $("#import-select-all").focus();
    /* A source with something particular to say gets the last word, after the
     * generic preview has written its own summary. */
    if (note) setText("#import-summary", note);
    var withPictures = candidates.filter(function (person) { return !!person.avatarUrl; }).length;
    setText("#sync-status", candidates.length
      ? candidates.length + " RECORD" + (candidates.length === 1 ? "" : "S") + " READY FOR REVIEW" + (withPictures ? " · " + formatCount(withPictures) + " WITH PICTURES" : "")
      : "NO USABLE RECORDS FOUND");
  }
  function reviewImport(files) {
    var list = files && files.length ? Array.prototype.slice.call(files) : (files ? [files] : []);
    if (!list.length || !window.OrbitNetworkImporters) return;
    var I = window.OrbitNetworkImporters;
    setText("#sync-status", "READING " + (list.length > 1 ? list.length + " FILES" : String(list[0].name || "FILE").toUpperCase()) + "…");
    var mailbox = list.filter(function (file) { return /\.mbox$/i.test(String(file.name || "")); })[0];
    if (mailbox) { reviewMailbox(mailbox).catch(function (error) { setText("#sync-status", error && error.message ? error.message : "MAILBOX ERROR"); }); return; }
    Promise.all(list.map(function (file) {
      return readFileText(file).then(function (value) {
        var result = I.review ? I.review(value, file.name) : { candidates: I.parse(value, file.name), skippedCount: 0 };
        return { name: file.name, candidates: result.candidates || [], skippedCount: result.skippedCount || 0 };
      });
    })).then(function (results) {
      openImportReview(results);
    }).catch(function (error) {
      setText("#sync-status", error && error.message ? error.message : "IMPORT ERROR");
    });
  }
  function closeImport() { $("#import-modal").hidden = true; state.importDraft = null; renderImportPreview(); }
  /* Drag a contacts file anywhere onto Orbit; it flows through the same review
   * screen. Only recognised contact formats are read — an image dropped by
   * mistake (e.g. onto a photo target) is ignored, not parsed as contacts. */
  function isContactFile(file) {
    return !!file && (/\.(csv|vcf|vcard|json|ics|txt)$/i.test(file.name || "") || /(csv|vcard|calendar|json|text\/plain)/i.test(file.type || ""));
  }
  function wireFileDrop() {
    var overlay = $("#drop-overlay"), depth = 0;
    function hasFiles(event) { var types = event.dataTransfer && event.dataTransfer.types; return types && Array.prototype.indexOf.call(types, "Files") !== -1; }
    function show() { if (overlay) overlay.hidden = false; }
    function hide() { depth = 0; if (overlay) overlay.hidden = true; }
    window.addEventListener("dragenter", function (event) { if (!hasFiles(event)) return; event.preventDefault(); depth++; show(); });
    window.addEventListener("dragover", function (event) { if (!hasFiles(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; });
    window.addEventListener("dragleave", function (event) { if (!hasFiles(event)) return; depth--; if (depth <= 0) hide(); });
    window.addEventListener("drop", function (event) {
      if (!hasFiles(event)) return;
      event.preventDefault(); hide();
      var file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file) return;
      if (isContactFile(file)) reviewImport(file);
      else setText("#sync-status", "DROP A .CSV, .VCF OR .JSON CONTACTS FILE");
    });
  }
  function parseSocialProfiles(value) {
    if (Array.isArray(value)) return value;
    return String(value || "").split(/\r?\n/).map(function (line) {
      line = line.trim(); if (!line) return null;
      var parts = line.split(/:\s*/, 2), platform = parts.length > 1 ? parts[0].trim() : "Social", profile = parts.length > 1 ? parts[1].trim() : parts[0].trim();
      return { platform: platform, value: profile, url: /^https?:\/\//i.test(profile) ? profile : "" };
    }).filter(Boolean);
  }
  function contactAttrs(candidate, sourceType, sourceRef, stamp) {
    var attrs = { preferredName: String(candidate.preferredName || "").trim(), entityKind: String(candidate.category || "person").trim(), role: String(candidate.role || "").trim(), organisation: String(candidate.organisation || "").trim(), location: String(candidate.location || "").trim(), email: String(candidate.email || "").trim(), phone: String(candidate.phone || "").trim(), phoneOther: String(candidate.phoneOther || "").trim(), whatsapp: String(candidate.whatsapp || "").trim(), signal: String(candidate.signal || "").trim(), instagram: String(candidate.instagram || "").trim(), facebook: String(candidate.facebook || "").trim(), website: String(candidate.website || "").trim(), x: String(candidate.x || "").trim(), address: String(candidate.address || "").trim(), workAddress: String(candidate.workAddress || "").trim(), birthday: String(candidate.birthday || "").trim(), interests: String(candidate.interests || "").trim(), relationship: String(candidate.relationship || "").trim(), note: String(candidate.note || "").trim(), photo: String(candidate.photo || "").trim(),
      emailTotal: candidate.emailTotal || "", emailSent: candidate.emailSent || "", emailReceived: candidate.emailReceived || "",
      emailFirstAt: String(candidate.emailFirstAt || ""), emailLastAt: String(candidate.emailLastAt || ""), tags: T ? T.parse(candidate.tags) : [], socialProfiles: parseSocialProfiles(candidate.socialProfiles), sourceType: sourceType === "manual" ? "user-entered" : sourceType, sourceRef: sourceRef, provenance: sourceType === "manual" ? "user-entered" : "imported", observedAt: stamp };
    if (candidate.strength != null && candidate.strength !== "") attrs.strength = Number(candidate.strength);
    Object.keys(attrs).forEach(function (key) { if (attrs[key] === "" || (Array.isArray(attrs[key]) && !attrs[key].length)) delete attrs[key]; });
    return attrs;
  }
  /* ---- Instagram follow links ----
   * A follower list says who follows whom. One link per pair carries both
   * directions, so importing followers and following in either order ends with
   * the same answer: a mutual follow, or a one-way one drawn with an arrow. */
  var IG_TYPE = "FOLLOWS";
  function igHandle(value) {
    return String(value == null ? "" : value).trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
  }
  function personByHandle(handle) {
    if (!handle || !state.snapshot) return null;
    return state.snapshot.entities.filter(function (entity) {
      return D.isPerson(entity) && igHandle(D.attrs(entity).instagram) === handle;
    })[0] || null;
  }
  /* Importing your own follower list is the ordinary case, so an owner handle
   * Orbit has not seen before is taken to be yours and remembered on your
   * record. A handle that is demonstrably NOT yours gets its own record, and the
   * follows hang off that instead. */
  function resolveIgOwner(handle) {
    if (!state.store) return "";
    if (!handle) return D.ME_ID;
    var me = personById(D.ME_ID), mine = me ? igHandle(D.attrs(me).instagram) : "";
    if (!mine) {
      state.store.merge({ entities: [{ id: D.ME_ID, type: "person", label: me && me.label ? me.label : "You", attrs: { instagram: handle } }], links: [] });
      return D.ME_ID;
    }
    if (mine === handle) return D.ME_ID;
    var existing = personByHandle(handle);
    if (existing) return String(existing.id);
    var built = contactPart({ name: handle, instagram: handle, igHandle: handle, sourceType: "instagram-import", sourceRef: "instagram:" + handle });
    if (!built) return D.ME_ID;
    state.store.merge(built.part);
    return String(built.entity.id);
  }
  /* The id is built from the sorted pair so the same two people always land on
   * the same link, whichever file arrives first; from/to carry the direction. */
  function igFollowLink(ownerId, personId, direction) {
    if (!state.store || !ownerId || !personId || String(ownerId) === String(personId)) return null;
    var pair = relationshipKey(ownerId, personId), stamp = new Date().toISOString();
    var followsOwner = direction !== "following";     /* a followers list by default */
    var from = followsOwner ? String(personId) : String(ownerId);
    var to = followsOwner ? String(ownerId) : String(personId);
    var attrs = { sourceType: "instagram-import", sourceRef: "instagram", observedAt: stamp, igOwner: String(ownerId) };
    if (followsOwner) attrs.igFollowsOwner = true; else attrs.igOwnerFollows = true;
    return {
      id: state.store.linkId({ from: pair[0], to: pair[1], type: IG_TYPE }),
      from: from, to: to, type: IG_TYPE, source: "instagram-import", createdBy: "personal-network",
      contrib: relationshipContrib(ownerId, personId), attrs: attrs
    };
  }
  /* What the edge should say, once both files have been through. */
  function igFollowLabel(link) {
    var a = D.attrs(link);
    if (a.igFollowsOwner && a.igOwnerFollows) return "Mutual follow";
    if (a.igFollowsOwner || a.igOwnerFollows) return "Follows";
    return "";
  }
  function isFollowLink(link) { return String(link && link.type || "").toUpperCase() === IG_TYPE; }
  function contactPart(candidate) {
    candidate = candidate || {};
    var name = String(candidate.name || "").trim();
    if (!name || !state.store) return null;
    var stamp = candidate.observedAt || new Date().toISOString(), sourceType = String(candidate.sourceType || "manual"), sourceRef = String(candidate.sourceRef || (sourceType === "manual" ? "manual:" + stamp : sourceType));
    var attrs = contactAttrs(candidate, sourceType, sourceRef, stamp);
    var handle = String(candidate.igHandle || "").toLowerCase();
    var identity = handle ? "instagram:" + handle : name;
    var entityId = String(candidate.mergeIntoId || "") || state.store.entityId({ type: "person", identity: identity, label: name });
    var entity = { id: entityId, type: "person", label: name, identity: identity, source: sourceType === "manual" ? "manual" : sourceType, createdBy: "personal-network", contrib: "ent:" + entityId, attrs: attrs }, part = { entities: [entity], links: [] };
    if (attrs.note) {
      var noteIdentity = entityId + "|contact_note|" + attrs.note + "|" + sourceRef, noteId = state.store.entityId({ type: "fact", identity: noteIdentity, label: "Contact note" });
      part.entities.push({ id: noteId, type: "fact", label: "Contact note", identity: noteIdentity, source: entity.source, createdBy: "personal-network", contrib: "ent:" + entityId, attrs: { factType: "contact_note", value: attrs.note, sourceType: attrs.sourceType, sourceRef: sourceRef, observedAt: stamp, validFrom: stamp } });
      part.links.push({ id: state.store.linkId({ from: entityId, to: noteId, type: "ABOUT" }), from: entityId, to: noteId, type: "ABOUT", source: entity.source, createdBy: "personal-network", contrib: "ent:" + entityId, attrs: { sourceType: attrs.sourceType, sourceRef: sourceRef } });
    }
    return { entity: entity, part: part };
  }
  function findPerson(attendee) {
    var email = String(attendee && attendee.email || "").toLowerCase(), name = String(attendee && attendee.name || "").toLowerCase();
    return state.snapshot && state.snapshot.entities.filter(function (entity) {
      if (!D.isPerson(entity)) return false;
      var attrs = D.attrs(entity), emails = String(attrs.email || "").toLowerCase().split(/[;, ]+/);
      return (email && emails.indexOf(email) !== -1) || (name && String(entity.label || "").toLowerCase() === name);
    })[0] || null;
  }
  function interactionPart(item) {
    var stamp = item.occurredAt || new Date().toISOString(), sourceRef = String(item.sourceRef || "calendar-import"), identity = sourceRef + "|" + item.title + "|" + stamp, id = state.store.entityId({ type: "interaction", identity: identity, label: item.title }), entity = { id: id, type: "interaction", label: item.title || "Calendar event", identity: identity, source: item.sourceType || "calendar-import", createdBy: "personal-network", attrs: { interactionType: item.channel === "email" ? "email" : "calendar event", occurredAt: stamp, summary: item.summary || "", location: item.location || "", channel: item.channel || "calendar", direction: item.direction || "", link: item.link || "", sourceType: item.sourceType || "calendar-import", sourceRef: sourceRef, observedAt: new Date().toISOString() } }, part = { entities: [entity], links: [] };
    (item.attendees || []).forEach(function (attendee) {
      var person = findPerson(attendee);
      if (!person && (attendee.name || attendee.email)) {
        var built = contactPart({ name: attendee.name || attendee.email.split("@")[0], email: attendee.email, sourceType: "calendar-import", sourceRef: sourceRef + ":" + (attendee.email || attendee.name) });
        if (built) { person = built.entity; part.entities = part.entities.concat(built.part.entities); part.links = part.links.concat(built.part.links); }
      }
      if (person) part.links.push({ id: state.store.linkId({ from: person.id, to: id, type: "MENTIONED_IN" }), from: person.id, to: id, type: "MENTIONED_IN", source: item.sourceType || "calendar-import", createdBy: "personal-network", attrs: { sourceType: item.sourceType || "calendar-import", sourceRef: sourceRef } });
    });
    return part;
  }
  function mergeImport() {
    if (!state.importDraft) return;
    var draft = state.importDraft;
    /* Anything carrying a picture address fetches first, so the merge writes the
     * person and their photo in one go. */
    var wanted = draft.candidates.filter(function (person, index) { return draft.selected[index] && person.avatarUrl && !person.photo; });
    if (wanted.length && !draft.avatarsDone) {
      draft.avatarsDone = true;
      setText("#sync-status", "FETCHING " + formatCount(wanted.length) + " PROFILE PICTURES…");
      setText("#import-summary", "Fetching " + formatCount(wanted.length) + " profile pictures. Any that cannot be read keep their handle glyph.");
      fetchAvatars(wanted, function (done, kept) {
        if (done % 25 === 0 || done === wanted.length) setText("#sync-status", "PICTURES " + formatCount(done) + "/" + formatCount(wanted.length) + " · " + formatCount(kept) + " KEPT");
      }).then(function (kept) { draft.avatarsKept = kept; mergeImport(); });
      return;
    }
    if (!state.store) {
      setText("#sync-status", "WORKSPACE LOADING");
      setText("#import-summary", "Orbit is still opening its local workspace. The selected contact will merge when it is ready.");
      if (state.ready) state.ready.then(function () { if (state.importDraft && state.store) mergeImport(); });
      return;
    }
    try {
      setText("#import-summary", "Merging selected contacts…");
      var part = { entities: [], links: [] }, selected = 0, follows = 0;
      /* Resolve each owner handle once per merge, not once per follower. */
      var owners = Object.create(null);
      function igOwnerFor(handle) {
        var key = String(handle || "");
        if (!(key in owners)) owners[key] = resolveIgOwner(igHandle(key));
        return owners[key];
      }
      state.importDraft.candidates.forEach(function (candidate, index) {
        if (!state.importDraft.selected[index]) return;
        var matched = state.importDraft.matches && state.importDraft.matches[index], target = matched && matched.target ? matched.target : null;
        /* An in-batch match points at a synthetic stand-in with no real id; only
         * a match against someone already in the vault can be merged into. */
        var into = target && personById(target.id) ? String(target.id) : "";
        var mergeCandidate = target ? Object.assign({}, candidate, { name: target.label, mergeIntoId: into }) : candidate;
        var built = candidate.kind === "interaction" ? { part: interactionPart(candidate) } : contactPart(mergeCandidate);
        if (!built || !built.part) return;
        selected++;
        part.entities = part.entities.concat(built.part.entities);
        part.links = part.links.concat(built.part.links);
        /* An Instagram list also says how this person is connected to the
         * account the list came from. */
        if (candidate.igDirection && built.entity) {
          var ownerId = igOwnerFor(candidate.igOwner);
          var follow = igFollowLink(ownerId, built.entity.id, candidate.igDirection);
          if (follow) { part.links.push(follow); follows++; }
        }
      });
      if (!selected) {
        setText("#sync-status", "SELECT A CONTACT TO IMPORT");
        setText("#import-summary", "Nothing is selected. Select at least one contact, then try again.");
        return;
      }
      var matchedCount = draft.matches ? draft.matches.reduce(function (count, match, index) { return count + (match && draft.selected[index] ? 1 : 0); }, 0) : 0;
      var picturesKept = draft.avatarsKept || 0;
      pushUndo();
      var result = state.store.merge(part);
      closeImport();
      render();
      if (result && result.persisted === false) {
        setText("#sync-status", "IMPORT HELD · STORAGE UNAVAILABLE");
      } else {
        setText("#sync-status", "IMPORTED " + formatCount(selected) + " CONTACT" + (selected === 1 ? "" : "S") +
          (matchedCount ? " · " + formatCount(matchedCount) + " MATCHED" : "") +
          (follows ? " · " + formatCount(follows) + " FOLLOW LINK" + (follows === 1 ? "" : "S") : "") +
          (picturesKept ? " · " + formatCount(picturesKept) + " PICTURE" + (picturesKept === 1 ? "" : "S") : ""));
      }
    } catch (error) {
      setText("#sync-status", "IMPORT ERROR");
      setText("#import-summary", "Import failed: " + (error && error.message ? error.message : "the selected contact could not be merged."));
    }
  }
  function openRecord(kind) {
    if (!state.selectedId) return;
    var form = $("#record-form");
    form.reset();
    form.elements.kind.value = kind === "interaction" ? "interaction" : "fact";
    $("#record-modal-title").textContent = kind === "interaction" ? "Log interaction" : "Add context";
    $("#record-value-label").firstChild.textContent = kind === "interaction" ? "Summary" : "Context or note";
    form.elements.date.value = new Date().toISOString().slice(0, 10);
    $("#record-modal").hidden = false;
    form.elements.title.focus();
  }
  function closeRecord() { $("#record-modal").hidden = true; $("#record-form").reset(); }
  function addRecord(form) {
    if (!state.selectedId || !state.store) return;
    var data = new FormData(form), kind = String(data.get("kind") || "fact"), title = String(data.get("title") || "").trim(), value = String(data.get("value") || "").trim(), date = String(data.get("date") || "").trim();
    if (!title || !value) return;
    pushUndo();
    var stamp = date ? new Date(date + "T12:00:00Z").toISOString() : new Date().toISOString();
    var type = kind === "interaction" ? "interaction" : "fact";
    var identity = state.selectedId + "|" + type + "|" + title + "|" + stamp + "|" + value;
    var id = state.store.entityId({ type: type, identity: identity, label: title });
    var entity = { id: id, type: type, label: title, identity: identity, source: "manual", createdBy: "personal-network", attrs: {
      sourceType: "user-entered", sourceRef: "manual:" + stamp, observedAt: stamp
    } };
    if (type === "interaction") {
      entity.attrs.interactionType = "manual note";
      entity.attrs.occurredAt = stamp;
      entity.attrs.summary = value;
    } else {
      entity.attrs.factType = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "context";
      entity.attrs.value = value;
      entity.attrs.validFrom = stamp;
    }
    var link = { id: state.store.linkId({ from: state.selectedId, to: id, type: type === "interaction" ? "MENTIONED_IN" : "ABOUT" }), from: state.selectedId, to: id, type: type === "interaction" ? "MENTIONED_IN" : "ABOUT", source: "manual", createdBy: "personal-network", attrs: { sourceType: "user-entered", sourceRef: "manual:" + stamp } };
    state.store.merge({ entities: [entity], links: [link] });
    closeRecord();
    render();
    openDossier(state.selectedId);
  }
  function addPerson(form) {
    var data = new FormData(form), name = String(data.get("name") || "").trim();
    if (!name) return;
    pushUndo();
    var candidate = { name: name, preferredName: data.get("preferredName"), role: data.get("role"), organisation: data.get("organisation"), location: data.get("location"), email: data.get("email"), phone: data.get("phone"), phoneOther: data.get("phoneOther"), whatsapp: data.get("whatsapp"), signal: data.get("signal"), instagram: data.get("instagram"), facebook: data.get("facebook"), website: data.get("website"), x: data.get("x"), socialProfiles: data.get("socialProfiles"), address: data.get("address"), workAddress: data.get("workAddress"), birthday: data.get("birthday"), interests: data.get("interests"), relationship: data.get("relationship"), note: data.get("note"), tags: data.get("tags"), strength: data.get("strength"), sourceType: "manual" };
    if (state.editingId) {
      var existing = state.snapshot && state.snapshot.entities.filter(function (entity) { return String(entity.id) === String(state.editingId) && D.isPerson(entity); })[0];
      if (!existing) return;
      var stamp = new Date().toISOString(), updated = contactAttrs(candidate, "manual", String(D.attrs(existing).sourceRef || "manual:" + stamp), stamp), managed = ["preferredName", "role", "organisation", "location", "email", "phone", "phoneOther", "whatsapp", "signal", "instagram", "facebook", "website", "x", "socialProfiles", "address", "workAddress", "birthday", "interests", "relationship", "note", "tags", "strength"];
      managed.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(updated, key)) existing.attrs[key] = updated[key]; else delete existing.attrs[key]; });
      existing.label = name;
      state.store.merge({ entities: [existing], links: [] });
      state.selectedId = String(existing.id);
      closeModal();
      render();
      openDossier(state.selectedId);
      if (isMe(existing.id)) syncMeToAccount();
      return;
    }
    var built = contactPart(candidate);
    if (!built) return;
    if (state.pendingPlace && built.entity) { state.positions[String(built.entity.id)] = { x: state.pendingPlace.x, y: state.pendingPlace.y }; state.pinned[String(built.entity.id)] = true; }
    state.pendingPlace = null;
    state.store.merge(built.part);
    closeModal();
    state.selectedId = String(built.entity.id);
    render();
    openDossier(state.selectedId);
  }
  function bind() {
    $$('[data-auth-mode]').forEach(function (button) { button.addEventListener("click", function () { setAuthMode(button.getAttribute("data-auth-mode")); }); });
    $("#auth-signup-form").addEventListener("submit", function (event) { event.preventDefault(); handleCreate(event.currentTarget); });
    $("#auth-signin-form").addEventListener("submit", function (event) { event.preventDefault(); handleSignIn(event.currentTarget); });
    $$('[data-auth-provider]').forEach(function (button) { button.addEventListener("click", function () { handleProviderSignIn(button.getAttribute("data-auth-provider")); }); });
    /* A sign-in popup posts its provider token back here on completion; if a
     * Google contacts connect is pending, finish it with that token (the token
     * isn't reliably synced across tabs, so we pass it explicitly). */
    window.addEventListener("message", function (event) {
      if (event.origin !== window.location.origin) return;
      var data = event.data;
      if (!data || data.source !== "orbit-oauth") return;
      finishPendingConnection(data.provider_token || "");
    });
    $("#account-form").addEventListener("submit", function (event) { event.preventDefault(); saveAccountProfile(event.currentTarget); });
    $('[data-action="account"]').addEventListener("click", openAccountModal);
    $('[data-action="close-account"]').addEventListener("click", closeAccountModal);
    $('[data-action="sign-out"]').addEventListener("click", signOut);
    $('[data-action="connections"]').addEventListener("click", openConnections);
    $$('[data-action="close-connections"]').forEach(function (button) { button.addEventListener("click", closeConnections); });
    $$('[data-connect-provider]').forEach(function (button) { button.addEventListener("click", function () { connectProvider(button.getAttribute("data-connect-provider")); }); });
    if (C && C.onChange) C.onChange(renderConnections);
    $$('[data-action="add-person"]').forEach(function (button) { button.addEventListener("click", function () { openModal(); }); });
    $$('[data-action="dismiss-empty"]').forEach(function (button) { button.addEventListener("click", dismissEmpty); });
    $$('[data-action="import-contacts"]').forEach(function (button) { button.addEventListener("click", openImportPicker); });
    $$('[data-action="import-calendar"]').forEach(function (button) { button.addEventListener("click", openCalendarPicker); });
    $$('[data-import-provider]').forEach(function (button) { button.addEventListener("click", openImportPicker); });
    wireFileDrop();
    $$('[data-action="vault"]').forEach(function (button) { button.addEventListener("click", openVault); });
    $$('[data-action="close-vault"]').forEach(function (button) { button.addEventListener("click", closeVault); });
    $('[data-action="export-vault"]').addEventListener("click", exportVault);
    $("#vault-file").addEventListener("change", function (event) { importVault(event.target.files && event.target.files[0]); event.target.value = ""; });
    $("#contact-file").addEventListener("change", function (event) { reviewImport(event.target.files); event.target.value = ""; });
    $("#calendar-file").addEventListener("change", function (event) { reviewImport(event.target.files && event.target.files[0]); event.target.value = ""; });
    $$('[data-action="close-import"]').forEach(function (button) { button.addEventListener("click", closeImport); });
    $('[data-action="merge-import"]').addEventListener("click", mergeImport);
    $("#import-select-all").addEventListener("change", function (event) { if (!state.importDraft) return; state.importDraft.selected = state.importDraft.candidates.map(function () { return event.target.checked; }); renderImportPreview(); });
    $("#import-preview").addEventListener("change", function (event) { var index = event.target.getAttribute("data-import-index"); if (index == null || !state.importDraft) return; state.importDraft.selected[Number(index)] = event.target.checked; importSummary(state.importDraft.candidates); $("#import-select-all").checked = state.importDraft.selected.length > 0 && state.importDraft.selected.every(function (value) { return value; }); });
    $$('[data-action="close-modal"]').forEach(function (button) { button.addEventListener("click", closeModal); });
    $$('[data-action="close-record"]').forEach(function (button) { button.addEventListener("click", closeRecord); });
    $('[data-action="add-context"]').addEventListener("click", function () { openRecord("fact"); });
    $('[data-action="log-interaction"]').addEventListener("click", function () { openRecord("interaction"); });
    $('[data-action="edit-person"]').addEventListener("click", function () { if (isMe(state.selectedId)) openAccountModal(); else if (state.selectedId) openModal(state.selectedId); });
    $('[data-action="delete-contact"]').addEventListener("click", function () { if (state.selectedId) removeContact(state.selectedId); });
    $('[data-action="mobile-capture"]').addEventListener("click", function () { if (state.selectedId) openRecord("interaction"); else openModal(); });
    $$('[data-mobile-view]').forEach(function (button) { button.addEventListener("click", function () { setMobileView(button.getAttribute("data-mobile-view")); }); });
    $('[data-action="close-dossier"]').addEventListener("click", closeDossier);
    var stage = $(".network-stage");
    if (stage) stage.addEventListener("mousemove", function (event) {
      var rect = stage.getBoundingClientRect();
      state._cursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (state.linkFrom) updateLinkGhost();
    });
    window.addEventListener("keydown", function (e) { if (e.key === "Shift") state.shiftHeld = true; });
    window.addEventListener("keyup", function (e) { if (e.key === "Shift") state.shiftHeld = false; });
    window.addEventListener("blur", function () { state.shiftHeld = false; });
    $$('[data-action="undo"]').forEach(function (button) { button.addEventListener("click", undo); });
    $$('[data-action="redo"]').forEach(function (button) { button.addEventListener("click", redo); });
    var dossierAvatar = $("#dossier-avatar");
    if (dossierAvatar) { dossierAvatar.title = "Click to add or change photo"; dossierAvatar.addEventListener("click", function () { if (state.selectedId) setPhoto(state.selectedId); }); }
    $$('[data-action="recenter"]').forEach(function (button) { button.addEventListener("click", recenterView); });
    $$('[data-action="theme"]').forEach(function (button) { button.addEventListener("click", function () { var r = button.getBoundingClientRect(); showThemePicker(r.left, r.bottom + 6); }); });
    $$('[data-action="layout"]').forEach(function (button) { button.addEventListener("click", function () { var r = button.getBoundingClientRect(); showLayoutPicker(r.left, r.bottom + 6); }); });
    $$('[data-action="insights"]').forEach(function (button) { button.addEventListener("click", openInsights); });
    $$('[data-action="close-insights"]').forEach(function (button) { button.addEventListener("click", closeInsights); });
    $$('[data-action="history"]').forEach(function (button) { button.addEventListener("click", openHistory); });
    $$('[data-action="close-history"]').forEach(function (button) { button.addEventListener("click", closeHistory); });
    $$('[data-action="close-suggest"]').forEach(function (button) { button.addEventListener("click", closeSuggestions); });
    var resetSuggest = $('[data-action="reset-suggest"]'); if (resetSuggest) resetSuggest.addEventListener("click", restoreRejected);
    var writeBriefButton = $('[data-action="write-brief"]'); if (writeBriefButton) writeBriefButton.addEventListener("click", writeBrief);
    var insightsBody = $("#insights-body");
    if (insightsBody) insightsBody.addEventListener("click", function (event) {
      var button = event.target.closest("[data-show-group],[data-open-person],[data-open-suggestions]");
      if (!button) return;
      if (button.hasAttribute("data-open-suggestions")) { closeInsights(); openSuggestions(); return; }
      if (button.hasAttribute("data-open-person")) {
        closeInsights();
        state.selectedId = button.getAttribute("data-open-person");
        render(); openDossier(state.selectedId);
        return;
      }
      state.groupFilter = button.getAttribute("data-show-group");
      closeInsights(); renderTagBar(); render();
    });
    var suggestList = $("#suggest-list");
    if (suggestList) suggestList.addEventListener("click", function (event) {
      var button = event.target.closest("[data-accept-a],[data-reject-a]");
      if (!button) return;
      if (button.hasAttribute("data-reject-a")) {
        rejectLink(button.getAttribute("data-reject-a"), button.getAttribute("data-reject-b"));
        renderSuggestions();
        setText("#sync-status", "MARKED AS UNRELATED");
        return;
      }
      addRelationship(button.getAttribute("data-accept-a"), button.getAttribute("data-accept-b"));
      render();
      renderSuggestions();
    });
    var facts = $("#dossier-facts");
    if (facts) facts.addEventListener("click", function (event) {
      var fact = event.target.closest("[data-why-score]");
      if (!fact) return;
      var box = fact.getBoundingClientRect();
      showScoreReason(box.right + 8, box.top);
    });
    $$('[data-action="shortcuts"]').forEach(function (button) { button.addEventListener("click", openShortcuts); });
    $$('[data-action="close-shortcuts"]').forEach(function (button) { button.addEventListener("click", closeShortcuts); });
    $$('[data-action="find-duplicates"]').forEach(function (button) { button.addEventListener("click", openDupes); });
    $$('[data-action="close-dupes"]').forEach(function (button) { button.addEventListener("click", closeDupes); });
    var resetDupes = $('[data-action="reset-dupes"]'); if (resetDupes) resetDupes.addEventListener("click", restoreDismissed);
    var dupesList = $("#dupes-list");
    if (dupesList) dupesList.addEventListener("click", function (event) {
      var button = event.target.closest("[data-merge-into],[data-not-a]");
      if (!button) return;
      if (button.hasAttribute("data-not-a")) {
        dismissPair(button.getAttribute("data-not-a"), button.getAttribute("data-not-b"));
        renderDupes();
        setText("#sync-status", "MARKED AS TWO DIFFERENT PEOPLE");
        return;
      }
      mergeContacts(button.getAttribute("data-merge-into"), button.getAttribute("data-merge-from"));
      renderDupes();
    });
    $$('[data-action="going-cold"]').forEach(function (button) { button.addEventListener("click", toggleColdMode); });
    $$('[data-action="clear-path"]').forEach(function (button) { button.addEventListener("click", clearPath); });
    var showPath = $('[data-action="show-path"]'); if (showPath) showPath.addEventListener("click", function () { if (state.selectedId) showPathTo(state.selectedId); });
    $$('[data-action="recycle-bin"]').forEach(function (button) { button.addEventListener("click", openRecycleBin); });
    $$('[data-action="close-recycle"]').forEach(function (button) { button.addEventListener("click", closeRecycleBin); });
    var emptyBin = $('[data-action="empty-bin"]'); if (emptyBin) emptyBin.addEventListener("click", trashClear);
    var recycleList = $("#recycle-list"); if (recycleList) recycleList.addEventListener("click", function (event) { var t = event.target.closest("[data-restore],[data-purge]"); if (!t) return; if (t.hasAttribute("data-restore")) trashRestore(t.getAttribute("data-restore")); else trashPurge(t.getAttribute("data-purge")); });
    updateTrashButton();
    wireInlineRename();
    wireBackdropClose();
    state.layout = loadLayout();
    setText("#layout-tool-label", layoutMeta(state.layout).label);
    applyBgTheme(loadBgTheme());
    $$('[data-action="remove-edge"]').forEach(function (button) { button.addEventListener("click", removeSelectedEdge); });
    $$('[data-action="close-edge"]').forEach(function (button) { button.addEventListener("click", clearEdgeSelection); });
    $('[data-action="opportunities"]').addEventListener("click", function (event) { state.opportunityMode = !state.opportunityMode; event.currentTarget.setAttribute("aria-pressed", String(state.opportunityMode)); setText("#network-mode", state.opportunityMode ? "OPPORTUNITY VIEW" : "ORBIT VIEW"); render(); });
    $("#network-search").addEventListener("input", function (event) { state.query = event.target.value; render(); });
    var tagBar = $("#tag-bar");
    if (tagBar) tagBar.addEventListener("click", function (event) {
      var chip = event.target.closest("[data-tag-filter],[data-kind-filter],[data-tag-clear]");
      if (!chip) return;
      if (chip.hasAttribute("data-tag-clear")) { state.tagFilter = {}; state.kindFilter = {}; state.groupFilter = ""; renderTagBar(); render(); setText("#sync-status", "FILTER CLEARED"); return; }
      if (chip.hasAttribute("data-group-filter")) {
        var key = chip.getAttribute("data-group-filter");
        state.groupFilter = state.groupFilter === key ? "" : key;
        renderTagBar(); render();
        var group = shapeOf().groups.filter(function (g) { return g.key === state.groupFilter; })[0];
        setText("#sync-status", group ? "SHOWING " + group.name.toUpperCase() + " · " + group.size + " PEOPLE" : "FILTER CLEARED");
        return;
      }
      if (chip.hasAttribute("data-kind-filter")) { toggleKindFilter(chip.getAttribute("data-kind-filter")); return; }
      toggleTagFilter(chip.getAttribute("data-tag-filter"));
    });
    $("#person-form").addEventListener("submit", function (event) { event.preventDefault(); addPerson(event.currentTarget); });
    $("#record-form").addEventListener("submit", function (event) { event.preventDefault(); addRecord(event.currentTarget); });
    $("#strength-input").addEventListener("input", function (event) { setText("#strength-value", event.target.value); });
    $$('[data-profile-tab]').forEach(function (button) { button.addEventListener("click", function () { setProfileTab(button.getAttribute("data-profile-tab")); }); });
    if (A && A.onChange) A.onChange(function (account) { if (account) { showWorkspace(account); } else if (state.workspaceStarted) { state.workspaceStarted = false; showAuth("signin"); } });
    document.addEventListener("click", function (event) {
      if (ctxMenuEl && !ctxMenuEl.contains(event.target)) closeCtxMenu();
      if (iconPickerEl && !iconPickerEl.contains(event.target)) closeIconPicker();
    });
    /* Pasting a copied follower list is the shortest route in: the HTML flavour
     * of the clipboard still carries every avatar. */
    document.addEventListener("paste", function (event) {
      var tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (event.target && event.target.isContentEditable)) return;
      if (visibleModal() || !window.OrbitNetworkImporters) return;
      var clip = event.clipboardData; if (!clip) return;
      var html = clip.getData("text/html"), plain = clip.getData("text/plain");
      var payload = html && /<\s*img\b/i.test(html) ? html : (plain || html);
      if (!payload || !window.OrbitNetworkImporters.looksLikeHandleList(
        window.OrbitNetworkImporters.looksLikeHtml(payload) ? payload.replace(/<[^>]+>/g, "\n") : payload)) return;
      event.preventDefault();
      reviewPasted(payload, window.innerWidth / 2, 140);
    });
    document.addEventListener("keydown", function (event) {
      trapModalTab(event);
      var mod = event.ctrlKey || event.metaKey;
      if (mod && !visibleModal() && (event.key === "z" || event.key === "Z")) { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (mod && !visibleModal() && (event.key === "y" || event.key === "Y")) { event.preventDefault(); redo(); return; }
      if (event.key === "Delete" && !visibleModal()) {
        var tag = document.activeElement ? document.activeElement.tagName : "";
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          if (Object.keys(state.selectedIds).length) { event.preventDefault(); deleteSelectedIds(); return; }
          if (state.selectedEdge && state.selectedEdge.removable) { event.preventDefault(); removeSelectedEdge(); return; }
          if (state.selectedId) { event.preventDefault(); removeContact(state.selectedId); return; }
        }
      }
      if (event.key === "?" && !visibleModal()) {
        var qtag = document.activeElement ? document.activeElement.tagName : "";
        if (qtag !== "INPUT" && qtag !== "TEXTAREA") { event.preventDefault(); openShortcuts(); return; }
      }
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !visibleModal() && (state.selectedId || Object.keys(state.selectedIds).length || state.cycleAnchor)) {
        var atag = document.activeElement ? document.activeElement.tagName : "";
        if (atag !== "INPUT" && atag !== "TEXTAREA" && atag !== "SELECT") { event.preventDefault(); cycleConnection(event.key === "ArrowLeft" ? -1 : 1); return; }
      }
      if (event.key !== "Escape") return;
      if (iconPickerEl) { closeIconPicker(); return; }
      if (ctxMenuEl) { closeCtxMenu(); return; }
      if (Object.keys(state.selectedIds).length) { clearSelectedIds(); return; }
      if (collapseAll()) { setText("#sync-status", "COLLAPSED"); return; }
      if (state.path) { clearPath(); return; }
      if (state.coldMode) { toggleColdMode(); return; }
      if (activeTags().length || activeKinds().length || state.groupFilter) { state.groupFilter = ""; clearTagFilter(); clearKindFilter(); renderTagBar(); render(); setText("#sync-status", "FILTER CLEARED"); return; }
      if (state.linkFrom) { endLinkFrom(); return; }
      if (state.selectedEdge) { clearEdgeSelection(); return; }
      var empty = $("#network-empty");
      if (empty && !empty.hidden && !visibleModal()) { dismissEmpty(); return; }
      closeModal(); closeRecord(); closeVault(); closeImport(); closeAccountModal(); closeConnections(); closeRecycleBin(); closeShortcuts(); closeDupes(); closeInsights(); closeSuggestions(); closeHistory(); closeDossier();
    });
  }
  function startWorkspace() {
    if (state.workspaceStarted) { render(); return; }
    state.workspaceStarted = true;
    var ready = window.OrbitCaseFile && typeof window.OrbitCaseFile.init === "function" ? window.OrbitCaseFile.init({ surface: "personal", app: "Personal Network" }) : Promise.resolve();
    state.ready = Promise.resolve(ready).then(function () {
      state.store = V && V.open ? V.open(window.OrbitCase) : window.OrbitCase;
      if (!state.store) throw new Error("OrbitCase spine unavailable");
      state.store.subscribe(render);
      ensureMeEntity();
      render();
      finishPendingConnection();
      if (window.OrbitCaseFile && typeof window.OrbitCaseFile.onChange === "function") window.OrbitCaseFile.onChange(function () { setText("#sync-status", "READY"); });
    }).catch(function (error) {
      setText("#sync-status", "STARTUP ERROR");
      setText("#storage-note", error && error.message ? error.message : "The network workspace could not open its local case.");
    });
  }
  function boot() {
    bind();
    if (devBypass()) { showWorkspace({ name: "Developer", email: "Local workspace (dev)", profile: {} }); return; }
    var initialise = A && A.ready ? A.ready() : Promise.resolve(A && A.current ? A.current() : null);
    initialise.then(function (account) {
      if (account) showWorkspace(account);
      else showAuth(A && A.hasAccounts && A.hasAccounts() ? "signin" : "signup");
    }).catch(function (error) { showAuth("signin"); setAuthStatus(friendlyAuthMessage(error), true); });
  }
  boot();
})();
