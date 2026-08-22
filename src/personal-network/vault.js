/* ORBIT Personal Network - vault repository seam.
 *
 * The first adapter delegates to OrbitCase. Keeping the surface behind this
 * small interface means a future portable vault/sync repository can replace
 * the local adapter without changing profile, capture or graph code.
 *
 * Browser: window.OrbitNetworkVault. Node: module.exports.
 */
(function (root) {
  "use strict";

  function text(value) { return value == null ? "" : String(value); }
  function clone(value) {
    if (value == null) return value;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function list(value) { return Array.isArray(value) ? value : []; }
  function exportPayload(store) {
    var entities = list(store.entities()).map(clone), links = list(store.links()).map(clone);
    return {
      schema: "orbit.vault.v1",
      app: "ORBIT Personal Network",
      surface: "personal",
      exportedAt: new Date().toISOString(),
      caseName: store.name ? text(store.name()) : "",
      entities: entities,
      links: links,
      counts: { entities: entities.length, links: links.length }
    };
  }
  function validatePayload(payload) {
    if (!payload || typeof payload !== "object") throw new Error("That file is not an Orbit vault.");
    if (text(payload.schema) !== "orbit.vault.v1") throw new Error("Unsupported vault format. Expected orbit.vault.v1.");
    if (!Array.isArray(payload.entities) || !Array.isArray(payload.links)) throw new Error("Orbit vault is missing entities or links.");
    return payload;
  }
  function importPayload(store, payload) {
    payload = validatePayload(payload);
    var entities = payload.entities.filter(function (item) { return item && typeof item === "object"; }).map(clone);
    var links = payload.links.filter(function (item) { return item && typeof item === "object"; }).map(clone);
    var before = { entities: store.entities().length, links: store.links().length };
    store.merge({ entities: entities, links: links });
    var after = { entities: store.entities().length, links: store.links().length };
    return {
      schema: payload.schema,
      imported: { entities: entities.length, links: links.length },
      added: { entities: Math.max(0, after.entities - before.entities), links: Math.max(0, after.links - before.links) },
      totals: after,
      exportedAt: text(payload.exportedAt)
    };
  }
  function local(store) {
    if (!store) throw new Error("OrbitCase is unavailable");
    return {
      kind: "local-case",
      entities: function () { return store.entities(); },
      links: function () { return store.links(); },
      merge: function (part, opts) { return store.merge(part, opts); },
      withdraw: function (contrib, opts) { return store.withdraw(contrib, opts); },
      removeEntity: function (id, opts) { return store.removeEntity ? store.removeEntity(id, opts) : null; },
      subscribe: function (fn) { return store.subscribe(fn); },
      entityId: function (entity) { return store.entityId(entity); },
      linkId: function (link) { return store.linkId(link); },
      name: function () { return store.name ? store.name() : ""; },
      setName: function (name) { return store.setName ? store.setName(text(name)) : ""; },
      limits: function () { return store.limits ? store.limits() : null; },
      snapshot: function () { return exportPayload(store); },
      exportJSON: function () { return JSON.stringify(exportPayload(store), null, 2); },
      importPayload: function (payload) { return importPayload(store, payload); },
      importJSON: function (value) {
        var payload;
        try { payload = JSON.parse(text(value)); } catch (error) { throw new Error("That file is not valid JSON."); }
        return importPayload(store, payload);
      },
      raw: store
    };
  }
  var api = { local: local, open: local };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitNetworkVault = api;
})(typeof window !== "undefined" ? window : globalThis);
