/* evidence.js — why Orbit believes what it shows.
 *
 * Two questions a network tool should always be able to answer: where did this
 * detail come from, and why is this number what it is. The store already keeps
 * an assertion behind every imported value; this reads it back out, and falls
 * back to the record's own source markings when a value was typed in by hand.
 *
 * Nothing here changes a score. It explains the one already being shown, which
 * is the only honest kind of explanation.
 *
 * Browser: window.OrbitEvidence. Node: module.exports.
 */
(function (root) {
  "use strict";

  function text(value) { return value == null ? "" : String(value); }
  function lower(value) { return text(value).toLowerCase(); }
  function attrs(entity) { return (entity && entity.attrs) || {}; }

  var SOURCE_LABELS = {
    "manual": "Typed in by you",
    "user-entered": "Typed in by you",
    "csv-import": "A spreadsheet you imported",
    "vcard-import": "A vCard you imported",
    "json-import": "A JSON export you imported",
    "instagram-import": "An Instagram list you imported",
    "google-contacts": "Google Contacts",
    "gmail-import": "Your Gmail history",
    "calendar-import": "A calendar you imported",
    "facebook-import": "A Facebook export you imported"
  };
  function sourceLabel(value) {
    var key = lower(value).trim();
    if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
    if (!key || key === "unknown") return "Source not recorded";
    return text(value).replace(/-import$/, "").replace(/^\w/, function (c) { return c.toUpperCase(); });
  }

  /* Fields worth accounting for; bookkeeping is not evidence. */
  var HIDDEN = { sourceType: 1, sourceRef: 1, provenance: 1, observedAt: 1, entityKind: 1, photo: 1, icon: 1, ring: 1, tags: 1, isMe: 1 };
  var LABELS = {
    email: "Email", phone: "Phone", phoneOther: "Other phone", whatsapp: "WhatsApp", signal: "Signal",
    instagram: "Instagram", facebook: "Facebook", x: "X", website: "Website", tiktok: "TikTok",
    address: "Home address", workAddress: "Work address", role: "Role", organisation: "Organisation",
    location: "Location", birthday: "Birthday", interests: "Interests", relationship: "How you know them",
    note: "Note", preferredName: "Also known as", strength: "Relationship strength",
    emailTotal: "Emails counted", emailSent: "Emails you sent", emailReceived: "Emails received", emailLastAt: "Last email"
  };
  function fieldLabel(key) { return LABELS[key] || text(key).replace(/([A-Z])/g, " $1").replace(/^\w/, function (c) { return c.toUpperCase(); }); }

  /* One row per value Orbit holds, with where it came from and when. */
  function provenance(entity) {
    var a = attrs(entity), asserted = (entity && entity.assertions) || {}, out = [];
    var fallbackSource = text(entity && entity.source) || text(a.sourceType);
    var fallbackAt = text(a.observedAt);
    Object.keys(a).forEach(function (key) {
      if (HIDDEN[key]) return;
      var value = a[key];
      if (value == null || value === "" || (Array.isArray(value) && !value.length)) return;
      var claims = asserted[key];
      if (claims && claims.length) {
        claims.forEach(function (claim) {
          out.push({
            key: key, label: fieldLabel(key), value: text(claim.value),
            source: sourceLabel(claim.surface || claim.assertedBy), at: text(claim.assertedAt),
            count: claim.count || 1, asserted: true
          });
        });
        return;
      }
      out.push({
        key: key, label: fieldLabel(key), value: Array.isArray(value) ? value.join(", ") : text(value),
        source: sourceLabel(fallbackSource), at: fallbackAt, count: 1, asserted: false
      });
    });
    /* Most recently learned first; anything undated sinks to the bottom. */
    out.sort(function (x, y) {
      var a1 = Date.parse(x.at), b1 = Date.parse(y.at);
      if (isNaN(a1) && isNaN(b1)) return x.label.localeCompare(y.label);
      if (isNaN(a1)) return 1;
      if (isNaN(b1)) return -1;
      return b1 - a1 || x.label.localeCompare(y.label);
    });
    return out;
  }

  /* Where a relationship score comes from, in the terms that produced it.
   * context: { degree, explicitStrength, emailTotal, lastAt, now, follow, groupSize, sharedGroups } */
  function scoreBreakdown(score, context) {
    context = context || {};
    var parts = [];
    if (context.explicitStrength != null && context.explicitStrength !== "") {
      parts.push({ label: "You set this yourself", detail: "Strength " + Math.round(Number(context.explicitStrength)) + " of 100", weight: "set" });
    } else {
      var degree = Number(context.degree || 0);
      parts.push({
        label: degree ? (degree === 1 ? "1 relationship drawn" : degree + " relationships drawn") : "No relationships drawn yet",
        detail: degree ? "Each connection raises the score" : "The score starts low until the chart says otherwise",
        weight: degree ? "+" : "0"
      });
    }
    var total = Number(context.emailTotal || 0);
    if (total) parts.push({ label: total === 1 ? "1 email exchanged" : total + " emails exchanged", detail: "Counted from your mailbox", weight: "+" });
    if (context.lastAt) {
      var days = Math.max(0, Math.round((Number(context.now || Date.now()) - Number(context.lastAt)) / 86400000));
      parts.push({
        label: days === 0 ? "In touch today" : (days === 1 ? "In touch yesterday" : "Last in touch " + days + " days ago"),
        detail: days > 180 ? "Long enough that the relationship reads as quiet" : "Recent contact keeps a relationship warm",
        weight: days > 180 ? "-" : "+"
      });
    } else {
      parts.push({ label: "No dated contact recorded", detail: "Import a mailbox or log an interaction to change this", weight: "0" });
    }
    if (context.follow) parts.push({ label: context.follow, detail: "From an Instagram list you imported", weight: "+" });
    if (context.sharedGroups) parts.push({ label: context.sharedGroups + (context.sharedGroups === 1 ? " shared connection" : " shared connections"), detail: "People you both know", weight: "+" });
    return { score: Math.round(Number(score) || 0), parts: parts };
  }

  var api = { provenance: provenance, scoreBreakdown: scoreBreakdown, sourceLabel: sourceLabel, fieldLabel: fieldLabel };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitEvidence = api;
})(typeof window !== "undefined" ? window : globalThis);
