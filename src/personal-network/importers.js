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
      tags: text(raw.tags || raw.labels),
      igHandle: text(raw.igHandle),
      sourceType: sourceType,
      sourceRef: sourceRef
    };
    if (!out.name && !out.email) return null;
    /* Classify from the REAL name (before any email fallback), so an automated
     * or organisation address is judged on what it actually is. */
    var verdict = Classify ? Classify.classify({
      name: out.name, organisation: out.organisation, emails: [out.email],
      details: [out.phone, out.phoneOther, out.role, out.organisation, out.location, out.address,
        out.workAddress, out.website, out.whatsapp, out.signal, out.birthday, out.interests, out.note],
      social: [out.instagram, out.facebook, out.x, out.socialProfiles]
    }) : { category: "individual" };
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
  /* LinkedIn (and some other) exports carry a preamble before the header row and
   * split the name across First/Last Name, so we locate the real header row
   * rather than assuming row 0. */
  /* Google Contacts exports repeat fields as "E-mail 1 - Value", "Phone 2 - Label"
   * and "Organization 1 - Title". Collapse each to its plain field name, keeping
   * the index so two numbers stay two distinct columns, and drop the Label/Type
   * columns — those hold "Home"/"Work", not a value. Anything without Google's
   * " - " suffix is keyed exactly as before. */
  function normaliseHeader(value) {
    var raw = lower(value).replace(/\s+/g, " ").trim();
    var parts = raw.match(/^(.+?)\s+(\d+)?\s*-\s+(.+)$/);
    if (!parts) return key(raw);
    var part = key(parts[3]);
    if (part === "label" || part === "type") return "";
    return key(parts[1]) + (parts[2] || "") + (part === "value" || part === "formatted" ? "" : part);
  }
  function looksLikeHeaderRow(row) {
    return row.map(normaliseHeader).some(function (h) { return /^(firstname|givenname|lastname|familyname|fullname|displayname|contactname|name|emailaddress|email\d*|phone\d*|mobile|tel|telephone)$/.test(h); });
  }
  function csv(textValue, fileName) {
    var rows = splitCSV(textValue), out = [];
    if (!rows.length) return collect(out);
    var headerIndex = -1;
    for (var r = 0; r < rows.length && r < 8; r++) { if (looksLikeHeaderRow(rows[r])) { headerIndex = r; break; } }
    var headers, dataRows, base;
    if (headerIndex === -1) { headers = rows[0].map(function (_, i) { return i === 0 ? "name" : "value" + i; }); dataRows = rows; base = 1; }
    else { headers = rows[headerIndex].map(normaliseHeader); dataRows = rows.slice(headerIndex + 1); base = headerIndex + 2; }
    dataRows.forEach(function (row, index) {
      var raw = {};
      headers.forEach(function (header, i) { raw[header] = text(row[i]); });
      var aliases = {}, firstName = "", lastName = "";
      Object.keys(raw).forEach(function (header) { var value = raw[header]; if (!value) return;
        if (/^(name|fullname|displayname|contactname)$/.test(header)) aliases.name = value;
        else if (/^(firstname|givenname)$/.test(header)) firstName = value;
        else if (/^(lastname|familyname|surname)$/.test(header)) lastName = value;
        else if (/^(preferredname|nickname)$/.test(header)) aliases.preferredName = value;
        else if (/^(role|title|jobtitle|position)$/.test(header) || /^(organisation|organization|company|org)\d*title$/.test(header)) aliases.role = value;
        else if (/^(organisation|organization|company|org)\d*(name)?$/.test(header)) aliases.organisation = value;
        else if (/^(location|city|town)$/.test(header)) aliases.location = value;
        else if (/^e?mail(address)?\d*$/.test(header)) aliases.email = aliases.email ? aliases.email + ", " + value : value;
        /* The first number is the phone, the rest join phoneOther — the two
         * fields the contact form actually has. */
        else if (/^(phone|telephone|tel|mobile|mobilephone)\d*$/.test(header)) {
          if (!aliases.phone) aliases.phone = value;
          else aliases.phoneOther = aliases.phoneOther ? aliases.phoneOther + ", " + value : value;
        }
        else if (/^(otherphone|phone2|mobile2)$/.test(header)) aliases.phoneOther = value;
        else if (/whatsapp/.test(header)) aliases.whatsapp = value;
        else if (/signal/.test(header)) aliases.signal = value;
        else if (/instagram/.test(header)) aliases.instagram = value;
        else if (/facebook/.test(header)) aliases.facebook = value;
        else if (/^(website|url|web|profile)\d*$/.test(header)) aliases.website = value;
        else if (/^(x|twitter|twitterhandle)$/.test(header)) aliases.x = value;
        else if (/^(workaddress|officeaddress)$/.test(header)) aliases.workAddress = value;
        else if (/^(address|homeaddress|streetaddress)\d*$/.test(header)) aliases.address = aliases.address || value;
        else if (/^(birthday|birthdate|dob)$/.test(header)) aliases.birthday = value;
        else if (/^interests?$/.test(header)) aliases.interests = value;
        else if (/^(social|socialprofiles|profiles)$/.test(header)) aliases.socialProfiles = value;
        else if (/^(note|notes|memo|description)$/.test(header)) aliases.note = value;
        /* Google exports its contact groups as "Labels", separated by ":::",
         * with a "* myContacts" marker that is bookkeeping rather than a tag. */
        else if (/^(labels?|tags?|groups?|categor(y|ies))$/.test(header)) {
          aliases.tags = value.split(/:::|[;,]/).map(function (t) { return text(t); })
            .filter(function (t) { return t && t.charAt(0) !== "*"; }).join(", ");
        }
      });
      if (!aliases.name && (firstName || lastName)) aliases.name = [firstName, lastName].filter(Boolean).join(" ");
      out.push(candidate(aliases, "csv-import", fileName + ":" + (base + index)));
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
  /* Instagram exports list each account as a string_list_data entry whose
   * `value` is the handle and `href` is the profile URL. */
  function instagramProfile(item) {
    var entry = item && item.string_list_data && item.string_list_data[0];
    if (!entry) return null;
    var handle = text(entry.value), href = text(entry.href);
    if (!handle && href) handle = href.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/+$/, "");
    if (!handle) return null;
    return { name: handle, instagram: handle, igHandle: lower(handle) };
  }
  function jsonItem(item, note, sourceType, fileName, index) {
    var ref = fileName + ":" + (index + 1);
    if (item == null) return null;
    if (typeof item === "string") { var s = text(item); return s ? candidate({ name: s, note: note }, sourceType, ref) : null; }
    if (typeof item !== "object") return null;
    if (item.string_list_data) {
      var ig = instagramProfile(item); if (!ig) return null;
      var built = candidate(ig, "instagram-import", ref);
      /* Same treatment as a pasted list: the direction becomes a follow link
       * rather than a note. An export carries no owner, which means "mine". */
      if (built && built.candidate && /follow/i.test(text(note))) {
        built.candidate.igHandle = lower(ig.igHandle || "");
        built.candidate.igOwner = "";
        built.candidate.igDirection = /following/i.test(note) ? "following" : "follower";
      }
      return built;
    }
    var raw = {
      name: first([item.name, item.fullName, item.fullname, item.fn, item.displayName, item.title]),
      email: first([item.email, item.emailAddress, item.email_address]),
      phone: first([item.phone, item.phoneNumber, item.phone_number, item.tel, item.mobile]),
      organisation: first([item.organisation, item.organization, item.company, item.org]),
      role: first([item.role, item.jobTitle, item.job_title, item.position]),
      facebook: text(item.facebook),
      instagram: text(item.instagram),
      note: note
    };
    if (!raw.name && !raw.email) return null;
    return candidate(raw, sourceType, ref);
  }
  /* ---- A follower list copied out of the Instagram page ----
   * Not the official export (that arrives as JSON and is handled above), but
   * what you get selecting the list in a browser and pasting it: one handle per
   * line, each OPTIONALLY followed by its display name, with the avatar's alt
   * text, separator dots and button labels mixed in.
   *
   * Pairing line-by-line drifts the moment one account has no display name —
   * from there every handle is read as a name and every name as a handle, which
   * is why a pasted list came out scrambled. Anchoring on what a handle can
   * actually look like keeps the pairs honest instead. */
  var IG_HANDLE = /^[a-z0-9._]{1,30}$/;
  var IG_CHROME = /^(?:follow|following|follow back|followback|requested|remove|message|verified|suggested for you|close friend|see all)$/i;
  function isHandleLine(value) {
    var v = text(value);
    return IG_HANDLE.test(v) && /[a-z0-9]/.test(v);
  }
  function igNoise(value) {
    var v = text(value);
    if (!v) return true;
    if (/'s profile picture$/i.test(v)) return true;      /* the avatar's alt text */
    if (IG_CHROME.test(v)) return true;
    return !/[a-z0-9\u00c0-\uffff]/i.test(v);             /* a lone separator dot */
  }
  /* True when the text is a bare list of handles rather than a spreadsheet. A
   * spreadsheet carries a separator on nearly every row; one display name that
   * happens to contain a comma ("Mob - delicious, healthy midweek cooking")
   * must not hand the whole file to the CSV reader. */
  function looksLikeHandleList(textValue) {
    var lines = text(textValue).split(/\r?\n/).map(text).filter(function (line) { return !igNoise(line); });
    if (lines.length < 5) return false;
    var separated = lines.filter(function (line) { return line.indexOf(",") !== -1 || line.indexOf("\t") !== -1; }).length;
    if (separated / lines.length > 0.1) return false;
    var handles = lines.filter(isHandleLine).length;
    return handles >= 5 && handles / lines.length >= 0.4;
  }
  /* "benwlsn11_IG_Followers" names the account the list belongs to and the
   * direction it runs in. Official export names ("followers_1.json") carry the
   * direction but no owner, which simply means "mine". */
  function handleListMeta(fileName) {
    var raw = text(fileName).replace(/\.[a-z0-9]+$/i, "");
    var direction = /following/i.test(raw) ? "following" : (/followers?/i.test(raw) ? "follower" : "");
    /* Whatever precedes the direction word is the account the list belongs to,
     * once the platform marker and separators are taken off. A handle may itself
     * contain underscores ("liv._.sim"), so the direction word is the anchor
     * rather than the first separator. */
    var owner = "", cut = raw.search(/(?:followers?|following)\s*$/i);
    if (cut > 0) {
      owner = raw.slice(0, cut).replace(/[\s_\-]*(?:ig|instagram)[\s_\-]*$/i, "").replace(/[\s_\-]+$/, "");
      if (!/^[a-z0-9._]{1,30}$/i.test(owner)) owner = "";
    }
    return { owner: lower(owner), direction: direction };
  }
  function handleList(textValue, fileName) {
    var lines = text(textValue).split(/\r?\n/).map(text).filter(function (line) { return !igNoise(line); });
    var meta = handleListMeta(fileName), out = [], index = 0;
    for (var i = 0; i < lines.length; i++) {
      if (!isHandleLine(lines[i])) continue;             /* a name with no handle above it */
      var handle = lines[i], display = "";
      /* The next line is the display name only if it could not itself be a
       * handle; an account without one is followed straight by the next handle. */
      if (i + 1 < lines.length && !isHandleLine(lines[i + 1])) { display = lines[i + 1]; i++; }
      index++;
      /* The handle is stored bare, not as a URL, so the profile chip reads
       * "kate_tollworthy" and still links through to the account. */
      /* The username is the name. A display name is a vanity label the account
       * can change at will, so it rides along as the preferred name instead. */
      var built = candidate({ name: handle, preferredName: display, instagram: handle }, "instagram-import", fileName + ":" + index);
      if (built && built.candidate) {
        built.candidate.igHandle = handle;
        built.candidate.igOwner = meta.owner;
        built.candidate.igDirection = meta.direction;
      }
      out.push(built);
    }
    return collect(out);
  }
  /* ---- The same list, kept as HTML ----
   * Copying a follower list as plain text throws the avatars away. The HTML
   * flavour of the same copy keeps them, and Instagram labels every avatar
   * "<handle>'s profile picture" — which pairs each image to its account by
   * name rather than by position, so no amount of nesting can misalign them.
   *
   * Deliberately regex-based rather than DOM-based: this module stays pure so
   * the same code runs in the browser and under test in Node. */
  var IMG_TAG = /<img\b[^>]*>/gi;
  function attrOf(tag, name) {
    var m = new RegExp(name + '\\s*=\\s*"([^"]*)"', "i").exec(tag);
    if (!m) m = new RegExp(name + "\\s*=\\s*'([^']*)'", "i").exec(tag);
    return m ? m[1] : "";
  }
  function decodeEntities(value) {
    return text(value)
      .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
      .replace(/&quot;|&#34;/gi, '"')
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&");
  }
  /* handle -> avatar address, read off the alt text. */
  function avatarMap(html) {
    var out = Object.create(null), tags = text(html).match(IMG_TAG) || [];
    tags.forEach(function (tag) {
      var alt = decodeEntities(attrOf(tag, "alt"));
      var named = /^(.+?)'s profile picture$/i.exec(alt);
      if (!named) return;
      var handle = lower(named[1]);
      var src = decodeEntities(attrOf(tag, "src") || attrOf(tag, "data-src"));
      if (handle && src && !out[handle]) out[handle] = src;
    });
    return out;
  }
  function looksLikeHtml(value) { return /<\s*(?:html|body|div|img|a|span)\b/i.test(text(value).slice(0, 4000)); }
  function htmlToLines(html) {
    return decodeEntities(text(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n"));
  }
  /* The text of the page goes through the very same pairing the plain paste
   * uses, then each account picks up its picture by handle. */
  function instagramHtml(html, fileName) {
    var avatars = avatarMap(html);
    var result = handleList(htmlToLines(html), fileName);
    result.candidates.forEach(function (person) {
      var url = avatars[lower(person.igHandle)];
      if (url) person.avatarUrl = url;
    });
    result.avatarCount = result.candidates.filter(function (person) { return !!person.avatarUrl; }).length;
    return result;
  }
  /* Parses contact-shaped JSON: Meta "Download Your Information" exports
   * (Facebook friends, Instagram followers/following) and generic arrays or
   * objects of contact records. Orbit's own vault files use a separate importer. */
  function json(textValue, fileName) {
    var out = [], data;
    try { data = JSON.parse(text(textValue)); } catch (e) { return collect(out); }
    fileName = fileName || "export.json";
    var notes = {
      friends_v2: ["Facebook friend", "facebook-import"], friends: ["Facebook friend", "facebook-import"],
      relationships_following: ["Instagram · following", "instagram-import"], following: ["Instagram · following", "instagram-import"],
      relationships_followers: ["Instagram · follower", "instagram-import"], followers: ["Instagram · follower", "instagram-import"],
      relationships_close_friends: ["Instagram · close friend", "instagram-import"], close_friends: ["Instagram · close friend", "instagram-import"]
    };
    function run(arr, note, sourceType) { (arr || []).forEach(function (item, i) { out.push(jsonItem(item, note, sourceType, fileName, i)); }); }
    if (Array.isArray(data)) {
      var fileMeta = handleListMeta(fileName);
      run(data, fileMeta.direction === "following" ? "Instagram · following" : (fileMeta.direction === "follower" ? "Instagram · follower" : ""), "json-import");
    }
    else if (data && typeof data === "object") {
      var handled = false;
      Object.keys(data).forEach(function (k) {
        if (!Array.isArray(data[k])) return;
        handled = true;
        var meta = notes[k] || ["", "json-import"];
        run(data[k], meta[0], meta[1]);
      });
      if (!handled && (text(data.name) || text(data.email))) out.push(jsonItem(data, "", "json-import", fileName, 0));
    }
    return collect(out);
  }
  /* review() is the primary entry point: it returns { candidates, skippedCount }
   * so the review screen can report how many automated/incomplete records were
   * filtered. Calendar files carry events, which are never filtered. */
  function review(input, fileName) {
    var name = lower(fileName), value = text(input);
    if (/\.vcf$|vcard/.test(name) || /BEGIN:VCARD/i.test(value)) return vcard(value, fileName || "contacts.vcf");
    if (/\.ics$|ical|calendar/.test(name) || /BEGIN:VEVENT/i.test(value)) { var events = calendar(value, fileName || "calendar.ics"); return { candidates: events, skippedCount: 0 }; }
    if (/\.json$/.test(name)) return json(value, fileName || "export.json");
    if (/^\s*[\[{]/.test(value)) { var parsed = json(value, fileName || "export.json"); if (parsed.candidates.length) return parsed; }
    if (looksLikeHtml(value)) {
      var stripped = htmlToLines(value);
      if (looksLikeHandleList(stripped)) return instagramHtml(value, fileName || "instagram.html");
    }
    if (looksLikeHandleList(value)) return handleList(value, fileName || "instagram.txt");
    return csv(value, fileName || "contacts.csv");
  }
  /* parse() keeps its original array contract for any existing caller/test. */
  function parse(input, fileName) { return review(input, fileName).candidates; }
  var api = { parse: parse, review: review, csv: csv, vcard: vcard, calendar: calendar, json: json, handleList: handleList, looksLikeHandleList: looksLikeHandleList, handleListMeta: handleListMeta, instagramHtml: instagramHtml, avatarMap: avatarMap, looksLikeHtml: looksLikeHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitNetworkImporters = api;
})(typeof window !== "undefined" ? window : globalThis);
