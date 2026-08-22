/* ORBIT Personal Network - reviewable contact import parsers.
 *
 * Parsing is deliberately pure: this module only turns CSV/vCard text into
 * candidate contacts. The UI owns review and the repository owns the merge.
 */
(function (root) {
  "use strict";

  var Classify = (root && root.OrbitContactClassify) || null;
  if (!Classify && typeof require === "function") {
    try { Classify = require("./classify.js"); } catch (e) { Classify = null; }
  }

  function text(value) { return value == null ? "" : String(value).trim(); }
  function lower(value) { return text(value).toLowerCase(); }
  function decodeQuotedPrintable(value) {
    return text(value).replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
  }
  function clean(value, params) {
    var out = text(value);
    if (/quoted-printable|encoding=qp/i.test(text(params))) out = decodeQuotedPrintable(out);
    return out.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\:/g, ":");
  }
  function key(value) { return lower(value).replace(/[^a-z0-9]+/g, ""); }
  function first(values) { for (var i = 0; i < values.length; i++) if (text(values[i])) return text(values[i]); return ""; }
  function unique(values) {
    var seen = Object.create(null), out = [];
    (values || []).forEach(function (value) { var v = text(value), k = lower(v); if (v && !seen[k]) { seen[k] = true; out.push(v); } });
    return out;
  }
  /* Returns one of:
   *   null                 - nothing usable (no name and no email)
   *   { skipped: reason }  - an automated/system record the shared classifier rejected
   *   { candidate: {...} } - a reviewable contact, tagged with its classification    */
  function candidate(raw, sourceType, sourceRef) {
    raw = raw || {};
    var phones = text(raw.phone || raw.tel || raw.mobile).split(/[,;]+/).map(text).filter(Boolean);
    var out = {
      kind: "contact",
      name: first([raw.name, raw.fullName, raw.fn]),
      preferredName: text(raw.preferredName || raw.nickname),
      role: text(raw.role || raw.title || raw.jobTitle),
      organisation: text(raw.organisation || raw.organization || raw.company || raw.org),
      location: text(raw.location || raw.city || raw.address),
      email: text(raw.email),
      phone: phones[0] || "",
      phoneOther: text(raw.phoneOther || phones.slice(1).join(", ")),
      whatsapp: text(raw.whatsapp),
      signal: text(raw.signal),
      instagram: text(raw.instagram),
      facebook: text(raw.facebook),
      website: text(raw.website),
      x: text(raw.x || raw.twitter),
      address: text(raw.address || raw.homeAddress),
      workAddress: text(raw.workAddress),
      birthday: text(raw.birthday || raw.bday),
      interests: text(raw.interests),
      socialProfiles: raw.socialProfiles || "",
      note: text(raw.note || raw.notes),
      sourceType: sourceType,
      sourceRef: sourceRef
    };
    if (!out.name && !out.email) return null;
    /* Classify from the REAL name (before any email fallback), so an automated
     * or organisation address is judged on what it actually is. */
    var verdict = Classify ? Classify.classify({ name: out.name, organisation: out.organisation, emails: [out.email] }) : { category: "individual" };
    if (verdict.skip) return { skipped: verdict.skip };
    out.category = verdict.category || "individual";
    out.classification = verdict.reason || "";
    if (!out.name && out.email) out.name = out.email.split("@")[0];
    return out.name ? { candidate: out } : null;
  }
  function collect(results) {
    var candidates = [], skipped = 0;
    (results || []).forEach(function (item) {
      if (!item) return;
      if (item.skipped) { skipped++; return; }
      if (item.candidate) candidates.push(item.candidate);
    });
    return { candidates: candidates, skippedCount: skipped };
  }
  function splitCSV(input) {
    var rows = [], row = [], value = "", quoted = false, i, ch;
    input = text(input).replace(/^\uFEFF/, "");
    for (i = 0; i < input.length; i++) {
      ch = input.charAt(i);
      if (ch === '"') {
        if (quoted && input.charAt(i + 1) === '"') { value += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === "," && !quoted) { row.push(value); value = ""; }
      else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && input.charAt(i + 1) === "\n") i++;
        row.push(value); value = "";
        if (row.some(function (cell) { return text(cell); })) rows.push(row);
        row = [];
      } else value += ch;
    }
    if (value || row.length) { row.push(value); if (row.some(function (cell) { return text(cell); })) rows.push(row); }
    return rows;
  }
  function csv(textValue, fileName) {
    var rows = splitCSV(textValue), out = [];
    if (!rows.length) return collect(out);
    var headers = rows[0].map(key), known = headers.some(function (h) { return /name|email|phone|tel|mobile/.test(h); });
    if (!known) { headers = rows[0].map(function (_, i) { return i === 0 ? "name" : "value" + i; }); rows.unshift(headers); }
    rows.slice(1).forEach(function (row, index) {
      var raw = {};
      headers.forEach(function (header, i) { raw[header] = text(row[i]); });
      var aliases = {};
      Object.keys(raw).forEach(function (header) { var value = raw[header]; if (!value) return;
        if (/^(name|fullname|displayname|contactname)$/.test(header)) aliases.name = value;
        else if (/^(preferredname|nickname)$/.test(header)) aliases.preferredName = value;
        else if (/^(role|title|jobtitle|position)$/.test(header)) aliases.role = value;
        else if (/^(organisation|organization|company|companyname|org)$/.test(header)) aliases.organisation = value;
        else if (/^(location|city|town|address)$/.test(header)) { aliases.location = value; if (header === "address") aliases.address = value; }
        else if (/^e?mail\d*$/.test(header)) aliases.email = aliases.email ? aliases.email + ", " + value : value;
        else if (/^(phone|telephone|tel|mobile|mobilephone)\d*$/.test(header)) aliases.phone = aliases.phone ? aliases.phone + ", " + value : value;
        else if (/^(otherphone|phone2|mobile2)$/.test(header)) aliases.phoneOther = value;
        else if (/whatsapp/.test(header)) aliases.whatsapp = value;
        else if (/signal/.test(header)) aliases.signal = value;
        else if (/instagram/.test(header)) aliases.instagram = value;
        else if (/facebook/.test(header)) aliases.facebook = value;
        else if (/^(website|url|web)$/.test(header)) aliases.website = value;
        else if (/^(x|twitter|twitterhandle)$/.test(header)) aliases.x = value;
        else if (/^(homeaddress|streetaddress)$/.test(header)) aliases.address = value;
        else if (/^(workaddress|officeaddress)$/.test(header)) aliases.workAddress = value;
        else if (/^(birthday|birthdate|dob)$/.test(header)) aliases.birthday = value;
        else if (/^interests?$/.test(header)) aliases.interests = value;
        else if (/^(social|socialprofiles|profiles)$/.test(header)) aliases.socialProfiles = value;
        else if (/^(note|notes|memo|description)$/.test(header)) aliases.note = value;
      });
      out.push(candidate(aliases, "csv-import", fileName + ":" + (index + 2)));
    });
    return collect(out);
  }
  function unfoldVCard(input) { return text(input).replace(/\r?\n[ \t]/g, ""); }
  function vcard(textValue, fileName) {
    var blocks = unfoldVCard(textValue).split(/BEGIN:VCARD/i).slice(1), out = [];
    blocks.forEach(function (block, index) {
      var raw = {};
      block.split(/END:VCARD/i)[0].split(/\r?\n/).forEach(function (line) {
        var colon = line.indexOf(":"); if (colon === -1) return;
        var head = line.slice(0, colon), parts = head.split(";"), field = lower(parts.shift()), params = lower(parts.join(";")), value = clean(line.slice(colon + 1), params);
        if (field === "fn") raw.name = value;
        else if (field === "n" && !raw.name) { var n = value.split(";"); raw.name = [n[1], n[0]].filter(Boolean).join(" "); }
        else if (field === "org") raw.organisation = value.replace(/;/g, " · ");
        else if (field === "title") raw.role = value;
        else if (field === "email") raw.email = raw.email ? raw.email + ", " + value : value;
        else if (field === "tel") raw.phone = raw.phone ? raw.phone + ", " + value : value;
        else if (field === "adr") { raw.address = value.split(";").filter(Boolean).slice(-3).join(", "); raw.location = raw.address; }
        else if (field === "bday") raw.birthday = value;
        else if (field === "note") raw.note = value;
        else if (field === "url" || field.indexOf("socialprofile") !== -1 || field.indexOf("x-social") !== -1) {
          if (/instagram/.test(params + " " + value)) raw.instagram = value;
          else if (/facebook/.test(params + " " + value)) raw.facebook = value;
          else if (/whatsapp/.test(params + " " + value)) raw.whatsapp = value;
          else if (/twitter|(^|\s)x($|\s)/.test(params + " " + value)) raw.x = value;
          else if (!raw.website) raw.website = value;
        }
      });
      out.push(candidate(raw, "vcard-import", fileName + ":" + (index + 1)));
    });
    return collect(out);
  }
  function dateISO(value) {
    var raw = text(value).replace(/^\s+|\s+$/g, "");
    if (/^\d{8}$/.test(raw)) return raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8) + "T12:00:00.000Z";
    if (/^\d{8}T\d{6}Z$/.test(raw)) return raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8) + "T" + raw.slice(9, 11) + ":" + raw.slice(11, 13) + ":" + raw.slice(13, 15) + ".000Z";
    if (/^\d{8}T\d{6}$/.test(raw)) return raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8) + "T" + raw.slice(9, 11) + ":" + raw.slice(11, 13) + ":" + raw.slice(13, 15) + ".000Z";
    return raw;
  }
  function calendar(textValue, fileName) {
    var blocks = unfoldVCard(textValue).split(/BEGIN:VEVENT/i).slice(1), out = [];
    blocks.forEach(function (block, index) {
      var raw = { attendees: [] };
      block.split(/END:VEVENT/i)[0].split(/\r?\n/).forEach(function (line) {
        var colon = line.indexOf(":"); if (colon === -1) return;
        var head = line.slice(0, colon), value = clean(line.slice(colon + 1)), parts = head.split(";"), field = lower(parts.shift()), params = parts.join(";");
        if (field === "summary") raw.title = value;
        else if (field === "description") raw.summary = value;
        else if (field === "location") raw.location = value;
        else if (field === "dtstart") raw.occurredAt = dateISO(value);
        else if (field === "attendee" || field === "organizer") {
          var email = value.replace(/^mailto:/i, ""), match = /cn="?([^";]+)"?/i.exec(params), name = match ? clean(match[1]) : email.split("@")[0];
          if (email || name) raw.attendees.push({ name: name, email: email });
        }
      });
      var attendees = raw.attendees.filter(function (item, attendeeIndex, all) { return item.email || item.name ? all.findIndex(function (other) { return lower(other.email) === lower(item.email) && lower(other.name) === lower(item.name); }) === attendeeIndex : false; });
      if (raw.title || raw.summary || raw.occurredAt) out.push({ kind: "interaction", title: raw.title || "Calendar event", summary: raw.summary || "", location: raw.location || "", occurredAt: raw.occurredAt || "", attendees: attendees, sourceType: "calendar-import", sourceRef: fileName + ":" + (index + 1) });
    });
    return out;
  }
  /* review() is the primary entry point: it returns { candidates, skippedCount }
   * so the review screen can report how many automated/incomplete records were
   * filtered. Calendar files carry events, which are never filtered. */
  function review(input, fileName) {
    var name = lower(fileName), value = text(input);
    if (/\.vcf$|vcard/.test(name) || /BEGIN:VCARD/i.test(value)) return vcard(value, fileName || "contacts.vcf");
    if (/\.ics$|ical|calendar/.test(name) || /BEGIN:VEVENT/i.test(value)) { var events = calendar(value, fileName || "calendar.ics"); return { candidates: events, skippedCount: 0 }; }
    return csv(value, fileName || "contacts.csv");
  }
  /* parse() keeps its original array contract for any existing caller/test. */
  function parse(input, fileName) { return review(input, fileName).candidates; }
  var api = { parse: parse, review: review, csv: csv, vcard: vcard, calendar: calendar };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitNetworkImporters = api;
})(typeof window !== "undefined" ? window : globalThis);
