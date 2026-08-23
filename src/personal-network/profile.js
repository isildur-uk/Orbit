/* ORBIT Personal Network - neutral Contact Profile read model.
 *
 * This module deliberately contains no DOM code. It projects the shared
 * OrbitCase entity/link spine into a profile that both desktop and mobile can
 * render. Person, interaction and fact records remain separate: a profile is
 * a read model, not a second database row.
 *
 * Browser: window.OrbitNetworkProfile. Node: module.exports.
 */
(function (root) {
  "use strict";

  var D = root && root.OrbitNetworkDomain;
  if (!D && typeof require === "function") {
    try { D = require("./domain.js"); } catch (e) { D = null; }
  }

  function text(value) { return value == null ? "" : String(value); }
  function lower(value) { return text(value).toLowerCase(); }
  function attrs(item) { return (item && item.attrs) || {}; }
  function typeOf(item) { return lower(item && item.type); }
  function array(value) { return Array.isArray(value) ? value : (value == null || value === "" ? [] : [value]); }
  function unique(values) {
    var seen = Object.create(null), out = [];
    (values || []).forEach(function (value) {
      var key = lower(value);
      if (!key || seen[key]) return;
      seen[key] = true; out.push(text(value));
    });
    return out;
  }
  function iso(value) {
    if (!value) return "";
    var d = new Date(value);
    return isNaN(d.getTime()) ? text(value) : d.toISOString();
  }
  function dateValue(item) {
    var a = attrs(item);
    return text(item && (item.dateISO || item.occurredAt || item.date || item.validFrom || item.observedAt) ||
      a.occurredAt || a.dateISO || a.date || a.validFrom || a.observedAt);
  }
  function dateMs(value) {
    var d = new Date(value);
    return value && !isNaN(d.getTime()) ? d.getTime() : NaN;
  }
  function dateOnly(value) {
    var d = dateMs(value);
    return isNaN(d) ? text(value) : new Date(d).toISOString().slice(0, 10);
  }
  function sortDate(a, b) {
    var am = dateMs(dateValue(a)), bm = dateMs(dateValue(b));
    if (isNaN(am) && isNaN(bm)) return text(a && a.id).localeCompare(text(b && b.id));
    if (isNaN(am)) return 1;
    if (isNaN(bm)) return -1;
    return am - bm;
  }
  function isPerson(item) { return D ? D.isPerson(item) : typeOf(item) === "person"; }
  function isInteraction(item) {
    if (D && D.isInteraction) return D.isInteraction(item);
    return ["interaction", "event", "meeting", "message", "email", "call"].indexOf(typeOf(item)) !== -1;
  }
  function isFact(item) { return typeOf(item) === "fact" || typeOf(item) === "memory" || !!attrs(item).factType; }
  function isOpportunity(item) {
    return D && D.isOpportunityEntity ? D.isOpportunityEntity(item) : typeOf(item) === "opportunity";
  }
  function isPromise(item) {
    return D && D.isPromiseEntity ? D.isPromiseEntity(item) : /promise/.test(lower(attrs(item).factType));
  }
  function idOf(item) { return text(item && item.id); }

  function idsFrom(value) {
    return array(value).map(function (x) {
      if (x && typeof x === "object") return text(x.id || x.entityId || x.personId || x.value);
      return text(x);
    }).filter(Boolean);
  }
  function directSubjectIds(item) {
    var a = attrs(item), out = [];
    [a.personId, a.subjectId, a.forPersonId, a.contactId, a.ownerId, a.aboutPersonId,
      a.personIds, a.participantIds, a.participants, item && item.personId].forEach(function (v) {
      out = out.concat(idsFrom(v));
    });
    return unique(out);
  }
  function linkTouches(link, id) { return text(link && link.from) === text(id) || text(link && link.to) === text(id); }
  function connectedTo(link, id) {
    if (text(link.from) === text(id)) return text(link.to);
    if (text(link.to) === text(id)) return text(link.from);
    return "";
  }
  function related(item, personId, links) {
    if (directSubjectIds(item).indexOf(text(personId)) !== -1) return true;
    return (links || []).some(function (link) {
      return linkTouches(link, personId) && connectedTo(link, personId) === idOf(item) ||
        (connectedTo(link, personId) === idOf(item) && directSubjectIds(link).indexOf(text(personId)) !== -1);
    });
  }
  function sourceOf(item) {
    var a = attrs(item);
    return {
      type: text(item && (item.sourceType || item.source) || a.sourceType || a.source || a.sourceSystem || "unknown"),
      ref: text(item && (item.sourceRef || item.sourceId) || a.sourceRef || a.sourceId),
      observedAt: text(item && item.observedAt || a.observedAt || dateValue(item)),
      validFrom: text(item && item.validFrom || a.validFrom),
      validUntil: text(item && item.validUntil || a.validUntil),
      confidence: text(item && item.confidence || a.confidence || "")
    };
  }
  function asOfISO(value) { return value ? iso(value) : new Date().toISOString(); }
  function validAt(item, asOf, opts) {
    var a = attrs(item), at = asOfISO(asOf), from = text(item && item.validFrom || a.validFrom || item && item.observedAt || a.observedAt),
      until = text(item && item.validUntil || a.validUntil), observed = text(item && item.observedAt || a.observedAt);
    if (a.supersededBy || lower(a.status) === "superseded" || item && item.supersededBy) return false;
    if (!opts || !opts.historical) {
      if (from && dateMs(from) > dateMs(at)) return false;
      if (until && dateMs(until) < dateMs(at)) return false;
      return true;
    }
    /* A historical snapshot cannot pretend an undated assertion existed before
       it was observed. Undated manual facts remain available in the live view. */
    if (!from && !observed) return false;
    if ((from || observed) && dateMs(from || observed) > dateMs(at)) return false;
    if (until && dateMs(until) < dateMs(at)) return false;
    return true;
  }
  function factValue(item) {
    var a = attrs(item);
    return text(item && (item.value || item.text) || a.value || a.text || a.summary || a.note || item && item.label || "");
  }
  function factType(item) { return text(attrs(item).factType || item && item.factType || item && item.type || "fact"); }
  function factRow(item) {
    var a = attrs(item), src = sourceOf(item);
    return {
      id: idOf(item), type: factType(item), value: factValue(item),
      label: text(item && item.label || a.label || factType(item)),
      observedAt: src.observedAt, validFrom: src.validFrom, validUntil: src.validUntil,
      sourceType: src.type, sourceRef: src.ref, confidence: src.confidence,
      superseded: !!(a.supersededBy || lower(a.status) === "superseded" || item.supersededBy),
      entity: item
    };
  }
  function interactionRow(item) {
    var a = attrs(item), src = sourceOf(item), occurred = text(item && (item.occurredAt || item.dateISO || item.date) || a.occurredAt || a.dateISO || a.date || "");
    return {
      id: idOf(item), type: text(a.interactionType || item && item.type || "interaction"),
      title: text(item && item.label || a.title || a.subject || a.summary || a.channel || "Interaction"),
      summary: text(a.summary || a.content || a.note || a.snippet || ""),
      occurredAt: occurred, channel: text(a.channel || a.sourceSystem || item && item.source || ""),
      sourceType: src.type, sourceRef: src.ref, confidence: src.confidence, entity: item
    };
  }
  function median(values) {
    values = (values || []).slice().sort(function (a, b) { return a - b; });
    if (!values.length) return 0;
    var mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  }
  function relationshipPhase(interactions, asOf) {
    var dated = (interactions || []).filter(function (x) { return !isNaN(dateMs(x.occurredAt)) && dateMs(x.occurredAt) <= dateMs(asOf); }).sort(function (a, b) { return dateMs(a.occurredAt) - dateMs(b.occurredAt); });
    if (!dated.length) return { label: "No dated history", cadenceDays: 0, gapDays: null };
    if (dated.length === 1) return { label: "First contact", cadenceDays: 0, gapDays: Math.max(0, Math.round((dateMs(asOf) - dateMs(dated[0].occurredAt)) / 86400000)) };
    var gaps = [], i;
    for (i = 1; i < dated.length; i++) gaps.push(Math.max(1, (dateMs(dated[i].occurredAt) - dateMs(dated[i - 1].occurredAt)) / 86400000));
    var cadence = median(gaps), gap = Math.max(0, (dateMs(asOf) - dateMs(dated[dated.length - 1].occurredAt)) / 86400000);
    if (gap > Math.max(60, cadence * 2.5)) return { label: "Quiet relative to history", cadenceDays: Math.round(cadence), gapDays: Math.round(gap) };
    if (gap > Math.max(30, cadence * 1.5)) return { label: "Cooling", cadenceDays: Math.round(cadence), gapDays: Math.round(gap) };
    return { label: "Active", cadenceDays: Math.round(cadence), gapDays: Math.round(gap) };
  }
  function relationshipHealth(interactions, asOf) {
    var now = dateMs(asOf), dated = (interactions || []).filter(function (item) { return !isNaN(dateMs(item.occurredAt)) && dateMs(item.occurredAt) <= now; }).sort(function (a, b) { return dateMs(b.occurredAt) - dateMs(a.occurredAt); });
    if (!dated.length) return { score: 0, recencyScore: 0, frequencyScore: 0, reciprocityScore: 0, recencyLabel: "No contact recorded", frequencyLabel: "No dated interactions", reciprocityLabel: "No direction data" };
    var days = Math.max(0, Math.round((now - dateMs(dated[0].occurredAt)) / 86400000)), recencyScore = days <= 7 ? 100 : days <= 30 ? 82 : days <= 90 ? 64 : days <= 180 ? 40 : days <= 365 ? 18 : 0;
    var yearAgo = now - 365 * 86400000, yearCount = dated.filter(function (item) { return dateMs(item.occurredAt) >= yearAgo; }).length, frequencyScore = Math.min(100, yearCount * 20);
    var outbound = 0, inbound = 0;
    dated.forEach(function (item) { var direction = lower(attrs(item.entity).direction || attrs(item.entity).flow); if (/out|sent|initiated|gave/.test(direction)) outbound++; if (/in|received|replied|got/.test(direction)) inbound++; });
    var knownDirections = outbound + inbound, reciprocityScore = !knownDirections ? 50 : outbound && inbound ? 100 : 45;
    var score = Math.round(recencyScore * .45 + frequencyScore * .35 + reciprocityScore * .2);
    return {
      score: score, recencyScore: recencyScore, frequencyScore: frequencyScore, reciprocityScore: reciprocityScore,
      recencyLabel: days <= 7 ? "Within the last week" : days <= 30 ? "Within the last month" : days <= 90 ? "Within the last quarter" : days <= 180 ? "More than three months ago" : "More than six months ago",
      frequencyLabel: yearCount + " dated interaction" + (yearCount === 1 ? "" : "s") + " in the last year",
      reciprocityLabel: !knownDirections ? "Direction not recorded" : outbound && inbound ? "Inbound and outbound activity" : "One-way activity recorded"
    };
  }
  /* One chip per value: a merged profile carries both numbers in one field, and
   * imports often arrive with "a@x.com; b@y.com" in a single cell. */
  function splitMethodValues(value) {
    return text(value).split(/\s*[;,]\s*/).map(function (v) { return v.trim(); }).filter(Boolean);
  }
  function contactMethods(person) {
    var a = attrs(person), out = [];
    ["email", "phone", "phoneOther", "whatsapp", "signal", "facebook", "instagram", "x", "tiktok", "website"].forEach(function (key) {
      array(a[key]).forEach(function (value) {
        splitMethodValues(value).forEach(function (v) { out.push({ kind: key, value: v }); });
      });
    });
    array(a.socialProfiles).forEach(function (item) {
      if (!item) return;
      if (typeof item === "string") out.push({ kind: "social", value: item });
      else if (item.value || item.handle || item.url) out.push({ kind: text(item.platform || item.kind || "social"), value: text(item.value || item.handle || item.url), url: text(item.url || "") });
    });
    return out;
  }
  function addresses(person) {
    var a = attrs(person), out = [];
    [["Home", a.address], ["Work", a.workAddress], ["Other", a.otherAddress]].forEach(function (row) {
      if (row[1]) out.push({ label: row[0], value: text(row[1]) });
    });
    array(a.addresses).forEach(function (item) {
      if (!item) return;
      if (typeof item === "string") out.push({ label: "Address", value: item });
      else if (item.value || item.address) out.push({ label: text(item.label || item.kind || "Address"), value: text(item.value || item.address) });
    });
    return out;
  }
  function profileDetails(person) {
    var a = attrs(person), out = [];
    [["Birthday", a.birthday], ["Interests", a.interests], ["Useful details", a.note]].forEach(function (row) {
      if (row[1]) out.push({ label: row[0], value: text(row[1]) });
    });
    return out;
  }
  function buildProfile(snapshot, personId, opts) {
    snapshot = snapshot || { entities: [], links: [] }; opts = opts || {};
    var entities = snapshot.entities || [], links = snapshot.links || [], id = text(personId);
    var person = entities.filter(function (e) { return idOf(e) === id && isPerson(e); })[0];
    if (!person) return null;
    var asOf = asOfISO(opts.asOf), personLinks = links.filter(function (l) { return linkTouches(l, id); });
    var interactions = entities.filter(function (e) { return isInteraction(e) && related(e, id, links); }).map(interactionRow);
    interactions.sort(function (a, b) { return dateMs(b.occurredAt) - dateMs(a.occurredAt); });
    var facts = entities.filter(function (e) { return isFact(e) && related(e, id, links); }).map(factRow);
    var currentFacts = facts.filter(function (f) { return validAt(f.entity, asOf, opts); }).sort(function (x, y) {
      return dateMs(y.validFrom || y.observedAt) - dateMs(x.validFrom || x.observedAt);
    });
    var currentByType = Object.create(null);
    currentFacts.forEach(function (f) { if (!currentByType[f.type]) currentByType[f.type] = f; });
    var allHistory = interactions.map(function (x) {
      return { kind: "interaction", date: x.occurredAt, title: x.title, summary: x.summary, sourceType: x.sourceType, sourceRef: x.sourceRef, item: x };
    }).concat(facts.filter(function (f) { return f.observedAt || f.validFrom; }).map(function (f) {
      return { kind: "fact", date: f.validFrom || f.observedAt, title: f.label, summary: f.value, sourceType: f.sourceType, sourceRef: f.sourceRef, item: f };
    })).sort(function (a, b) { return dateMs(b.date) - dateMs(a.date); });
    var relatedPeople = personLinks.map(function (l) { return connectedTo(l, id); }).map(function (otherId) {
      return entities.filter(function (e) { return idOf(e) === otherId && isPerson(e); })[0];
    }).filter(Boolean);
    var opportunities = entities.filter(function (e) { return isOpportunity(e) && related(e, id, links); }).map(function (e) {
      var a = attrs(e), src = sourceOf(e);
      return { id: idOf(e), title: text(e.label || a.title || "Opportunity"), summary: text(a.summary || a.reason || a.value || ""), sourceType: src.type, sourceRef: src.ref, entity: e };
    });
    var promises = facts.filter(function (f) { return isPromise(f.entity) && !f.superseded; });
    var phase = relationshipPhase(interactions, asOf), health = relationshipHealth(interactions, asOf);
    var a = attrs(person), score = D && D.stableScore ? D.stableScore(person, personLinks) : 0;
    return {
      id: id, asOf: asOf, person: person,
      header: { name: text(person.label || a.name || "Unnamed person"), kind: text(a.entityKind || "individual"), photo: text(a.photo || ""), icon: text(a.icon || ""), ring: text(a.ring || ""), preferredName: text(a.preferredName || ""), role: text(a.role || a.title || ""), organisation: text(a.organisation || a.company || ""), location: text(a.location || ""), relationship: text(a.relationship || a.relationshipType || ""), note: text(a.note || ""), contactMethods: contactMethods(person), addresses: addresses(person), details: profileDetails(person) },
      relationship: { score: health.score || score, baseScore: score, ring: D && D.ringFor ? D.ringFor(score) : "outer", relationships: personLinks.length, sharedContacts: unique(relatedPeople.map(function (p) { return p.label; })).length, interactionCount: interactions.length, firstInteraction: interactions.length ? interactions[interactions.length - 1].occurredAt : "", lastInteraction: interactions.length ? interactions[0].occurredAt : "", phase: phase, health: health },
      currentContext: Object.keys(currentByType).map(function (k) { return currentByType[k]; }),
      facts: facts, history: allHistory, interactions: interactions, opportunities: opportunities, promises: promises,
      evidence: facts.concat(interactions).filter(function (x) { return x.sourceRef || x.sourceType !== "unknown"; }).map(function (x) { return { id: x.id, kind: x.type || "fact", label: x.label || x.title || x.value || "Evidence", sourceType: x.sourceType, sourceRef: x.sourceRef, observedAt: x.observedAt || x.occurredAt, item: x.entity }; })
    };
  }
  var api = { buildProfile: buildProfile, validAt: validAt, sourceOf: sourceOf, relationshipPhase: relationshipPhase, relationshipHealth: relationshipHealth, factRow: factRow, interactionRow: interactionRow, contactMethods: contactMethods, addresses: addresses, profileDetails: profileDetails };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitNetworkProfile = api;
})(typeof window !== "undefined" ? window : globalThis);
