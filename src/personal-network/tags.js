/* tags.js — free-text tags people can be given, and the colour each one wears.
 *
 * Pure and side-effect free, so the graph, the tag bar, the layout and the
 * importer all agree on what a tag is. A tag is a short label the user invents
 * ("cycling", "work", "uni"); its colour is derived from the text itself, so the
 * same tag is the same colour on every device with nothing to store or pick.
 *
 * Browser: window.OrbitTags. Node: module.exports.
 */
(function (root) {
  "use strict";

  var MAX_LENGTH = 28;
  /* Ten colours that hold up on Orbit's near-black canvas and stay clear of the
   * Rosso Corsa accent (reserved for you and for opportunities) and the gold
   * that already marks an organisation. */
  var PALETTE = [
    "#5b9bd5", "#4fb286", "#d98c3f", "#a97bd6", "#4bb1c4",
    "#c96b8f", "#8fa842", "#d4a03c", "#7b8fd6", "#c4705a"
  ];

  function text(value) { return value == null ? "" : String(value); }
  /* One tag: trimmed, inner whitespace collapsed, length-capped. Commas and
   * semicolons cannot survive inside a tag — they are the separators. */
  function clean(value) {
    return text(value).replace(/[;,]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
  }
  function key(value) { return clean(value).toLowerCase(); }

  /* Accepts what the store, a form field or an importer might hold: an array, a
   * comma/semicolon separated string, or nothing. Returns clean, de-duplicated
   * tags in the order first seen. */
  function parse(value) {
    var raw = Array.isArray(value) ? value : text(value).split(/[;,\n]/);
    var seen = Object.create(null), out = [];
    raw.forEach(function (item) {
      var tag = clean(item);
      if (!tag) return;
      var k = tag.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(tag);
    });
    return out;
  }
  function format(value) { return parse(value).join(", "); }
  function has(value, tag) {
    var k = key(tag);
    return !!k && parse(value).some(function (item) { return item.toLowerCase() === k; });
  }
  function add(value, tag) { return parse(parse(value).concat([tag])); }
  function remove(value, tag) {
    var k = key(tag);
    return parse(value).filter(function (item) { return item.toLowerCase() !== k; });
  }
  function toggle(value, tag) { return has(value, tag) ? remove(value, tag) : add(value, tag); }

  /* Stable colour per tag: the same text always lands on the same swatch. */
  function colour(tag) {
    var k = key(tag), hash = 0;
    for (var i = 0; i < k.length; i++) hash = (hash * 31 + k.charCodeAt(i)) >>> 0;
    return PALETTE[hash % PALETTE.length];
  }

  /* Every tag in use, most-used first then alphabetical, with its count. */
  function census(entities, tagsOf) {
    var read = typeof tagsOf === "function" ? tagsOf : function (e) { return e && e.attrs ? e.attrs.tags : null; };
    var counts = Object.create(null), labels = Object.create(null);
    (entities || []).forEach(function (entity) {
      parse(read(entity)).forEach(function (tag) {
        var k = tag.toLowerCase();
        counts[k] = (counts[k] || 0) + 1;
        if (!labels[k]) labels[k] = tag;
      });
    });
    return Object.keys(counts).map(function (k) {
      return { tag: labels[k], key: k, count: counts[k], colour: colour(k) };
    }).sort(function (a, b) { return b.count - a.count || a.key.localeCompare(b.key); });
  }

  var api = {
    MAX_LENGTH: MAX_LENGTH, PALETTE: PALETTE.slice(),
    clean: clean, key: key, parse: parse, format: format,
    has: has, add: add, remove: remove, toggle: toggle,
    colour: colour, census: census
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitTags = api;
})(typeof window !== "undefined" ? window : globalThis);
