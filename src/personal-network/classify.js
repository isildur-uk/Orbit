/* classify.js — one contact classifier shared by every import source.
 *
 * Google People, CSV and vCard imports all pass their records through the same
 * rules, so an automated address is filtered and an organisation is recognised
 * identically no matter where the record came from. Pure and side-effect free:
 * it takes plain fields and returns a verdict, so it runs in the browser and in
 * Node tests unchanged.
 *
 * Browser: window.OrbitContactClassify. Node: module.exports.
 */
(function (root) {
  "use strict";

  /* Automated / system senders. Anchored to the WHOLE local part so a real
   * person ("noreliah", "updatepractice") is never mistaken for one. */
  var AUTOMATED_LOCAL = /^(?:no[-_.]?reply|donotreply|do[-_.]?not[-_.]?reply|noreply|reply|bounce|bounces|auto[-_.]?reply|mailer[-_.]?daemon|mail[-_.]?daemon|daemon|postmaster|notification|notifications|notify|alert|alerts|updates?|newsletter|news|mailing|mailings|calendar[-_.]?notification|calendar[-_.]?notifications|drive[-_.]?share|drive[-_.]?shares|security[-_.]?alert|security[-_.]?alerts|system|root|webmaster|automated|do[-_.]?not[-_.]?respond)$/i;

  /* Shared/functional company inboxes. A record with one of these as its only
   * name is a generic company inbox, not a named individual. */
  var GENERIC_LOCAL = /^(?:info|hello|hi|contact|contactus|enquiry|enquiries|inquiries|sales|support|help|helpdesk|team|office|admin|billing|accounts?|payments?|invoices?|reception|customerservice|customercare|service|careers?|jobs?|hr|press|media|marketing|orders?|bookings?|hello|general)$/i;

  /* Words that mark an organisation rather than a person. */
  var ORGANISATION_NAME = /\b(?:ltd|limited|llc|inc|incorporated|plc|gmbh|s\.?a\.?|pty|corp|corporation|company|co\.?|group|holdings|partners|partnership|associates|solutions|services|systems|technologies|studio|studios|agency|consulting|consultancy|school|college|university|academy|foundation|trust|charity|bank|society|club|hotel|hospital|clinic|surgery|practice|pharmacy|restaurant|cafe|bar|store|shop|market|garage|motors|properties|estates|recruitment|insurance|finance|capital|ventures|media|labs?)\b/i;

  function text(value) { return value == null ? "" : String(value).trim(); }
  function localParts(emails) {
    return (emails || []).map(function (email) {
      var at = String(email || "").toLowerCase().indexOf("@");
      return at > 0 ? String(email).toLowerCase().slice(0, at) : "";
    }).filter(Boolean);
  }
  function isAutomatedEmail(email) {
    var parts = localParts([email]);
    return parts.length ? AUTOMATED_LOCAL.test(parts[0]) : false;
  }

  /* input: { name, organisation, emails:[..], details:[..] }
   * name is the person's REAL provided name ("" if the source only had an email
   * local part). "details" is everything known BESIDES the name and the email —
   * a phone number, a role, an address, a birthday, a note. Returns
   * { skip:reason } or { category, reason }.                                */
  function classify(input) {
    input = input || {};
    var name = text(input.name);
    var organisation = text(input.organisation);
    var emails = (input.emails || []).map(function (e) { return String(e || "").toLowerCase().trim(); }).filter(Boolean);
    var locals = localParts(emails);
    var details = (input.details || []).filter(function (value) {
      return Array.isArray(value) ? value.length > 0 : text(value) !== "";
    });

    if (locals.some(function (local) { return AUTOMATED_LOCAL.test(local); })) {
      return { skip: "automated address" };
    }
    if (!name && !organisation && !emails.length) {
      return { skip: "no identifying details" };
    }
    var generic = locals.some(function (local) { return GENERIC_LOCAL.test(local); });
    var orgKeyword = !!name && ORGANISATION_NAME.test(name);

    if (!name && generic) return { category: "generic-inbox", reason: "Shared or functional inbox" };
    if (!name && organisation) return { category: "organisation", reason: "Organisation name only" };
    if (orgKeyword) return { category: "organisation", reason: "Organisation name" };
    /* An address and nothing else is an address, however good a name came with
     * it. A name on its own does not tell you who someone is — the email is the
     * only thing you actually hold, so the record is filed as what it is and
     * drawn as an envelope rather than as a person. */
    if (emails.length && !details.length) return { category: "email", reason: "Email address only" };
    if (name) return { category: "individual", reason: "Personal name" };
    return { category: "email", reason: "Email address only" };
  }

  var CATEGORY_LABELS = {
    individual: "Individual",
    organisation: "Organisation",
    "generic-inbox": "Generic inbox",
    email: "Email only",
    /* Kept for records classified before "email only" existed. */
    unknown: "Ambiguous"
  };
  function categoryLabel(category) { return CATEGORY_LABELS[category] || "Contact"; }
  function isOrganisationCategory(category) { return category === "organisation" || category === "generic-inbox"; }

  var api = {
    classify: classify,
    categoryLabel: categoryLabel,
    isOrganisationCategory: isOrganisationCategory,
    isAutomatedEmail: isAutomatedEmail,
    AUTOMATED_LOCAL: AUTOMATED_LOCAL,
    GENERIC_LOCAL: GENERIC_LOCAL,
    ORGANISATION_NAME: ORGANISATION_NAME
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitContactClassify = api;
})(typeof window !== "undefined" ? window : globalThis);
