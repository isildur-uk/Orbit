/* icons.js — glyph node chips for the network graph.
 *
 * Ported from SOLAR's charting icon model (src/_shared/shell/icons.js): a
 * code-owned library of Lucide-based SVG glyphs, each rendered as a dark circular
 * chip with a coloured ring, returned as a data URI for vis-network image nodes.
 * Only the subset a personal address book needs — people and organisations, plus
 * a few relationship markers (favourite, family, home) an entity can be overridden
 * to. No entity-supplied string is ever parsed as markup.
 *
 * Browser: window.OrbitIcons. Node: module.exports.
 */
(function (root) {
  "use strict";

  /* Lucide glyphs (ISC licence, lucide.dev), scaled into a 64×64 chip exactly as
   * SOLAR does: a 24px icon at translate(14 14) scale(1.5). */
  function L(inner) { return '<g transform="translate(14 14) scale(1.5)" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</g>'; }
  var GLYPHS = {
    person: L('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    people: L('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    organisation: L('<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>'),
    favourite: L('<path d="M11.5 2.7 14 7.8l5.6.8-4 4 1 5.6-5-2.7-5 2.7 1-5.6-4-4 5.6-.8Z"/>'),
    family: L('<path d="M8 21v-3a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v3"/><circle cx="12" cy="8.5" r="3"/><path d="M4 21v-2a2.5 2.5 0 0 1 2-2.45"/><path d="M20 21v-2a2.5 2.5 0 0 0-2-2.45"/>'),
    home: L('<path d="M3 9.5 12 3l9 6.5V21H3z"/><path d="M9 21v-6h6v6"/>'),
    work: L('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    /* An address with no name behind it yet — an import that arrived as an
     * email and nothing else. Drawing those as people overstates what is known. */
    mail: L('<rect x="2" y="4.5" width="20" height="15" rx="2"/><path d="m2.6 6 8.3 6.2a2 2 0 0 0 2.2 0L21.4 6"/>')
  };

  function chip(key, opts) {
    opts = opts || {};
    var glyph = GLYPHS[key] || GLYPHS.person;
    var bg = opts.bg || "#242424";
    var ring = opts.ring || "#8a8a8a";
    var ringWidth = opts.ringWidth || 3;
    var glyphColour = opts.glyph || "#e8e8e8";
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
      + '<circle cx="32" cy="32" r="' + (30 - ringWidth / 2) + '" fill="' + bg + '" stroke="' + ring + '" stroke-width="' + ringWidth + '"/>'
      + '<g stroke="' + glyphColour + '">' + glyph + '</g>'
      + '</svg>';
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }

  function defaultKey(entityKind) {
    if (entityKind === "organisation" || entityKind === "generic-inbox") return "organisation";
    if (entityKind === "unknown" || entityKind === "email") return "mail";
    return "person";
  }

  /* Ordered for the picker: the two defaults first, then override markers. */
  var CATALOGUE = ["person", "people", "organisation", "mail", "favourite", "family", "home", "work"];
  var LABELS = { person: "Person", people: "Group", organisation: "Organisation", mail: "Email only", favourite: "Favourite", family: "Family", home: "Home", work: "Work" };

  var api = { GLYPHS: GLYPHS, chip: chip, defaultKey: defaultKey, catalogue: CATALOGUE, labels: LABELS, has: function (k) { return Object.prototype.hasOwnProperty.call(GLYPHS, k); } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitIcons = api;
})(typeof window !== "undefined" ? window : globalThis);
