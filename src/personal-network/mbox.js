/* mbox.js — reading a Gmail Takeout mailbox, locally.
 *
 * Takeout hands you one enormous mbox file. Orbit never uploads it and never
 * reads a message body: only the headers that say who wrote to whom and when.
 * The reader is fed one line at a time so a multi-gigabyte export can be
 * streamed through it without ever being held in memory, and so the same code
 * can be driven from a string under test.
 *
 * What comes out is a summary per correspondent — how many messages, which way
 * they went, when the first and last were — plus a handful of recent messages
 * kept whole so the profile has a timeline you can click through to Gmail.
 *
 * Browser: window.OrbitMbox. Node: module.exports.
 */
(function (root) {
  "use strict";

  var HEADERS = { from: 1, to: 1, cc: 1, date: 1, subject: 1, "message-id": 1 };
  /* A real mbox separator is "From <sender> <Day> <Mon> <dd> ..." — insisting on
   * the date shape stops a message body that happens to begin "From now on"
   * from being read as the start of a new message. */
  var SEPARATOR = /^From \S* ?[A-Z][a-z]{2} [A-Z][a-z]{2} ?\d/;

  function text(value) { return value == null ? "" : String(value); }
  function lower(value) { return text(value).toLowerCase(); }

  function fromBase64(value) {
    try {
      if (typeof atob === "function") {
        var binary = atob(text(value).replace(/\s+/g, ""));
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      }
      if (typeof Buffer !== "undefined") return Buffer.from(text(value), "base64").toString("utf8");
    } catch (e) { /* fall through */ }
    return "";
  }
  /* Mail headers carry non-ASCII as "=?utf-8?B?…?=" or "=?utf-8?Q?…?=". Names
   * are worth decoding; anything unrecognised is left exactly as it arrived. */
  function decodeWords(value) {
    return text(value).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, function (whole, charset, kind, payload) {
      var decoded;
      if (kind === "B" || kind === "b") decoded = fromBase64(payload);
      else {
        decoded = payload.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, function (_, hex) {
          return String.fromCharCode(parseInt(hex, 16));
        });
        if (/utf-?8/i.test(charset)) {
          try { decoded = decodeURIComponent(escape(decoded)); } catch (e) { /* leave as-is */ }
        }
      }
      return decoded || whole;
    }).replace(/\?=\s+=\?/g, "?==?");
  }

  /* "Katie Rose <kate@example.com>, tom@example.com" -> [{name, email}] */
  function addresses(value) {
    var raw = text(value), out = [], buffer = "", quoted = false, angled = false;
    function flush() {
      var one = buffer.trim(); buffer = "";
      if (!one) return;
      var email = "", name = "";
      var angle = /<([^>]*)>/.exec(one);
      if (angle) { email = angle[1].trim(); name = one.slice(0, angle.index).trim(); }
      else { email = one; }
      name = decodeWords(name).replace(/^["']|["']$/g, "").trim();
      email = email.replace(/^mailto:/i, "").trim().toLowerCase();
      if (email.indexOf("@") > 0) out.push({ name: name === email ? "" : name, email: email });
    }
    for (var i = 0; i < raw.length; i++) {
      var ch = raw.charAt(i);
      if (ch === '"') { quoted = !quoted; buffer += ch; continue; }
      if (ch === "<" && !quoted) angled = true;
      if (ch === ">" && !quoted) angled = false;
      if (ch === "," && !quoted && !angled) { flush(); continue; }
      buffer += ch;
    }
    flush();
    return out;
  }

  /* A line-at-a-time reader. Bodies are counted past, never collected. */
  function createReader(onMessage) {
    var headers = null, field = "", inBody = false;
    function finish() {
      if (headers && field) commit();
      if (headers && Object.keys(headers).length) onMessage(headers);
      headers = null; field = ""; inBody = false;
    }
    function commit() {
      var colon = field.indexOf(":");
      if (colon > 0) {
        var name = lower(field.slice(0, colon)).trim();
        if (HEADERS[name] && headers[name] === undefined) headers[name] = field.slice(colon + 1).trim();
      }
      field = "";
    }
    return {
      line: function (value) {
        var raw = text(value).replace(/\r$/, "");
        if (SEPARATOR.test(raw)) { finish(); headers = {}; return; }
        if (headers === null) return;             /* preamble before the first message */
        if (inBody) return;                        /* bodies are none of our business */
        if (raw === "") { commit(); inBody = true; return; }
        if (/^[ \t]/.test(raw)) { field += " " + raw.trim(); return; }
        commit();
        field = raw;
      },
      end: finish
    };
  }

  function messageDate(headers) {
    var when = Date.parse(text(headers.date));
    return isNaN(when) ? NaN : when;
  }
  function messageId(headers) {
    return text(headers["message-id"]).replace(/^<|>$/g, "").trim();
  }
  /* A Gmail message can be reopened from its RFC822 id, which is the one part of
   * a message that does not change. */
  function gmailLink(id) {
    return id ? "https://mail.google.com/mail/u/0/#search/rfc822msgid:" + encodeURIComponent(id) : "";
  }

  /* Roll a stream of messages up per correspondent.
   * opts: { mine:[addresses], since:millis, keepRecent:n, now:millis } */
  function createSummary(opts) {
    opts = opts || {};
    var mine = Object.create(null);
    (opts.mine || []).forEach(function (address) { var a = lower(address).trim(); if (a) mine[a] = true; });
    var since = opts.since == null ? -Infinity : opts.since;
    var keep = opts.keepRecent == null ? 5 : opts.keepRecent;
    var people = Object.create(null);
    var counts = { read: 0, kept: 0, skippedOld: 0, skippedUndated: 0, skippedNoParty: 0 };

    function entry(address, name) {
      var row = people[address];
      if (!row) row = people[address] = { email: address, name: "", total: 0, sent: 0, received: 0, firstAt: 0, lastAt: 0, recent: [] };
      if (name && (!row.name || row.name.length < name.length)) row.name = name;
      return row;
    }
    return {
      add: function (headers) {
        counts.read++;
        var when = messageDate(headers);
        if (isNaN(when)) { counts.skippedUndated++; return; }
        if (when < since) { counts.skippedOld++; return; }
        var senders = addresses(headers.from);
        var others = addresses(headers.to).concat(addresses(headers.cc));
        var sender = senders[0];
        var outbound = sender ? !!mine[sender.email] : false;
        /* Whoever is not you is the correspondent; a message with only your own
         * addresses on it tells us nothing about anyone. */
        var parties = outbound ? others.filter(function (a) { return !mine[a.email]; })
          : (sender && !mine[sender.email] ? [sender] : []);
        if (!parties.length) { counts.skippedNoParty++; return; }
        counts.kept++;
        var subject = decodeWords(headers.subject).trim();
        var mid = messageId(headers);
        parties.forEach(function (party) {
          var row = entry(party.email, party.name);
          row.total++;
          if (outbound) row.sent++; else row.received++;
          if (!row.firstAt || when < row.firstAt) row.firstAt = when;
          if (when > row.lastAt) row.lastAt = when;
          if (keep > 0) {
            row.recent.push({ at: when, subject: subject || "(no subject)", direction: outbound ? "sent" : "received", id: mid, link: gmailLink(mid) });
            row.recent.sort(function (a, b) { return b.at - a.at; });
            if (row.recent.length > keep) row.recent.length = keep;
          }
        });
      },
      result: function () {
        var rows = Object.keys(people).map(function (address) { return people[address]; });
        rows.sort(function (a, b) { return b.total - a.total || a.email.localeCompare(b.email); });
        return { people: rows, counts: counts };
      }
    };
  }

  /* Convenience for tests and small files: parse a whole mbox string. */
  function summarise(mboxText, opts) {
    var summary = createSummary(opts);
    var reader = createReader(function (headers) { summary.add(headers); });
    text(mboxText).split(/\n/).forEach(function (line) { reader.line(line); });
    reader.end();
    return summary.result();
  }

  var api = {
    createReader: createReader, createSummary: createSummary, summarise: summarise,
    addresses: addresses, decodeWords: decodeWords, gmailLink: gmailLink, messageId: messageId
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OrbitMbox = api;
})(typeof window !== "undefined" ? window : globalThis);
