/* graph.js — what the shape of the network says.
 *
 * Pure, deterministic graph reasoning: which people form a group that holds
 * together without you, who is the single thread holding two parts together,
 * which identifiers are shared by more than one person, and which relationships
 * the evidence already implies but nobody has drawn yet.
 *
 * Every answer here is explainable — each one carries the reason it was given,
 * because a suggestion you cannot interrogate is just a guess with confidence.
 *
 * Browser: window.OrbitGraph. Node: module.exports.
 */
(function (root) {
  "use strict";

  function text(value) { return value == null ? "" : String(value); }
  function lower(value) { return text(value).toLowerCase(); }

  /* ---- adjacency ---- */
  function adjacency(ids, links, options) {
    options = options || {};
    var skip = Object.create(null);
    (options.without || []).forEach(function (id) { skip[text(id)] = true; });
    var allow = Object.create(null);
    ids.forEach(function (id) { if (!skip[text(id)]) allow[text(id)] = true; });
    var adj = Object.create(null);
    Object.keys(allow).forEach(function (id) { adj[id] = []; });
    (links || []).forEach(function (link) {
      var a = text(link && link.from), b = text(link && link.to);
      if (a === b || !allow[a] || !allow[b]) return;
      if (adj[a].indexOf(b) === -1) adj[a].push(b);
      if (adj[b].indexOf(a) === -1) adj[b].push(a);
    });
    Object.keys(adj).forEach(function (id) { adj[id].sort(); });
    return adj;
  }

  /* ---- Groups ----
   * A group is a set of people who reach each other WITHOUT going through you.
   * Everyone is connected to you by definition, so leaving yourself out is what
   * makes the answer mean something: these are the parts of your life that hold
   * together on their own. */
  function groups(ids, links, options) {
    options = options || {};
    var adj = adjacency(ids, links, { without: [options.centre].filter(Boolean) });
    var seen = Object.create(null), out = [];
    Object.keys(adj).sort().forEach(function (start) {
      if (seen[start]) return;
      var members = [], queue = [start];
      seen[start] = true;
      while (queue.length) {
        var current = queue.shift();
        members.push(current);
        adj[current].forEach(function (next) { if (!seen[next]) { seen[next] = true; queue.push(next); } });
      }
      members.sort();
      out.push({ members: members, size: members.length });
    });
    /* Bigger groups first; a lone person is a group of one and is reported as
     * such rather than silently dropped. */
    out.sort(function (a, b) { return b.size - a.size || a.members[0].localeCompare(b.members[0]); });
    return out;
  }

  /* ---- Bridges ----
   * Whose removal would split the network into pieces. Tarjan's articulation
   * points, run with you left out so the answer is about them and not about you. */
  function bridges(ids, links, options) {
    options = options || {};
    var adj = adjacency(ids, links, { without: [options.centre].filter(Boolean) });
    var order = Object.create(null), low = Object.create(null), parent = Object.create(null);
    var isCut = Object.create(null), counter = 0, keys = Object.keys(adj).sort();
    keys.forEach(function (start) {
      if (order[start] !== undefined) return;
      /* Iterative so a long chain cannot overflow the stack. */
      var stack = [{ node: start, index: 0 }], rootChildren = 0;
      order[start] = low[start] = counter++;
      parent[start] = null;
      while (stack.length) {
        var frame = stack[stack.length - 1], node = frame.node, neighbours = adj[node];
        if (frame.index < neighbours.length) {
          var next = neighbours[frame.index++];
          if (next === parent[node]) continue;
          if (order[next] === undefined) {
            parent[next] = node;
            order[next] = low[next] = counter++;
            if (node === start) rootChildren++;
            stack.push({ node: next, index: 0 });
          } else if (order[next] < low[node]) low[node] = order[next];
        } else {
          stack.pop();
          var above = parent[node];
          if (above != null) {
            if (low[node] < low[above]) low[above] = low[node];
            if (above !== start && low[node] >= order[above]) isCut[above] = true;
          }
        }
      }
      if (rootChildren > 1) isCut[start] = true;
    });
    /* How much falls off if they go, so the finding can be stated in plain terms. */
    return Object.keys(isCut).sort().map(function (id) {
      var before = groups(keys, links, { centre: options.centre }).length;
      var after = groups(keys.filter(function (k) { return k !== id; }), links, { centre: options.centre }).length;
      return { id: id, splitsInto: Math.max(2, after - before + 1) };
    }).sort(function (a, b) { return b.splitsInto - a.splitsInto || a.id.localeCompare(b.id); });
  }

  /* ---- Shared identifiers ----
   * The same number, address or email domain held by more than one person is
   * evidence of something: a household, a workplace, a duplicated record. */
  function sharedSelectors(people, options) {
    options = options || {};
    var read = options.read || function (person) { return person.selectors || []; };
    var index = Object.create(null);
    (people || []).forEach(function (person) {
      var seen = Object.create(null);
      read(person).forEach(function (selector) {
        var kind = lower(selector.kind), value = lower(selector.value).trim();
        if (!value) return;
        var key = kind + "|" + value;
        if (seen[key]) return;
        seen[key] = true;
        var row = index[key] || (index[key] = { kind: selector.kind, value: selector.value, holders: [] });
        row.holders.push(text(person.id));
      });
    });
    return Object.keys(index).map(function (key) { return index[key]; })
      .filter(function (row) { return row.holders.length > 1; })
      .map(function (row) { row.holders.sort(); return row; })
      .sort(function (a, b) { return b.holders.length - a.holders.length || lower(a.value).localeCompare(lower(b.value)); });
  }

  /* ---- Relationships the evidence already implies ----
   * Every suggestion states what it is based on. Nothing is created here; the
   * caller decides, exactly as an import is reviewed before it is merged. */
  var SEP = String.fromCharCode(0);
  var SUGGESTION_WEIGHT = { selector: 90, organisation: 55, together: 70 };
  function suggestLinks(input) {
    input = input || {};
    var people = input.people || [], existing = Object.create(null), out = Object.create(null);
    (input.links || []).forEach(function (link) {
      var a = text(link.from), b = text(link.to);
      existing[a < b ? a + SEP + b : b + SEP + a] = true;
    });
    var centre = text(input.centre);
    /* An id can contain almost anything — entity ids here carry a pipe — so the
     * pair key uses a character that cannot appear in one, and the two ends are
     * carried through rather than reconstructed by splitting the key. */
    function pairKey(a, b) { return a < b ? a + SEP + b : b + SEP + a; }
    function propose(a, b, kind, why, weight) {
      a = text(a); b = text(b);
      if (!a || !b || a === b || a === centre || b === centre) return;
      var key = pairKey(a, b);
      if (existing[key]) return;
      var ends = a < b ? [a, b] : [b, a];
      var row = out[key] || (out[key] = { a: ends[0], b: ends[1], score: 0, reasons: [] });
      if (row.reasons.some(function (r) { return r.why === why; })) return;
      row.score += weight;
      row.reasons.push({ kind: kind, why: why });
    }
    /* Two people holding the same identifier. */
    sharedSelectors(people, { read: input.read }).forEach(function (row) {
      if (row.holders.length > 6) return;         /* a shared work domain is not a relationship */
      for (var i = 0; i < row.holders.length; i++) {
        for (var j = i + 1; j < row.holders.length; j++) {
          propose(row.holders[i], row.holders[j], "selector", "Share the same " + lower(row.kind) + " · " + row.value, SUGGESTION_WEIGHT.selector);
        }
      }
    });
    /* Two people at the same organisation. */
    var byOrg = Object.create(null);
    people.forEach(function (person) {
      var org = lower(person.organisation).trim();
      if (!org) return;
      (byOrg[org] = byOrg[org] || []).push(person);
    });
    Object.keys(byOrg).sort().forEach(function (org) {
      var members = byOrg[org];
      if (members.length < 2 || members.length > 12) return;
      for (var i = 0; i < members.length; i++) {
        for (var j = i + 1; j < members.length; j++) {
          propose(members[i].id, members[j].id, "organisation", "Both at " + text(members[0].organisation), SUGGESTION_WEIGHT.organisation);
        }
      }
    });
    /* Two people named on the same message or meeting. */
    var byEvent = input.eventMembers || Object.create(null);
    Object.keys(byEvent).sort().forEach(function (eventId) {
      var members = byEvent[eventId] || [];
      if (members.length < 2 || members.length > 12) return;
      for (var i = 0; i < members.length; i++) {
        for (var j = i + 1; j < members.length; j++) {
          propose(members[i], members[j], "together", "Named on the same message or meeting", SUGGESTION_WEIGHT.together);
        }
      }
    });
    return Object.keys(out).map(function (key) { return out[key]; })
      .sort(function (a, b) { return b.score - a.score || a.a.localeCompare(b.a) || a.b.localeCompare(b.b); });
  }

  var api = {
    adjacency: adjacency, groups: groups, bridges: bridges,
    sharedSelectors: sharedSelectors, suggestLinks: suggestLinks
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitGraph = api;
})(typeof window !== "undefined" ? window : globalThis);
