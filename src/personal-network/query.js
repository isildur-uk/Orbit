/* query.js — asking the network a precise question.
 *
 * Turns a search box into a small, honest query language. Plain words still
 * match anything; a prefix narrows to one field:
 *
 *   tag:cycling            a tag
 *   org:acme               organisation
 *   domain:acme.com        email domain
 *   is:social              what kind of record it is
 *   has:phone              what Orbit actually holds
 *   in:"school friends"    a named group
 *   since:2026-01          contact since a date        until:2026-06
 *   emails:>10             how much email there has been
 *   -tag:work              anything can be negated
 *
 * Terms narrow together. Unknown prefixes are treated as plain words rather
 * than silently matching nothing.
 *
 * Browser: window.OrbitQuery. Node: module.exports.
 */
(function (root) {
  "use strict";

  var FIELDS = { tag: 1, org: 1, domain: 1, is: 1, has: 1, "in": 1, since: 1, until: 1, emails: 1, name: 1 };

  function text(value) { return value == null ? "" : String(value); }
  function lower(value) { return text(value).toLowerCase().trim(); }

  /* Split on spaces, but keep "quoted phrases" whole. */
  function tokenise(input) {
    var out = [], buffer = "", quoted = false;
    var raw = text(input);
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (ch === '"') { quoted = !quoted; continue; }
      if (/\s/.test(ch) && !quoted) { if (buffer) out.push(buffer); buffer = ""; continue; }
      buffer += ch;
    }
    if (buffer) out.push(buffer);
    return out;
  }

  function parse(input) {
    return tokenise(input).map(function (token) {
      var negated = token.charAt(0) === "-";
      var body = negated ? token.slice(1) : token;
      var colon = body.indexOf(":");
      if (colon > 0) {
        var field = lower(body.slice(0, colon));
        if (FIELDS[field]) return { field: field, value: body.slice(colon + 1), negated: negated };
      }
      return { field: "text", value: body, negated: negated };
    }).filter(function (term) { return term.value !== ""; });
  }

  function asDate(value) {
    var raw = lower(value);
    /* A bare year or year-month means the start of it. */
    if (/^\d{4}$/.test(raw)) raw = raw + "-01-01";
    else if (/^\d{4}-\d{1,2}$/.test(raw)) raw = raw.replace(/-(\d)$/, "-0$1") + "-01";
    var when = Date.parse(raw);
    return isNaN(when) ? null : when;
  }
  function compare(value, expression) {
    var m = /^([<>]=?|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(lower(expression));
    if (!m) return false;
    var target = Number(m[2]), actual = Number(value) || 0;
    switch (m[1]) {
      case ">": return actual > target;
      case ">=": return actual >= target;
      case "<": return actual < target;
      case "<=": return actual <= target;
      default: return actual === target;
    }
  }

  /* record: { name, tags:[], organisation, emails:[], kind, has:[], groups:[],
   *           lastAt:millis, emailTotal:number, haystack:"" } */
  function matchTerm(record, term) {
    var want = lower(term.value);
    switch (term.field) {
      case "tag": return (record.tags || []).some(function (t) { return lower(t) === want || lower(t).indexOf(want) === 0; });
      case "org": return lower(record.organisation).indexOf(want) !== -1 && !!want;
      case "domain": return (record.emails || []).some(function (e) { var at = lower(e).indexOf("@"); return at > 0 && lower(e).slice(at + 1).indexOf(want) === 0; });
      case "is": return lower(record.kind) === want || (want === "person" && ["individual", "person"].indexOf(lower(record.kind)) !== -1);
      case "has": return (record.has || []).some(function (h) { return lower(h) === want; });
      case "in": return (record.groups || []).some(function (g) { return lower(g) === want || lower(g).indexOf(want) !== -1; });
      case "since": var from = asDate(term.value); return from != null && !!record.lastAt && record.lastAt >= from;
      case "until": var to = asDate(term.value); return to != null && !!record.lastAt && record.lastAt <= to;
      case "emails": return compare(record.emailTotal, term.value);
      case "name": return lower(record.name).indexOf(want) !== -1;
      default: return lower(record.haystack).indexOf(want) !== -1;
    }
  }
  function matches(record, terms) {
    if (!terms || !terms.length) return true;
    return terms.every(function (term) {
      var hit = matchTerm(record || {}, term);
      return term.negated ? !hit : hit;
    });
  }
  /* What the query is actually asking, said back in words. */
  function describe(terms) {
    if (!terms || !terms.length) return "";
    return terms.map(function (term) {
      var body = term.field === "text" ? '"' + term.value + '"' : term.field + " " + term.value;
      return (term.negated ? "not " : "") + body;
    }).join(" and ");
  }
  function fields() { return Object.keys(FIELDS); }

  var api = { parse: parse, matches: matches, matchTerm: matchTerm, describe: describe, tokenise: tokenise, fields: fields };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitQuery = api;
})(typeof window !== "undefined" ? window : globalThis);
