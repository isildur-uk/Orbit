/* google-contacts.js — read-only Google People API adapter.
 *
 * The provider token is held in memory for the current session and is never
 * written to Orbit's vault. Results are normalized into the same candidate
 * shape used by vCard/CSV imports, so every record still passes through the
 * existing review-before-merge step.
 */
(function (root) {
  "use strict";

  var ENDPOINT = "https://people.googleapis.com/v1/people/me/connections";
  var FIELDS = "names,emailAddresses,phoneNumbers,addresses,organizations,urls,birthdays,biographies";
  var Classify = (root && root.OrbitContactClassify) || null;
  if (!Classify && typeof require === "function") {
    try { Classify = require("./classify.js"); } catch (e) { Classify = null; }
  }

  function text(value) { return value == null ? "" : String(value).trim(); }
  function first(list) { return Array.isArray(list) && list.length ? list[0] || {} : {}; }
  function valueOf(list) { var item = first(list); return text(item.value || item.formattedValue || item.displayName); }
  function urlKind(url) {
    var lower = text(url).toLowerCase();
    if (lower.indexOf("instagram.com") !== -1) return "Instagram";
    if (lower.indexOf("facebook.com") !== -1 || lower.indexOf("fb.com") !== -1) return "Facebook";
    if (lower.indexOf("x.com") !== -1 || lower.indexOf("twitter.com") !== -1) return "X";
    return "Website";
  }
  function birthday(value) {
    var date = value && value.date || {};
    if (!date.month || !date.day) return "";
    return (date.year ? String(date.year).padStart(4, "0") + "-" : "") + String(date.month).padStart(2, "0") + "-" + String(date.day).padStart(2, "0");
  }
  function emailValues(person) { return (person.emailAddresses || []).map(function (item) { return text(item.value).toLowerCase(); }).filter(Boolean); }
  function classification(displayName, organisation, emails) {
    if (!Classify) return { category: displayName ? "individual" : "unknown" };
    return Classify.classify({ name: displayName, organisation: organisation, emails: emails });
  }
  function candidate(person) {
    person = person || {};
    var name = first(person.names), organisation = first(person.organizations), urls = (person.urls || []).map(function (item) { return text(item.value); }).filter(Boolean);
    var socialProfiles = urls.map(function (url) { return { platform: urlKind(url), value: url, url: url }; });
    var social = {};
    socialProfiles.forEach(function (item) { var key = item.platform.toLowerCase(); if (!social[key]) social[key] = item.value; });
    var notes = (person.biographies || []).map(function (item) { return text(item.value); }).filter(Boolean);
    var phoneValues = (person.phoneNumbers || []).map(function (item) { return text(item.value); }).filter(Boolean);
    var emails = emailValues(person), emailValuesDisplay = (person.emailAddresses || []).map(function (item) { return text(item.value); }).filter(Boolean);
    var address = valueOf(person.addresses);
    var displayName = text(name.displayName || [name.givenName, name.middleName, name.familyName].filter(Boolean).join(" "));
    var kind = classification(displayName, text(organisation.name), emails);
    if (kind.skip) return { skipped: kind.skip };
    if (!displayName) displayName = text(organisation.name) || (emailValuesDisplay[0] ? emailValuesDisplay[0].split("@")[0] : "");
    if (!displayName) return { skipped: "no identifying details" };
    return { candidate: {
      kind: "contact",
      category: kind.category,
      classification: kind.reason || "",
      name: displayName,
      preferredName: text(name.givenName),
      role: text(organisation.title),
      organisation: text(organisation.name),
      email: emailValuesDisplay[0] || "",
      phone: phoneValues[0] || "",
      phoneOther: phoneValues[1] || "",
      address: address,
      website: social.website || "",
      instagram: social.instagram || "",
      facebook: social.facebook || "",
      x: social.x || "",
      birthday: birthday(first(person.birthdays)),
      note: notes.join("\n"),
      socialProfiles: socialProfiles,
      sourceType: "google-contacts",
      sourceRef: text(person.resourceName || displayName),
      observedAt: new Date().toISOString()
    } };
  }
  function request(accessToken, pageToken) {
    var query = new URLSearchParams({ personFields: FIELDS, pageSize: "1000", sortOrder: "FIRST_NAME_ASCENDING" });
    if (pageToken) query.set("pageToken", pageToken);
    return fetch(ENDPOINT + "?" + query.toString(), { headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" } }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) throw new Error(body && body.error && body.error.message ? body.error.message : "Google Contacts could not be read.");
        return body;
      });
    });
  }
  function list(accessToken, pageToken, collected, skipped, pages) {
    if (!accessToken) return Promise.reject(new Error("Google did not return a contacts access token. Try Connect Google again."));
    if (pages >= 20) return Promise.resolve({ candidates: collected, skipped: skipped });
    return request(accessToken, pageToken).then(function (body) {
      var page = (body.connections || []).map(candidate), next = collected.concat(page.filter(function (item) { return item && item.candidate; }).map(function (item) { return item.candidate; })), rejected = skipped.concat(page.filter(function (item) { return item && item.skipped; }).map(function (item) { return item.skipped; }));
      return body.nextPageToken ? list(accessToken, body.nextPageToken, next, rejected, pages + 1) : { candidates: next, skipped: rejected };
    });
  }
  function fetchContacts(accessToken) {
    return list(text(accessToken), "", [], [], 0).then(function (result) { return { candidates: result.candidates, skipped: result.skipped, count: result.candidates.length, skippedCount: result.skipped.length }; });
  }

  root.OrbitGoogleContacts = { fetch: fetchContacts };
})(typeof window !== "undefined" ? window : globalThis);
