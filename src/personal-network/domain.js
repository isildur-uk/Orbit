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
      people: entities.filter(isPerson).length,
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
      stableScore: stableScore
    };
  }
  var exported = api();
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  if (root) root.OrbitNetworkDomain = exported;
})(typeof window !== "undefined" ? window : globalThis);
