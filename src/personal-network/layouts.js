/* ORBIT Personal Network — graph layout maths.
 *
 * Mirrors the arrangement options SOLAR's charting view offers, ported to plain,
 * testable functions. Each layout takes a node list ({id, label, group}) and a
 * link list ({from, to}) and returns { positions: {id:{x,y}} | null, physics }.
 * positions=null with physics=true means "let the physics engine settle it"
 * (the Force layout); every other layout computes explicit coordinates and the
 * caller pins the nodes with physics off. The app keeps its own "orbit" (rings)
 * and "free" layouts; this module supplies the rest.
 */
(function (root) {
  "use strict";

  function labelOf(node) { return String(node.label || node.id || ""); }
  function buildAdj(nodes, links) {
    var adj = Object.create(null);
    nodes.forEach(function (node) { adj[node.id] = []; });
    var seen = Object.create(null);
    (links || []).forEach(function (link) {
      var a = String(link.from), b = String(link.to);
      if (a === b || !(a in adj) || !(b in adj)) return;
      var key = a < b ? a + "|" + b : b + "|" + a;
      if (seen[key]) return;
      seen[key] = true;
      adj[a].push(b); adj[b].push(a);
    });
    return adj;
  }
  function byDegreeThenLabel(adj) {
    return function (a, b) {
      var d = adj[b.id].length - adj[a.id].length;
      return d !== 0 ? d : labelOf(a).localeCompare(labelOf(b));
    };
  }
  function placeLooseRow(loose, pos, y, stepX) {
    var n = loose.length; if (!n) return;
    var startX = -((n - 1) * stepX) / 2;
    loose.forEach(function (id, i) { pos[id] = { x: Math.round(startX + i * stepX), y: Math.round(y) }; });
  }

  /* Peacock — radial hub-and-spoke. Highly connected people become hubs on a
   * ring; each hub's exclusive contacts fan out in an arc; contacts shared
   * between hubs sit between them; unconnected people go in a foot row. */
  function peacock(nodes, links, compact) {
    var adj = buildAdj(nodes, links);
    var sorted = nodes.slice().sort(byDegreeThenLabel(adj));
    var HUB_MIN = 3;
    var hubs = sorted.filter(function (n) { return adj[n.id].length >= HUB_MIN; });
    if (!hubs.length) hubs = sorted.slice(0, Math.max(1, Math.round(sorted.length / 8)));
    var isHub = Object.create(null); hubs.forEach(function (h) { isHub[h.id] = true; });
    var owned = Object.create(null); hubs.forEach(function (h) { owned[h.id] = []; });
    var shared = [], loose = [];
    nodes.forEach(function (n) {
      if (isHub[n.id]) return;
      var touching = hubs.filter(function (h) { return adj[n.id].indexOf(h.id) !== -1; });
      if (!touching.length) loose.push(n.id);
      else if (touching.length === 1) owned[touching[0].id].push(n.id);
      else shared.push({ id: n.id, hubs: touching.map(function (h) { return h.id; }) });
    });
    var pos = Object.create(null);
    var SPOKE = compact ? 74 : 96;
    var fanR = Object.create(null);
    hubs.forEach(function (h) { fanR[h.id] = Math.max(compact ? 96 : 130, (owned[h.id].length * SPOKE) / (2 * Math.PI)); });
    var need = 0; hubs.forEach(function (h) { need += fanR[h.id] * 2 + (compact ? 60 : 90); });
    var hubR = hubs.length === 1 ? 0 : Math.max(compact ? 220 : 320, need / (2 * Math.PI));
    var hubPos = Object.create(null);
    hubs.forEach(function (h, i) {
      var th = hubs.length === 1 ? 0 : (i / hubs.length) * Math.PI * 2 - Math.PI / 2;
      var p = { x: Math.round(Math.cos(th) * hubR), y: Math.round(Math.sin(th) * hubR) };
      hubPos[h.id] = p; pos[h.id] = p;
      var members = owned[h.id];
      var base = hubs.length === 1 ? -Math.PI / 2 : Math.atan2(p.y, p.x);
      members.forEach(function (m, mi) {
        var span = Math.PI * (members.length <= 2 ? 0.9 : 1.55);
        var t = members.length === 1 ? base : base - span / 2 + (mi / (members.length - 1)) * span;
        pos[m] = { x: Math.round(p.x + Math.cos(t) * fanR[h.id]), y: Math.round(p.y + Math.sin(t) * fanR[h.id]) };
      });
    });
    shared.forEach(function (item, idx) {
      var cx = 0, cy = 0;
      item.hubs.forEach(function (hid) { cx += hubPos[hid].x; cy += hubPos[hid].y; });
      cx /= item.hubs.length; cy /= item.hubs.length;
      pos[item.id] = { x: Math.round(cx + ((idx % 5) * 18 - 36)), y: Math.round(cy + ((idx % 3) * 16 - 16)) };
    });
    placeLooseRow(loose, pos, hubR + (compact ? 180 : 240), compact ? 90 : 120);
    return { positions: pos, physics: false };
  }

  /* Grouped — one cluster per group (entity kind), centres spread on a ring,
   * members in a small sub-circle around each centre. */
  function grouped(nodes) {
    var byType = Object.create(null);
    nodes.forEach(function (n) { var t = String(n.group || "other"); (byType[t] = byType[t] || []).push(n); });
    var types = Object.keys(byType).sort();
    var ringR = Math.max(260, 90 * types.length);
    var pos = Object.create(null);
    types.forEach(function (t, ti) {
      var th = (ti / types.length) * Math.PI * 2 - Math.PI / 2;
      var cx = types.length === 1 ? 0 : Math.cos(th) * ringR, cy = types.length === 1 ? 0 : Math.sin(th) * ringR;
      var members = byType[t];
      var r2 = Math.max(46, 26 * Math.sqrt(members.length) * 1.6);
      members.forEach(function (n, mi) {
        if (members.length === 1) { pos[n.id] = { x: Math.round(cx), y: Math.round(cy) }; return; }
        var th2 = (mi / members.length) * Math.PI * 2;
        pos[n.id] = { x: Math.round(cx + Math.cos(th2) * r2), y: Math.round(cy + Math.sin(th2) * r2) };
      });
    });
    return { positions: pos, physics: false };
  }

  /* Circle — every node evenly spaced on one ring, sorted by group then label. */
  function circle(nodes) {
    var R = Math.max(160, 36 * Math.sqrt(nodes.length) * 2);
    var sorted = nodes.slice().sort(function (a, b) {
      return (String(a.group || "") + labelOf(a)).localeCompare(String(b.group || "") + labelOf(b));
    });
    var pos = Object.create(null);
    sorted.forEach(function (n, i) {
      var th = (i / sorted.length) * Math.PI * 2 - Math.PI / 2;
      pos[n.id] = { x: Math.round(Math.cos(th) * R), y: Math.round(Math.sin(th) * R) };
    });
    return { positions: pos, physics: false };
  }

  /* Grid — square-ish lattice, most connected first, centred on the origin. */
  function grid(nodes, links) {
    var adj = buildAdj(nodes, links);
    var ordered = nodes.slice().sort(byDegreeThenLabel(adj));
    var STEP = 170;
    var cols = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
    var rowsN = Math.max(1, Math.ceil(ordered.length / cols));
    var offX = (cols - 1) / 2 * STEP, offY = (rowsN - 1) / 2 * STEP;
    var pos = Object.create(null);
    ordered.forEach(function (n, i) {
      pos[n.id] = { x: Math.round((i % cols) * STEP - offX), y: Math.round(Math.floor(i / cols) * STEP - offY) };
    });
    return { positions: pos, physics: false };
  }

  /* Tree — BFS spanning forest from the most-connected roots, leaves take the
   * next column, parents centre over their children, whole forest centred. */
  function hierarchy(nodes, links) {
    var adj = buildAdj(nodes, links);
    var order = nodes.slice().sort(byDegreeThenLabel(adj));
    var COLW = 190, ROWH = 165;
    var visited = Object.create(null), children = Object.create(null), isChild = Object.create(null);
    nodes.forEach(function (n) { children[n.id] = []; });
    order.forEach(function (rootN) {
      if (visited[rootN.id]) return;
      visited[rootN.id] = true;
      var queue = [rootN.id];
      while (queue.length) {
        var cur = queue.shift();
        adj[cur].forEach(function (nb) { if (!visited[nb]) { visited[nb] = true; children[cur].push(nb); isChild[nb] = true; queue.push(nb); } });
      }
    });
    var roots = order.filter(function (n) { return !isChild[n.id]; }).map(function (n) { return n.id; });
    var pos = Object.create(null), nextX = 0, depthMax = 0;
    function place(id, d) {
      depthMax = Math.max(depthMax, d);
      var kids = children[id];
      if (!kids.length) { pos[id] = { x: nextX * COLW, y: d * ROWH }; nextX += 1; return pos[id].x; }
      var xs = kids.map(function (k) { return place(k, d + 1); });
      var cx = (xs[0] + xs[xs.length - 1]) / 2;
      pos[id] = { x: cx, y: d * ROWH };
      return cx;
    }
    roots.forEach(function (r) { place(r, 0); nextX += 1; });
    var xs = Object.keys(pos).map(function (k) { return pos[k].x; });
    if (xs.length) {
      var midX = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, midY = depthMax * ROWH / 2;
      Object.keys(pos).forEach(function (k) { pos[k] = { x: Math.round(pos[k].x - midX), y: Math.round(pos[k].y - midY) }; });
    }
    return { positions: pos, physics: false };
  }

  var KINDS = {
    peacock: function (n, l) { return peacock(n, l, false); },
    "peacock-compact": function (n, l) { return peacock(n, l, true); },
    grouped: function (n) { return grouped(n); },
    circle: function (n) { return circle(n); },
    grid: function (n, l) { return grid(n, l); },
    hierarchy: function (n, l) { return hierarchy(n, l); },
    force: function () { return { positions: null, physics: true }; }
  };
  /* Returns null for kinds the app owns ("orbit", "free"), so the caller keeps
   * its existing behaviour for those. */
  function compute(kind, nodes, links) {
    var fn = KINDS[kind];
    if (!fn) return null;
    return fn(nodes || [], links || []);
  }
  function has(kind) { return !!KINDS[kind]; }

  var api = { compute: compute, has: has, buildAdj: buildAdj, kinds: Object.keys(KINDS) };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitLayouts = api;
})(typeof window !== "undefined" ? window : globalThis);
