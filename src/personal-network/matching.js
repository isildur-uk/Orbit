/* matching.js — duplicate detection for the review-before-merge step.
 *
 * Pure and side-effect free. It scores each incoming candidate against the
 * people already in the vault AND against earlier candidates in the same batch,
 * so two duplicate incoming records converge on one profile. Every flagged
 * match carries a human reason ("Same phone number", "Same name at Acme") so the
 * review screen can explain itself. Runs in the browser and in Node tests.
 *
 * Browser: window.OrbitContactMatching. Node: module.exports.
 */
(function (root) {
  "use strict";

  var Classify = (root && root.OrbitContactClassify) || null;
  if (!Classify && typeof require === "function") {
    try { Classify = require("./classify.js"); } catch (e) { Classify = null; }
  }

  function text(value) { return value == null ? "" : String(value); }
  function normaliseName(value) {
    var v = text(value).toLowerCase();
    v = v.normalize ? v.normalize("NFD").replace(/[̀-ͯ]/g, "") : v;
    return v.replace(/[^a-z0-9]+/g, " ").trim();
  }
  function normaliseEmails(value) {
    return text(value).toLowerCase().split(/[;,\s]+/).map(function (item) { return item.trim(); }).filter(function (item) { return item.indexOf("@") > 0; });
  }
  /* Last 10 digits so "+44 7700 900111", "07700 900111" and "447700900111"
   * collapse to one key. Anything shorter than 7 digits is too weak to match. */
  function normalisePhone(value) {
    var digits = text(value).replace(/\D/g, "");
    return digits.length >= 7 ? digits.slice(-10) : "";
  }
  function igHandle(value) {
    return text(value).replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/\/+$/, "").trim().toLowerCase();
  }
  function attrsOf(person) { return (person && person.attrs) || {}; }
  function labelOf(person) { return text(person && (person.label != null ? person.label : (attrsOf(person).name))); }
  function isGenericLocalPart(email) {
    if (!Classify || !Classify.GENERIC_LOCAL) return false;
    var at = text(email).toLowerCase().indexOf("@");
    return at > 0 ? Classify.GENERIC_LOCAL.test(text(email).toLowerCase().slice(0, at)) : false;
  }

  function candidateKeys(candidate) {
    return {
      emails: normaliseEmails(candidate.email),
      phone: normalisePhone(candidate.phone) || normalisePhone(candidate.phoneOther),
      name: normaliseName(candidate.name),
      organisation: normaliseName(candidate.organisation),
      sourceRef: text(candidate.sourceRef),
      instagram: igHandle(candidate.instagram),
      genericEmail: normaliseEmails(candidate.email).some(isGenericLocalPart)
    };
  }
  function personKeys(person) {
    var a = attrsOf(person);
    return {
      emails: normaliseEmails(a.email),
      phone: normalisePhone(a.phone) || normalisePhone(a.phoneOther),
      name: normaliseName(labelOf(person)),
      organisation: normaliseName(a.organisation),
      sourceRef: text(a.sourceRef),
      instagram: igHandle(a.instagram),
      genericEmail: normaliseEmails(a.email).some(isGenericLocalPart)
    };
  }

  /* Score one candidate against one person. Higher, more specific signals win,
   * and each contributes to the reason so the flag can be explained. */
  function score(ck, pk) {
    var s = 0, signals = [];
    /* Two social accounts are two people, whatever they call themselves — a
     * follower list is full of people sharing a first name. A shared handle is
     * the strongest evidence there is; different handles are proof they are not
     * the same account, and outrank every other similarity. */
    if (ck.instagram && pk.instagram) {
      if (ck.instagram !== pk.instagram) return { score: 0, signals: [] };
      s += 100; signals.push({ w: 100, why: "Same Instagram account" });
    }
    var sharedEmail = ck.emails.some(function (email) { return pk.emails.indexOf(email) !== -1; });
    if (sharedEmail) { s += 100; signals.push({ w: 100, why: "Same email address" }); }
    if (ck.sourceRef && ck.sourceRef === pk.sourceRef) { s += 100; signals.push({ w: 95, why: "Same source record" }); }
    if (ck.phone && ck.phone === pk.phone) { s += 90; signals.push({ w: 90, why: "Same phone number" }); }
    var sameOrg = ck.organisation && ck.organisation === pk.organisation;
    if (ck.name && ck.name === pk.name) {
      s += 55;
      signals.push({ w: sameOrg ? 80 : 60, why: sameOrg ? ("Same name at " + text(pk.organisation ? titleCase(pk.organisation) : "the same organisation")) : "Same name" });
    } else if (ck.name && pk.name && ck.name.split(" ").length > 1 && pk.name.indexOf(ck.name) !== -1) {
      s += 40;
      signals.push({ w: 40, why: "Closely matching name" });
    }
    if (sameOrg) s += 20;
    /* Two generic company inboxes at the same organisation are the same relationship. */
    if (sameOrg && ck.genericEmail && pk.genericEmail && !sharedEmail) {
      s += 40;
      signals.push({ w: 50, why: "Same organisation inbox" });
    }
    return { score: s, signals: signals };
  }
  function titleCase(value) { return text(value).replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

  function matchAgainst(candidate, people) {
    var ck = candidateKeys(candidate);
    if (!ck.emails.length && !ck.phone && !ck.name && !ck.sourceRef) return null;
    var ranked = (people || []).map(function (person) {
      var result = score(ck, personKeys(person));
      return { person: person, score: result.score, signals: result.signals };
    }).filter(function (item) { return item.score >= 55; }).sort(function (a, b) { return b.score - a.score; });
    if (!ranked.length) return null;
    var top = ranked[0];
    var reason = top.signals.slice().sort(function (a, b) { return b.w - a.w; }).map(function (s) { return s.why; })[0] || "Likely the same person";
    return { target: top.person, reason: reason, score: top.score };
  }

  /* One synthetic "person" per un-matched candidate, so a later duplicate in
   * the same batch can match it and both converge on one profile. */
  function synthetic(candidate) {
    return {
      id: "import:" + text(candidate.name || candidate.email),
      label: text(candidate.name || candidate.email),
      attrs: { email: candidate.email, phone: candidate.phone, phoneOther: candidate.phoneOther, organisation: candidate.organisation, sourceRef: candidate.sourceRef, instagram: candidate.instagram }
    };
  }

  /* Returns an array aligned to `candidates`: each element is null (no match) or
   * { target, reason, score } where target has a `.label`. */
  function computeMatches(candidates, people) {
    var existing = (people || []).slice(), seen = [], out = [];
    (candidates || []).forEach(function (candidate) {
      var match = matchAgainst(candidate, existing);
      if (!match) match = matchAgainst(candidate, seen);
      if (match) { out.push({ target: match.target, reason: match.reason, score: match.score }); }
      else { out.push(null); seen.push(synthetic(candidate)); }
    });
    return out;
  }

  /* Every pair of people already in the vault that looks like one person twice.
   * Reuses the same scorer the import review uses, so a duplicate found here is
   * a duplicate found there, with the same human reason attached. Each pair is
   * reported once, strongest first. */
  function duplicatePairs(people, minimumScore) {
    var list = (people || []).slice(), floor = minimumScore == null ? 55 : minimumScore, out = [];
    var keys = list.map(personKeys);
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        var result = score(keys[i], keys[j]);
        if (result.score < floor) continue;
        var reason = result.signals.slice().sort(function (a, b) { return b.w - a.w; }).map(function (s) { return s.why; })[0] || "Likely the same person";
        out.push({ a: list[i], b: list[j], score: result.score, reason: reason });
      }
    }
    return out.sort(function (x, y) {
      return y.score - x.score || labelOf(x.a).localeCompare(labelOf(y.a));
    });
  }

  var api = {
    computeMatches: computeMatches,
    duplicatePairs: duplicatePairs,
    matchAgainst: matchAgainst,
    normaliseName: normaliseName,
    normalisePhone: normalisePhone,
    normaliseEmails: normaliseEmails,
    igHandle: igHandle
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitContactMatching = api;
})(typeof window !== "undefined" ? window : globalThis);
