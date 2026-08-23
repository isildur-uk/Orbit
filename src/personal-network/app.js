(function () {
  "use strict";

  var D = window.OrbitNetworkDomain;
  var V = window.OrbitNetworkVault;
  var P = window.OrbitNetworkProfile;
  var A = window.OrbitCloudAuth && window.OrbitCloudAuth.configured ? window.OrbitCloudAuth : window.OrbitLocalAuth;
  var C = window.OrbitConnections;
  var state = { store: null, ready: null, network: null, snapshot: null, selectedId: "", editingId: "", query: "", opportunityMode: false, profileTab: "summary", mobileView: "network", importDraft: null, workspaceStarted: false, positions: {}, _nodeCount: -1, selectedEdge: null, linkFrom: null, pendingPlace: null, pinned: {}, undoStack: [], redoStack: [], photoLoaded: {}, photoPending: {}, emptyDismissed: false, shiftHeld: false, selectedIds: {}, layout: "orbit", ringAngle: {}, cycleAnchor: "", cycleIndex: -1 };
  var $ = function (selector) { return document.querySelector(selector); };
  var $$ = function (selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); };

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
    A.updateProfile(values).then(function (account) { updateAccountUI(account); closeAccountModal(); setText("#sync-status", "PROFILE SAVED"); }).catch(function (error) { var status = $("#account-status"); if (status) { status.textContent = error && error.message ? error.message : "The profile could not be saved."; status.classList.add("error"); } });
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
  function contactHref(item) {
    var value = String(item && item.value || "").trim(), kind = String(item && item.kind || "");
    if (item && item.url && /^https?:\/\//i.test(item.url)) return item.url;
    if (/^https?:\/\//i.test(value)) return value;
    if (kind === "email" && value) return "mailto:" + value.split(/[,; ]/)[0];
    if ((kind === "phone" || kind === "phoneOther" || kind === "whatsapp" || kind === "signal") && /^[+0-9 ()\-\.]+$/.test(value)) return "tel:" + value.replace(/[^+0-9]/g, "");
    return "";
  }
  function contactChip(item) {
    var label = contactKindLabel(item.kind), value = item.value, href = contactHref(item), content = '<strong>' + esc(label) + '</strong> ' + esc(value);
    return href ? '<a class="contact-chip" href="' + esc(href) + '"' + (/^https?:\/\//i.test(href) ? ' target="_blank" rel="noreferrer"' : '') + '>' + content + '</a>' : '<span class="contact-chip">' + content + '</span>';
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
    $("#dossier-facts").innerHTML = [
      ["Health score", Math.round(profile.relationship.score) + "/100"],
      ["Relationship", profile.relationship.phase.label],
      ["Recency", profile.relationship.health ? profile.relationship.health.recencyLabel : "Not recorded"],
      ["Frequency", profile.relationship.health ? profile.relationship.health.frequencyLabel : formatCount(profile.relationship.interactionCount)],
      ["Shared contacts", formatCount(profile.relationship.sharedContacts)],
      ["Open promises", formatCount(profile.promises.length)]
    ].map(function (row) { return '<div class="dossier-fact"><span class="dossier-fact-label">' + esc(row[0]) + '</span><span class="dossier-fact-value">' + esc(row[1]) + '</span></div>'; }).join("");
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
      return '<div class="timeline-item"><div class="timeline-date">' + esc(formatDate(item.date)) + '</div><div class="timeline-title">' + esc(item.title || "Untitled record") + '</div>' + (item.summary ? '<div class="timeline-summary">' + esc(item.summary) + '</div>' : '') + '<div class="timeline-kind">' + esc(item.kind) + (item.sourceType && item.sourceType !== "unknown" ? " · " + esc(item.sourceType) : "") + '</div></div>';
    }).join("");
    $("#dossier-timeline-empty").hidden = (profile.history || []).length > 0;
    $("#dossier-evidence-list").innerHTML = (profile.evidence || []).map(function (item) {
      return profileItem(item.label, "", item.kind, sourceLine(item));
    }).join("");
    $("#dossier-evidence-empty").hidden = profile.evidence.length > 0;
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
  function currentNodeIds(snapshot) {
    var people = snapshot.entities.filter(D.isPerson);
    var q = state.query.trim().toLowerCase();
    return people.filter(function (person) {
      var a = D.attrs(person);
      var haystack = [person.label, a.role, a.company, a.location, a.email, a.phone, a.phoneOther, a.whatsapp, a.instagram, a.facebook, a.website, a.address, a.workAddress, a.interests].join(" ").toLowerCase();
      var matchesQuery = !q || haystack.indexOf(q) !== -1;
      var matchesOpportunity = !state.opportunityMode || snapshot.links.some(function (link) {
        return D.hasOpportunity(link) && (String(link.from) === String(person.id) || String(link.to) === String(person.id));
      }) || D.isOpportunityEntity(person);
      return matchesQuery && matchesOpportunity;
    }).map(function (person) { return String(person.id); });
  }
  /* Only hand a photo to vis once the image has actually loaded — otherwise vis
   * tries to draw a 0-size image and throws. Until then the node is a plain dot;
   * the image load triggers one re-render that swaps it in. */
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
  function renderGraph(snapshot) {
    if (!window.vis || !window.vis.DataSet || !window.vis.Network) {
      setText("#sync-status", "GRAPH LIBRARY UNAVAILABLE");
      return;
    }
    var visibleIds = currentNodeIds(snapshot);
    var visibleSet = Object.create(null);
    visibleIds.forEach(function (id) { visibleSet[id] = true; });
    visibleSet[D.ME_ID] = true;
    var people = snapshot.entities.filter(function (entity) { return visibleSet[String(entity.id)] && D.isPerson(entity); });
    /* SOLAR-parity computed layouts (peacock, tree, grid, force, …) produce a
     * full positions map for ME + every visible person; orbit/free are handled
     * by the ring/saved-position logic below. */
    var computedKind = window.OrbitLayouts && window.OrbitLayouts.has(state.layout) ? state.layout : null;
    var layoutPos = null, layoutPhysics = false;
    if (computedKind) {
      var lnodes = [{ id: D.ME_ID, label: "ME", group: "me" }].concat(people.map(function (p) { return { id: String(p.id), label: String(p.label || ""), group: String(D.attrs(p).entityKind || "individual") }; }));
      var llinks = snapshot.links.filter(function (l) { var ff = normaliseId(l.from), tt = normaliseId(l.to); return visibleSet[ff] && visibleSet[tt]; }).map(function (l) { return { from: normaliseId(l.from), to: normaliseId(l.to) }; });
      var lr = window.OrbitLayouts.compute(computedKind, lnodes, llinks);
      if (lr) { layoutPos = lr.positions; layoutPhysics = !!lr.physics; }
    }
    var mePos = (layoutPos && layoutPos[D.ME_ID]) ? layoutPos[D.ME_ID] : mePosition();
    var meFixed = computedKind ? !layoutPhysics : (state.layout === "orbit" || !!state.pinned[D.ME_ID]);
    var nodes = [{ id: D.ME_ID, label: "ME", x: mePos.x, y: mePos.y, fixed: meFixed, shape: "dot", size: 24, borderWidth: 2, color: { background: "#da291c", border: "#ffffff", highlight: { background: "#ec3325", border: "#ffffff" } }, font: { color: "#ffffff", size: 13, face: "Inter Var", bold: true, strokeWidth: 5, strokeColor: "#141414" }, shadow: { enabled: true, color: "rgba(218,41,28,.55)", size: 26, x: 0, y: 0 } }];
    var byId = Object.create(null);
    people.forEach(function (person, index) {
      var summary = D.personSummary(person, snapshot.links);
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
      var opportunity = D.isOpportunityEntity(person) || snapshot.links.some(function (link) { return D.hasOpportunity(link) && (String(link.from) === String(person.id) || String(link.to) === String(person.id)); });
      var kind = String(D.attrs(person).entityKind || "individual");
      var organisation = kind === "organisation" || kind === "generic-inbox";
      byId[String(person.id)] = true;
      var inner = summary.score >= 55;
      var ringCol = ringPinned ? RING_COLOURS[ringKey] : null;
      var baseBg = opportunity ? "#da291c" : (organisation ? "#241f16" : (inner ? "#3a3330" : "#2b2b2b"));
      var baseBorder = selected ? "#ffffff" : (ringCol || (opportunity ? "#ff6a5e" : (organisation ? "#c9a24b" : (inner ? "#c98b84" : "#8a8a8a"))));
      var photo = photoReady(D.attrs(person).photo) ? D.attrs(person).photo : "";
      var node = { id: String(person.id), label: String(person.label || "Unnamed person"), x: position.x, y: position.y, fixed: nodeFixed, size: selected ? 17 : (opportunity ? 14 : 9 + Math.round(summary.score / 20)), borderWidth: selected ? 2.6 : 1.4, color: { background: baseBg, border: baseBorder, highlight: { background: "#da291c", border: "#ffffff" }, hover: { background: baseBg, border: "#ffffff" } }, opacity: state.query && !selected ? .4 : 1, font: { color: selected ? "#ffffff" : "#e4e4e4", size: selected ? 14 : 12, face: "Inter Var", vadjust: -2, strokeWidth: 4, strokeColor: "#181818" }, shadow: { enabled: true, color: "rgba(0,0,0,.5)", size: 7, x: 0, y: 2 }, title: String(summary.role || (organisation ? "Organisation" : "")) };
      if (photo) { node.shape = "circularImage"; node.image = photo; node.size = selected ? 22 : 18; node.borderWidth = selected ? 3 : 2; if (ringCol && !selected) node.color.border = ringCol; }
      else if (window.OrbitIcons) {
        var Icons = window.OrbitIcons;
        var iconKey = String(D.attrs(person).icon || Icons.defaultKey(kind));
        var chipRing = ringCol || (opportunity ? "#ff6a5e" : (organisation ? "#c9a24b" : (inner ? "#c98b84" : "#8a8a8a")));
        var chipUrl = Icons.chip(iconKey, { bg: organisation ? "#241f16" : "#242424", ring: chipRing, glyph: organisation ? "#e6c877" : "#e8e8e8" });
        if (photoReady(chipUrl)) {
          node.shape = "circularImage"; node.image = chipUrl; node.size = selected ? 21 : 16;
          node.color = { border: selected ? "#ffffff" : chipRing, background: "transparent", highlight: { border: "#ffffff" }, hover: { border: "#ffffff" } };
          node.borderWidth = selected ? 2.5 : 0;
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
      var relType = String(D.attrs(link).relationshipType || "");
      return { id: String(link.id), from: from, to: to, label: relType || undefined, width: opportunity ? 2.6 : (touchesMe ? 1.3 : 1.1), dashes: false, color: { color: colour, highlight: opportunity ? "#da291c" : "#ffffff", hover: "#ffffff", opacity: 1 }, font: relType ? { color: "#cfcfcf", size: 10, face: "Inter Var", strokeWidth: 4, strokeColor: "#181818", align: "middle" } : undefined, smooth: { enabled: true, type: "continuous", roundness: .28 }, hidden: false };
    });
    var data = { nodes: new window.vis.DataSet(nodes), edges: new window.vis.DataSet(edges) };
    var firstBuild = !state.network;
    if (firstBuild) {
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
        /* Fast path: shift-click a person to start a link, then click the target. */
        if (id && shift) { startLinkFrom(id); return; }
        if (id) {
          clearEdgeSelection(); clearSelectedIds();
          if (id === D.ME_ID) { closeDossier(); return; }
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
        window.__ORBIT_PEOPLE__ = function () { return state.snapshot ? state.snapshot.entities.filter(D.isPerson).length : 0; };
        window.__ORBIT_NODEAT__ = function (id) { try { var d = state.network.canvasToDOM(state.network.getPositions([id])[id]); return state.network.getNodeAt(d); } catch (e) { return "err:" + e.message; } };
      }
    } else {
      state.network.setData(data);
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
    /* Only refit the view when the set of people changes; a plain re-render
     * (selecting, editing) must not yank the camera around after a drag. */
    if (firstBuild || state._nodeCount !== people.length) {
      if (state.query.trim()) {
        try { state.network.fit({ animation: !firstBuild }); } catch (e) {}   /* frame the search matches */
      } else if (state.layout === "orbit") {
        var el = $("#network"), w = (el && el.clientWidth) || 800, h = (el && el.clientHeight) || 600;
        var scale = Math.max(0.35, Math.min(1.1, Math.min(w, h) / (2 * 540)));
        try { state.network.moveTo({ position: { x: 0, y: 0 }, scale: scale, animation: false }); } catch (e) { state.network.fit({ animation: false }); }
      } else { state.network.fit({ animation: false }); }
      state._nodeCount = people.length;
    }
    $("#network-empty").hidden = snapshot.stats.people > 0 || state.emptyDismissed;
  }
  function dismissEmpty() { state.emptyDismissed = true; var el = $("#network-empty"); if (el) el.hidden = true; }

  function render() {
    if (!state.store) return;
    state.snapshot = D.snapshot(state.store);
    setStats(state.snapshot);
    renderGraph(state.snapshot);
    if (state.selectedId) openDossier(state.selectedId);
  }
  function openDossier(id) {
    var person = state.snapshot && state.snapshot.entities.find(function (entity) { return String(entity.id) === String(id); });
    if (!person) return;
    var profile = P && P.buildProfile ? P.buildProfile(state.snapshot, id) : null;
    if (!profile) return;
    setText("#dossier-name", profile.header.name);
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
    if (badge) { badge.textContent = isOrg ? "Organisation" : ""; badge.hidden = !isOrg; }
    var dossier = $("#person-dossier"); if (dossier) dossier.setAttribute("data-kind", isOrg ? "organisation" : "individual");
    setText("#dossier-role", [profile.header.role, profile.header.organisation, profile.header.location, profile.header.relationship].filter(Boolean).join(" · ") || (isOrg ? "Organisation in your network" : "Person in your network"));
    renderProfile(profile);
    state.mobileView = "profile";
    syncMobileNav();
    var panel = $("#person-dossier");
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    panel.setAttribute("data-selected", "true");
  }
  function closeDossier() {
    state.selectedId = ""; state.profileTab = "summary"; state.mobileView = "network"; syncMobileNav();
    var panel = $("#person-dossier");
    panel.hidden = true; panel.setAttribute("aria-hidden", "true"); panel.removeAttribute("data-selected");
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
      .filter(function (id) { return id !== D.ME_ID; })
      .sort(function (a, b) { return personLabel(a).localeCompare(personLabel(b)); });
  }
  /* With a profile open, left/right flip to the previous/next person (wrapping)
   * and recentre the graph on them, so you can review the whole network by keyboard. */
  function cycleConnection(dir) {
    if (!state.selectedId) return;
    var list = allPeopleIds();
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
    if (nodeId && nodeId !== D.ME_ID) { nodeCtxMenu(String(nodeId), clientX, clientY); return; }
    if (nodeId === D.ME_ID) { meCtxMenu(clientX, clientY); return; }
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
    ids.forEach(function (id) { if (id !== D.ME_ID) state.selectedIds[id] = true; });
    var n = Object.keys(state.selectedIds).length;
    if (n) { state.selectedId = ""; closeDossier(); setText("#sync-status", n + " SELECTED · PRESS DELETE TO REMOVE"); }
    renderGraph(state.snapshot);
  }
  function clearSelectedIds() { if (Object.keys(state.selectedIds).length) { state.selectedIds = {}; renderGraph(state.snapshot); } }
  function deleteSelectedIds() {
    var ids = Object.keys(state.selectedIds); if (!ids.length || !state.store) return;
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
    render();
    updateTrashButton();
    setText("#sync-status", ids.length + " MOVED TO RECYCLE BIN");
  }
  /* Mouse: left-drag empty canvas = box select; right-drag = pan (SOLAR model).
   * Touch keeps vis's one-finger pan; long-press opens the menu. */
  function wireBoxSelect(container) {
    if (!container) return;
    var band = $("#rubber-band"), active = false, sx = 0, sy = 0;
    var panning = false, panLast = null;
    container.addEventListener("pointerdown", function (e) {
      var r = container.getBoundingClientRect(), dom = { x: e.clientX - r.left, y: e.clientY - r.top };
      /* Right-drag pans (desktop). */
      if (e.button === 2) { panning = true; state._panMoved = false; panLast = { x: e.clientX, y: e.clientY }; return; }
      if (e.button !== 0 || e.pointerType === "touch") return;      /* touch → let vis pan */
      if (state.network && state.network.getNodeAt(dom)) return;    /* on a person → link/drag */
      e.stopPropagation();                                          /* stop vis from panning */
      active = true; sx = dom.x; sy = dom.y;
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
      if (band) { band.style.left = Math.min(sx, cx) + "px"; band.style.top = Math.min(sy, cy) + "px"; band.style.width = Math.abs(cx - sx) + "px"; band.style.height = Math.abs(cy - sy) + "px"; }
    });
    function done(e) {
      if (panning) { panning = false; return; }
      if (!active) return; active = false;
      if (band) band.style.display = "none";
      var r = container.getBoundingClientRect();
      setSelectedIds(nodeIdsInRect(sx, sy, e.clientX - r.left, e.clientY - r.top));
    }
    container.addEventListener("pointerup", done);
    container.addEventListener("pointercancel", function () { active = false; panning = false; if (band) band.style.display = "none"; });
    container.addEventListener("contextmenu", function (e) { e.preventDefault(); }); /* right-drag shouldn't pop the OS menu */
  }
  function personById(id) { return state.snapshot && state.snapshot.entities.find(function (e) { return String(e.id) === String(id) && D.isPerson(e); }); }
  function nodeCtxMenu(id, x, y) {
    var person = personById(id); if (!person) return;
    var pinned = !!state.pinned[String(id)];
    var hasPhoto = !!(person.attrs && person.attrs.photo);
    var items = [
      { label: "Open profile", fn: function () { state.selectedId = String(id); render(); openDossier(state.selectedId); } },
      { label: "Edit contact…", fn: function () { openModal(id); } },
      { label: "Link from here →", fn: function () { startLinkFrom(id); } },
      { label: hasPhoto ? "Change photo…" : "Set photo…", fn: function () { setPhoto(id); } }
    ];
    if (hasPhoto) items.push({ label: "Remove photo", fn: function () { removePhoto(id); } });
    items.push({ label: "Choose icon…", fn: function () { showIconPicker(id, x, y); } });
    items.push("-");
    var currentRing = String(D.attrs(person).ring || "");
    RING_META.forEach(function (ring) {
      items.push({ label: (currentRing === ring.key ? "✓ " : "") + "Pin to " + RING_LABELS[ring.key].toLowerCase(), fn: function () { setRing(id, ring.key); } });
    });
    if (currentRing) items.push({ label: "Unpin from ring", fn: function () { clearRing(id); } });
    items.push({ label: pinned ? "Unpin position" : "Pin position", fn: function () { togglePin(id); } });
    items.push("-");
    items.push({ label: "Delete contact", danger: true, fn: function () { removeContact(id); } });
    showCtxMenu(x, y, items);
  }
  function meCtxMenu(x, y) {
    showCtxMenu(x, y, [
      { label: "Add person here…", fn: function () { addPersonAt(null); } },
      { label: "Fit chart to view", fn: function () { if (state.network) state.network.fit({ animation: true }); } },
      "-",
      { label: "Layout: " + layoutMeta(state.layout).label + " ▸", fn: function () { showLayoutPicker(x, y); } },
      { label: "Chart background…", fn: function () { showThemePicker(x, y); } }
    ]);
  }
  function edgeCtxMenu(linkId, x, y) {
    var link = linkById(linkId);
    if (!link) return;
    var removable = link.source === "manual" || (link.attrs && link.attrs.sourceRef === "manual-relationship");
    var current = String(D.attrs(link).relationshipType || "");
    var items = [{ label: "Show relationship", fn: function () { selectEdge(linkId); } }];
    if (removable) {
      items.push("-");
      RELATIONSHIP_TYPES.forEach(function (type) {
        items.push({ label: (current === type ? "✓ " : "") + type, fn: function () { setRelationshipType(linkId, type); } });
      });
      items.push({ label: "Custom label…", fn: function () { var v = window.prompt("How do they know each other?", current); if (v != null) setRelationshipType(linkId, String(v).trim()); } });
      if (current) items.push({ label: "Clear label", fn: function () { clearRelationshipType(linkId); } });
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
      img.onload = function () {
        var scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
        var w = Math.max(1, Math.round((img.width || max) * scale)), h = Math.max(1, Math.round((img.height || max) * scale));
        try {
          var canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = function () { resolve(dataUrl); };
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
  function removeContact(id) {
    if (!state.store) return;
    id = String(id);
    var record = captureForTrash(id);
    pushUndo();
    if (id === state.selectedId) closeDossier();
    delete state.pinned[id]; delete state.positions[id]; delete state.ringAngle[id];
    if (state.store.removeEntity) state.store.removeEntity(id);
    else if (state.store.withdraw) state.store.withdraw("ent:" + id);
    if (record) { var list = trashRead(); list.unshift(record); trashWrite(list); }
    render();
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
  function visibleModal() {
    return $$(".modal-layer").filter(function (layer) { return !layer.hidden; })[0] || null;
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
      var event = item.kind === "interaction", detail = event ? [item.occurredAt ? formatDate(item.occurredAt) : "Undated", item.location, (item.attendees || []).map(function (attendee) { return attendee.name || attendee.email; }).join(", ")].filter(Boolean).join(" · ") : [item.role, item.organisation, item.email, item.phone].filter(Boolean).join(" · ");
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
  function reviewImport(file) {
    if (!file || !window.OrbitNetworkImporters) return;
    setText("#sync-status", "READING " + String(file.name || "FILE").toUpperCase() + "…");
    readFileText(file).then(function (value) {
      var result = window.OrbitNetworkImporters.review ? window.OrbitNetworkImporters.review(value, file.name) : { candidates: window.OrbitNetworkImporters.parse(value, file.name), skippedCount: 0 };
      var candidates = result.candidates || [];
      state.importDraft = { fileName: file.name, candidates: candidates, skippedCount: result.skippedCount || 0, matches: importMatches(candidates), selected: candidates.map(function () { return true; }) };
      renderImportPreview();
      $("#import-modal").hidden = false;
      $("#import-select-all").focus();
      setText("#sync-status", candidates.length ? candidates.length + " RECORD" + (candidates.length === 1 ? "" : "S") + " READY FOR REVIEW" : "NO USABLE RECORDS FOUND");
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
    var attrs = { preferredName: String(candidate.preferredName || "").trim(), entityKind: String(candidate.category || "person").trim(), role: String(candidate.role || "").trim(), organisation: String(candidate.organisation || "").trim(), location: String(candidate.location || "").trim(), email: String(candidate.email || "").trim(), phone: String(candidate.phone || "").trim(), phoneOther: String(candidate.phoneOther || "").trim(), whatsapp: String(candidate.whatsapp || "").trim(), signal: String(candidate.signal || "").trim(), instagram: String(candidate.instagram || "").trim(), facebook: String(candidate.facebook || "").trim(), website: String(candidate.website || "").trim(), x: String(candidate.x || "").trim(), address: String(candidate.address || "").trim(), workAddress: String(candidate.workAddress || "").trim(), birthday: String(candidate.birthday || "").trim(), interests: String(candidate.interests || "").trim(), relationship: String(candidate.relationship || "").trim(), note: String(candidate.note || "").trim(), socialProfiles: parseSocialProfiles(candidate.socialProfiles), sourceType: sourceType === "manual" ? "user-entered" : sourceType, sourceRef: sourceRef, provenance: sourceType === "manual" ? "user-entered" : "imported", observedAt: stamp };
    if (candidate.strength != null && candidate.strength !== "") attrs.strength = Number(candidate.strength);
    Object.keys(attrs).forEach(function (key) { if (attrs[key] === "" || (Array.isArray(attrs[key]) && !attrs[key].length)) delete attrs[key]; });
    return attrs;
  }
  function contactPart(candidate) {
    candidate = candidate || {};
    var name = String(candidate.name || "").trim();
    if (!name || !state.store) return null;
    var stamp = candidate.observedAt || new Date().toISOString(), sourceType = String(candidate.sourceType || "manual"), sourceRef = String(candidate.sourceRef || (sourceType === "manual" ? "manual:" + stamp : sourceType));
    var attrs = contactAttrs(candidate, sourceType, sourceRef, stamp);
    var entityId = state.store.entityId({ type: "person", identity: name, label: name }), entity = { id: entityId, type: "person", label: name, identity: name, source: sourceType === "manual" ? "manual" : sourceType, createdBy: "personal-network", contrib: "ent:" + entityId, attrs: attrs }, part = { entities: [entity], links: [] };
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
    var stamp = item.occurredAt || new Date().toISOString(), sourceRef = String(item.sourceRef || "calendar-import"), identity = sourceRef + "|" + item.title + "|" + stamp, id = state.store.entityId({ type: "interaction", identity: identity, label: item.title }), entity = { id: id, type: "interaction", label: item.title || "Calendar event", identity: identity, source: item.sourceType || "calendar-import", createdBy: "personal-network", attrs: { interactionType: "calendar event", occurredAt: stamp, summary: item.summary || "", location: item.location || "", channel: "calendar", sourceType: item.sourceType || "calendar-import", sourceRef: sourceRef, observedAt: new Date().toISOString() } }, part = { entities: [entity], links: [] };
    (item.attendees || []).forEach(function (attendee) {
      var person = findPerson(attendee);
      if (!person && (attendee.name || attendee.email)) {
        var built = contactPart({ name: attendee.name || attendee.email.split("@")[0], email: attendee.email, sourceType: "calendar-import", sourceRef: sourceRef + ":" + (attendee.email || attendee.name) });
        if (built) { person = built.entity; part.entities = part.entities.concat(built.part.entities); part.links = part.links.concat(built.part.links); }
      }
      if (person) part.links.push({ id: state.store.linkId({ from: person.id, to: id, type: "MENTIONED_IN" }), from: person.id, to: id, type: "MENTIONED_IN", source: "calendar-import", createdBy: "personal-network", attrs: { sourceType: "calendar-import", sourceRef: sourceRef } });
    });
    return part;
  }
  function mergeImport() {
    if (!state.importDraft) return;
    if (!state.store) {
      setText("#sync-status", "WORKSPACE LOADING");
      setText("#import-summary", "Orbit is still opening its local workspace. The selected contact will merge when it is ready.");
      if (state.ready) state.ready.then(function () { if (state.importDraft && state.store) mergeImport(); });
      return;
    }
    try {
      setText("#import-summary", "Merging selected contacts…");
      var part = { entities: [], links: [] }, selected = 0;
      state.importDraft.candidates.forEach(function (candidate, index) {
        if (!state.importDraft.selected[index]) return;
        var matched = state.importDraft.matches && state.importDraft.matches[index], mergeCandidate = matched && matched.target ? Object.assign({}, candidate, { name: matched.target.label }) : candidate;
        var built = candidate.kind === "interaction" ? { part: interactionPart(candidate) } : contactPart(mergeCandidate);
        if (!built || !built.part) return;
        selected++;
        part.entities = part.entities.concat(built.part.entities);
        part.links = part.links.concat(built.part.links);
      });
      if (!selected) {
        setText("#sync-status", "SELECT A CONTACT TO IMPORT");
        setText("#import-summary", "Nothing is selected. Select at least one contact, then try again.");
        return;
      }
      pushUndo();
      var result = state.store.merge(part);
      closeImport();
      render();
      if (result && result.persisted === false) {
        setText("#sync-status", "IMPORT HELD · STORAGE UNAVAILABLE");
      } else {
        var matchedCount = state.importDraft.matches ? state.importDraft.matches.reduce(function (count, match, index) { return count + (match && state.importDraft.selected[index] ? 1 : 0); }, 0) : 0;
        setText("#sync-status", "IMPORTED " + formatCount(selected) + " CONTACT" + (selected === 1 ? "" : "S") + (matchedCount ? " · " + formatCount(matchedCount) + " MATCHED" : ""));
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
    var candidate = { name: name, preferredName: data.get("preferredName"), role: data.get("role"), organisation: data.get("organisation"), location: data.get("location"), email: data.get("email"), phone: data.get("phone"), phoneOther: data.get("phoneOther"), whatsapp: data.get("whatsapp"), signal: data.get("signal"), instagram: data.get("instagram"), facebook: data.get("facebook"), website: data.get("website"), x: data.get("x"), socialProfiles: data.get("socialProfiles"), address: data.get("address"), workAddress: data.get("workAddress"), birthday: data.get("birthday"), interests: data.get("interests"), relationship: data.get("relationship"), note: data.get("note"), strength: data.get("strength"), sourceType: "manual" };
    if (state.editingId) {
      var existing = state.snapshot && state.snapshot.entities.filter(function (entity) { return String(entity.id) === String(state.editingId) && D.isPerson(entity); })[0];
      if (!existing) return;
      var stamp = new Date().toISOString(), updated = contactAttrs(candidate, "manual", String(D.attrs(existing).sourceRef || "manual:" + stamp), stamp), managed = ["preferredName", "role", "organisation", "location", "email", "phone", "phoneOther", "whatsapp", "signal", "instagram", "facebook", "website", "x", "socialProfiles", "address", "workAddress", "birthday", "interests", "relationship", "note", "strength"];
      managed.forEach(function (key) { if (Object.prototype.hasOwnProperty.call(updated, key)) existing.attrs[key] = updated[key]; else delete existing.attrs[key]; });
      existing.label = name;
      state.store.merge({ entities: [existing], links: [] });
      state.selectedId = String(existing.id);
      closeModal();
      render();
      openDossier(state.selectedId);
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
    $("#contact-file").addEventListener("change", function (event) { reviewImport(event.target.files && event.target.files[0]); event.target.value = ""; });
    $("#calendar-file").addEventListener("change", function (event) { reviewImport(event.target.files && event.target.files[0]); event.target.value = ""; });
    $$('[data-action="close-import"]').forEach(function (button) { button.addEventListener("click", closeImport); });
    $('[data-action="merge-import"]').addEventListener("click", mergeImport);
    $("#import-select-all").addEventListener("change", function (event) { if (!state.importDraft) return; state.importDraft.selected = state.importDraft.candidates.map(function () { return event.target.checked; }); renderImportPreview(); });
    $("#import-preview").addEventListener("change", function (event) { var index = event.target.getAttribute("data-import-index"); if (index == null || !state.importDraft) return; state.importDraft.selected[Number(index)] = event.target.checked; importSummary(state.importDraft.candidates); $("#import-select-all").checked = state.importDraft.selected.length > 0 && state.importDraft.selected.every(function (value) { return value; }); });
    $$('[data-action="close-modal"]').forEach(function (button) { button.addEventListener("click", closeModal); });
    $$('[data-action="close-record"]').forEach(function (button) { button.addEventListener("click", closeRecord); });
    $('[data-action="add-context"]').addEventListener("click", function () { openRecord("fact"); });
    $('[data-action="log-interaction"]').addEventListener("click", function () { openRecord("interaction"); });
    $('[data-action="edit-person"]').addEventListener("click", function () { if (state.selectedId) openModal(state.selectedId); });
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
    $$('[data-action="recycle-bin"]').forEach(function (button) { button.addEventListener("click", openRecycleBin); });
    $$('[data-action="close-recycle"]').forEach(function (button) { button.addEventListener("click", closeRecycleBin); });
    var emptyBin = $('[data-action="empty-bin"]'); if (emptyBin) emptyBin.addEventListener("click", trashClear);
    var recycleList = $("#recycle-list"); if (recycleList) recycleList.addEventListener("click", function (event) { var t = event.target.closest("[data-restore],[data-purge]"); if (!t) return; if (t.hasAttribute("data-restore")) trashRestore(t.getAttribute("data-restore")); else trashPurge(t.getAttribute("data-purge")); });
    updateTrashButton();
    state.layout = loadLayout();
    setText("#layout-tool-label", layoutMeta(state.layout).label);
    applyBgTheme(loadBgTheme());
    $$('[data-action="remove-edge"]').forEach(function (button) { button.addEventListener("click", removeSelectedEdge); });
    $$('[data-action="close-edge"]').forEach(function (button) { button.addEventListener("click", clearEdgeSelection); });
    $('[data-action="opportunities"]').addEventListener("click", function (event) { state.opportunityMode = !state.opportunityMode; event.currentTarget.setAttribute("aria-pressed", String(state.opportunityMode)); setText("#network-mode", state.opportunityMode ? "OPPORTUNITY VIEW" : "ORBIT VIEW"); render(); });
    $("#network-search").addEventListener("input", function (event) { state.query = event.target.value; render(); });
    $("#person-form").addEventListener("submit", function (event) { event.preventDefault(); addPerson(event.currentTarget); });
    $("#record-form").addEventListener("submit", function (event) { event.preventDefault(); addRecord(event.currentTarget); });
    $("#strength-input").addEventListener("input", function (event) { setText("#strength-value", event.target.value); });
    $$('[data-profile-tab]').forEach(function (button) { button.addEventListener("click", function () { setProfileTab(button.getAttribute("data-profile-tab")); }); });
    if (A && A.onChange) A.onChange(function (account) { if (account) { showWorkspace(account); } else if (state.workspaceStarted) { state.workspaceStarted = false; showAuth("signin"); } });
    document.addEventListener("click", function (event) {
      if (ctxMenuEl && !ctxMenuEl.contains(event.target)) closeCtxMenu();
      if (iconPickerEl && !iconPickerEl.contains(event.target)) closeIconPicker();
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
      if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !visibleModal() && state.selectedId) {
        var atag = document.activeElement ? document.activeElement.tagName : "";
        if (atag !== "INPUT" && atag !== "TEXTAREA" && atag !== "SELECT") { event.preventDefault(); cycleConnection(event.key === "ArrowLeft" ? -1 : 1); return; }
      }
      if (event.key !== "Escape") return;
      if (iconPickerEl) { closeIconPicker(); return; }
      if (ctxMenuEl) { closeCtxMenu(); return; }
      if (Object.keys(state.selectedIds).length) { clearSelectedIds(); return; }
      if (state.linkFrom) { endLinkFrom(); return; }
      if (state.selectedEdge) { clearEdgeSelection(); return; }
      var empty = $("#network-empty");
      if (empty && !empty.hidden && !visibleModal()) { dismissEmpty(); return; }
      closeModal(); closeRecord(); closeVault(); closeImport(); closeAccountModal(); closeConnections(); closeRecycleBin(); closeDossier();
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
