/* ORBIT Personal Network domain helpers. Pure calculations live here so the
 * view can remain a renderer and the future import/opportunity engines can
 * reuse the same vocabulary. */
(function (root) {
  "use strict";

  var ME_ID = "personal-network:me";
  var SOURCE_KEYS = ["gmail", "calendar", "contacts", "phone", "notes", "csv", "whatsapp", "facebook", "instagram"];

  function text(value) { return value == null ? "" : String(value); }
  function lower(value) { return text(value).toLowerCase(); }
  function number(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function attrs(entity) { return (entity && entity.attrs) || {}; }
  function entityType(entity) { return lower(entity && entity.type); }
  function isPerson(entity) { return entityType(entity) === "person" || entityType(entity) === "individual"; }
  function isInteraction(entity) {
    var t = entityType(entity);
    return t === "interaction" || t === "event" || t === "meeting" || t === "message" || t === "email" || t === "call";
  }
  function isOpportunityEntity(entity) {
    var t = entityType(entity), a = attrs(entity);
    return t === "opportunity" || t === "introduction" || lower(a.factType).indexOf("opportunity") !== -1 || a.opportunity === true;
  }
  function isPromiseEntity(entity) {
    var a = attrs(entity);
    return lower(a.factType).indexOf("promise") !== -1 || lower(a.factType).indexOf("promised") !== -1 || a.outstandingPromise === true;
  }
  function sourceOf(item) {
    var a = attrs(item);
    return lower(item && (item.source || a.source || a.sourceSystem));
  }
  function stableScore(entity, links) {
    var a = attrs(entity);
    var direct = a.relationshipStrength != null ? a.relationshipStrength : a.strength;
    if (direct != null) return Math.max(0, Math.min(100, number(direct, 50)));
    var id = text(entity && entity.id);
    var degree = links.reduce(function (n, link) {
      return n + (text(link.from) === id || text(link.to) === id ? 1 : 0);
    }, 0);
    return Math.max(18, Math.min(82, 18 + degree * 11));
  }
  function ringFor(score) {
    if (score >= 78) return "inner";
    if (score >= 55) return "working";
    if (score >= 30) return "outer";
    return "deep";
  }
  function relationshipCount(id, links) {
    return links.reduce(function (n, link) {
      return n + (text(link.from) === id || text(link.to) === id ? 1 : 0);
    }, 0);
  }
  function hasOpportunity(link) {
    var a = attrs(link);
    return lower(link && link.type).indexOf("opportun") !== -1 || a.opportunity === true || a.highlight === "opportunity";
  }
  function stats(entities, links) {
    var opportunities = entities.filter(isOpportunityEntity).length;
    var introductions = links.filter(function (link) { return lower(link.type).indexOf("intro") !== -1 || lower(link.type).indexOf("opportun") !== -1; }).length;
    return {
      interactions: entities.filter(isInteraction).length,
      people: entities.filter(function (e) { return isPerson(e) && text(e && e.id) !== ME_ID; }).length,
      relationships: links.length,
      introductions: introductions,
      reconnect: entities.filter(function (e) { return attrs(e).reconnect === true || lower(attrs(e).factType) === "dormant_relationship"; }).length,
      promises: entities.filter(isPromiseEntity).length,
      opportunities: opportunities + links.filter(hasOpportunity).length
    };
  }
  function sourceStatus(entities, links) {
    var all = entities.concat(links);
    return SOURCE_KEYS.map(function (key) {
      return { key: key, connected: all.some(function (item) { return sourceOf(item).indexOf(key) !== -1; }) };
    });
  }
  /* The shortest chain of relationships between two people, inclusive of both
   * ends, or null when nothing connects them. Breadth-first, so the first route
   * found is the shortest; ties are broken by id for a stable answer. */
  function shortestPath(links, fromId, toId) {
    var from = text(fromId), to = text(toId);
    if (!from || !to) return null;
    if (from === to) return [from];
    var adj = Object.create(null);
    (links || []).forEach(function (link) {
      var a = text(link && link.from), b = text(link && link.to);
      if (!a || !b || a === b) return;
      (adj[a] || (adj[a] = [])).push(b);
      (adj[b] || (adj[b] = [])).push(a);
    });
    Object.keys(adj).forEach(function (k) { adj[k].sort(); });
    var seen = Object.create(null), previous = Object.create(null), queue = [from];
    seen[from] = true;
    while (queue.length) {
      var current = queue.shift();
      var next = adj[current] || [];
      for (var i = 0; i < next.length; i++) {
        var node = next[i];
        if (seen[node]) continue;
        seen[node] = true;
        previous[node] = current;
        if (node === to) {
          var chain = [to];
          while (chain[0] !== from) chain.unshift(previous[chain[0]]);
          return chain;
        }
        queue.push(node);
      }
    }
    return null;
  }

  /* When each person was last in contact, found in one pass over the case: an
   * interaction's date reaches every person it is linked to. Returns
   * { personId: millis }; a person with nothing dated is simply absent. */
  function lastInteractionByPerson(entities, links) {
    var dates = Object.create(null), out = Object.create(null);
    (entities || []).forEach(function (entity) {
      if (!isInteraction(entity)) return;
      var a = attrs(entity);
      var when = Date.parse(text(entity.occurredAt || a.occurredAt || a.date || a.observedAt || entity.ts));
      if (!isNaN(when)) dates[text(entity.id)] = when;
    });
    var people = Object.create(null);
    (entities || []).forEach(function (entity) { if (isPerson(entity)) people[text(entity.id)] = true; });
    (links || []).forEach(function (link) {
      var a = text(link && link.from), b = text(link && link.to);
      var pair = people[a] && dates[b] != null ? [a, dates[b]] : (people[b] && dates[a] != null ? [b, dates[a]] : null);
      if (!pair) return;
      if (out[pair[0]] == null || pair[1] > out[pair[0]]) out[pair[0]] = pair[1];
    });
    return out;
  }

  /* How long a relationship at each ring can go quiet before it is worth a
   * nudge. Closer relationships go cold faster — that is the point of them. */
  var COLD_AFTER_DAYS = { inner: 30, working: 60, outer: 120, deep: 365 };
  /* Days overdue for one person: positive means past due, 0 means fine, and a
   * person with no dated contact at all is overdue by their whole allowance. */
  function contactDebt(ring, lastMillis, asOfMillis) {
    var allowance = COLD_AFTER_DAYS[ring] || COLD_AFTER_DAYS.outer;
    if (lastMillis == null) return { days: allowance, allowance: allowance, everContacted: false };
    var days = Math.floor((asOfMillis - lastMillis) / 86400000);
    return { days: Math.max(0, days - allowance), allowance: allowance, everContacted: true, sinceDays: Math.max(0, days) };
  }
  function snapshot(store) {
    var entities = store && typeof store.entities === "function" ? store.entities() : [];
    var links = store && typeof store.links === "function" ? store.links() : [];
    return { entities: entities, links: links, stats: stats(entities, links), sources: sourceStatus(entities, links) };
  }
  function personSummary(entity, links) {
    var score = stableScore(entity, links);
    var a = attrs(entity);
    return {
      entity: entity,
      score: score,
      ring: ringFor(score),
      relationships: relationshipCount(entity.id, links),
      role: text(a.role || a.title || a.company || "Person in your network"),
      evidence: text(entity.source || a.source || "user-entered")
    };
  }
  function api() {
    return {
      ME_ID: ME_ID,
      SOURCE_KEYS: SOURCE_KEYS.slice(),
      attrs: attrs,
      isPerson: isPerson,
      isInteraction: isInteraction,
      isPromiseEntity: isPromiseEntity,
      isOpportunityEntity: isOpportunityEntity,
      hasOpportunity: hasOpportunity,
      snapshot: snapshot,
      personSummary: personSummary,
      ringFor: ringFor,
      stableScore: stableScore,
      shortestPath: shortestPath,
      lastInteractionByPerson: lastInteractionByPerson,
      contactDebt: contactDebt,
      COLD_AFTER_DAYS: COLD_AFTER_DAYS
    };
  }
  var exported = api();
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  if (root) root.OrbitNetworkDomain = exported;
})(typeof window !== "undefined" ? window : globalThis);
