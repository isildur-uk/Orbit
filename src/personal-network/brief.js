/* brief.js — the network, written down.
 *
 * Turns everything Orbit knows into one self-contained page you can read away
 * from the chart: who holds the network together, which groups exist, who has
 * gone quiet, what the evidence suggests you have not drawn yet.
 *
 * Pure: it takes a prepared model and returns a string. No DOM, no fetching,
 * nothing but text in and text out, so it can be asserted like any other
 * calculation.
 *
 * Browser: window.OrbitBrief. Node: module.exports.
 */
(function (root) {
  "use strict";

  function text(value) { return value == null ? "" : String(value); }
  function esc(value) {
    return text(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function count(n) { return Number(n || 0).toLocaleString("en-GB"); }
  function plural(n, one, many) { return count(n) + " " + (Number(n) === 1 ? one : (many || one + "s")); }
  function day(value) {
    var when = Date.parse(text(value));
    if (isNaN(when)) return "";
    var d = new Date(when);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function section(title, body, note) {
    if (!body) return "";
    return '<section><h2>' + esc(title) + "</h2>" + (note ? '<p class="note">' + esc(note) + "</p>" : "") + body + "</section>";
  }
  function list(items) {
    if (!items || !items.length) return "";
    return "<ul>" + items.map(function (item) { return "<li>" + item + "</li>"; }).join("") + "</ul>";
  }
  function table(headings, rows) {
    if (!rows || !rows.length) return "";
    return '<table><thead><tr>' + headings.map(function (h) { return "<th>" + esc(h) + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.map(function (row) {
        return "<tr>" + row.map(function (cell, i) { return '<td' + (i ? ' class="num"' : "") + ">" + cell + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
  }
  function strong(value) { return "<strong>" + esc(value) + "</strong>"; }

  /* model: { owner, generatedAt, stats, groups, bridges, cold, mostEmailed,
   *          recent, shared, suggestions, sources, tags } */
  function render(model) {
    model = model || {};
    var stats = model.stats || {};
    var parts = [];

    parts.push(section("At a glance", table(
      ["", "Count"],
      [
        ["People", count(stats.people)],
        ["Relationships", count(stats.relationships)],
        ["Groups that hold together without you", count((model.groups || []).length)],
        ["People who bridge the network", count((model.bridges || []).length)],
        ["Overdue to contact", count((model.cold || []).length)],
        ["Relationships the evidence suggests", count((model.suggestions || []).length)]
      ]
    )));

    parts.push(section("The shape of it", list((model.groups || []).slice(0, 12).map(function (group) {
      return strong(group.name) + " — " + plural(group.size, "person", "people") +
        (group.sample && group.sample.length ? '<span class="muted"> · ' + esc(group.sample.join(", ")) + (group.size > group.sample.length ? ", …" : "") + "</span>" : "");
    })), "A group is a set of people who reach each other without going through you."));

    parts.push(section("Who holds it together", list((model.bridges || []).slice(0, 10).map(function (row) {
      return strong(row.name) + '<span class="muted"> — without them the network falls into ' + count(row.splitsInto) + " pieces</span>";
    })), "Remove one of these people and part of your network stops being connected to the rest."));

    parts.push(section("Going quiet", table(["Person", "Days overdue"], (model.cold || []).slice(0, 15).map(function (row) {
      return [strong(row.name) + (row.ring ? '<span class="muted"> · ' + esc(row.ring) + "</span>" : ""), count(row.days)];
    })), "Each ring has its own allowance before a relationship is worth a nudge."));

    parts.push(section("Most correspondence", table(["Person", "Emails"], (model.mostEmailed || []).slice(0, 15).map(function (row) {
      return [strong(row.name) + (row.lastAt ? '<span class="muted"> · last ' + esc(day(row.lastAt)) + "</span>" : ""), count(row.total)];
    }))));

    parts.push(section("Recently", list((model.recent || []).slice(0, 20).map(function (row) {
      return '<span class="muted">' + esc(day(row.date)) + "</span> — " + esc(row.title) +
        (row.who ? '<span class="muted"> · ' + esc(row.who) + "</span>" : "");
    }))));

    parts.push(section("Identifiers held by more than one person", list((model.shared || []).slice(0, 15).map(function (row) {
      return strong(row.value) + '<span class="muted"> — ' + esc(row.kind) + " · " + esc(row.who.join(", ")) + "</span>";
    })), "The same number or address on two records is either a household, a workplace, or the same person twice."));

    parts.push(section("Suggested relationships", list((model.suggestions || []).slice(0, 20).map(function (row) {
      return strong(row.a) + " ↔ " + strong(row.b) + '<span class="muted"> — ' + esc(row.why) + "</span>";
    })), "Not drawn on the chart. Each one is what the evidence already implies."));

    parts.push(section("Where this came from", list((model.sources || []).map(function (row) {
      return strong(row.label) + '<span class="muted"> — ' + plural(row.count, "record") + "</span>";
    }))));

    var body = parts.filter(Boolean).join("");
    return '<article class="orbit-brief">' +
      "<header><h1>" + esc(model.owner || "Your network") + "</h1>" +
      '<p class="note">Written ' + esc(day(model.generatedAt) || day(new Date().toISOString())) +
      " · everything here was worked out on your own machine from your own records.</p></header>" +
      body + "</article>";
  }

  /* A whole page, styled, ready to be saved and opened anywhere. */
  function page(model) {
    return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
      "<title>" + esc((model && model.owner) || "Your network") + " · Orbit brief</title>" +
      "<style>" +
      ":root{color-scheme:dark}" +
      "body{margin:0;padding:48px 24px;background:#111211;color:#e8e8e8;font:15px/1.6 'Inter',system-ui,sans-serif}" +
      ".orbit-brief{max-width:760px;margin:0 auto}" +
      "h1{font-size:34px;letter-spacing:-.03em;margin:0 0 6px;font-weight:500}" +
      "h2{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#da291c;font-weight:500;margin:40px 0 12px}" +
      "header .note{margin:0 0 8px}" +
      ".note{color:#8a8a8a;font-size:12px;margin:0 0 14px}" +
      ".muted{color:#8a8a8a}" +
      "ul{list-style:none;margin:0;padding:0}" +
      "li{padding:7px 0;border-top:1px solid rgba(255,255,255,.08)}" +
      "li:first-child{border-top:0}" +
      "table{width:100%;border-collapse:collapse}" +
      "th{text-align:left;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#8a8a8a;font-weight:500;padding:0 0 8px}" +
      "th:last-child,.num{text-align:right;font-variant-numeric:tabular-nums}" +
      "td{padding:7px 0;border-top:1px solid rgba(255,255,255,.08)}" +
      "strong{font-weight:500}" +
      "</style></head><body>" + render(model) + "</body></html>";
  }

  var api = { render: render, page: page };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitBrief = api;
})(typeof window !== "undefined" ? window : globalThis);
