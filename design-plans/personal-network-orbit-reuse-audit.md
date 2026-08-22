# ORBIT Personal Network — reuse audit and implementation map

**Date:** 21 August 2026  
**Scope:** ORBIT source, design references, Context, charting, intelligence, registry/profile work, and the current Personal Network foundation.  
**Purpose:** identify what should be reused, what should be adapted, and what must remain law-enforcement-specific.

## Outcome

The Personal Network should be built as a neutral sibling surface on ORBIT's existing analytical spine. The repository already contains the important primitives:

- a local-first, subscribable entity/link store with stable identity-derived IDs;
- a native shared case-file adapter with locking and change notifications;
- analyst-reviewed extraction and deconfliction flows;
- temporal events, timeline rendering, honest aggregation, and finding generation;
- graph centrality, brokerage, clusters, paths and related network measures;
- evidence/assertion storage, provenance, source references and withdrawal semantics;
- a subject-profile assembler whose useful pattern is “claims + conflicts + appearances + source references”.

The Personal Network foundation currently uses only the first two of those. Its graph is real and persisted, but its profile is still a small selection overlay: it does not yet assemble interactions, facts, historical context, commitments or evidence-backed recommendations.

The next substantial slice should therefore be the neutral record and temporal model, not more orbit decoration.

## Three findings that determine the build

### 1. ORBIT has two kinds of “Context”

The existing Context surface is a read-only strategic/public-source product: country profiles, threat indicators, corridors, routes, trends, maps, sources and “as of” dates. It deliberately does not mutate a case and does not grade intelligence (`src/context/context-view.js`).

That screen should not be copied into Personal Network. Its reusable design grammar is valuable:

- a clearly named context mode;
- current summary plus historical series;
- source and date attached to each figure;
- progressive detail rather than a wall of records;
- a detail view that explains what a number means and where it came from;
- map/timeline-style views where the relationship is spatial or temporal.

Personal Network Context should mean: **what was true about this person, relationship or opportunity at a chosen point in time, and what evidence supports it?**

### 2. The Subject Profile work is an aggregation pattern, not a domain schema

`src/registry/core/dossier.js` and the Subject Profile references demonstrate a strong neutral pattern:

- collect linked material around a selected person;
- retain each claim rather than overwriting it;
- choose a deterministic convenience value;
- expose conflicts instead of hiding them;
- retain dated appearances and source references;
- distinguish generated evidence from authored assessment.

The law-enforcement fields must not cross into the personal product: risk, warnings, criminality, government classification, agency handling, MoRiLE/NIM, PNC/VISOR-style markers and operational dissemination controls remain outside this surface. The Personal Network equivalent is a **Contact Profile** whose claims cover contact methods, work, projects, interests, needs, offers, commitments, relationship history and notes.

### 3. The current Personal Network model has the right shell but not the historical spine

The foundation in `src/personal-network/` already has:

- orbit placement from deterministic relationship signals;
- real people and links from `OrbitCase`;
- manual person creation;
- source-status display;
- opportunity-mode filtering;
- a contact-profile-labelled selection panel.

It does not yet have a first-class interaction/event collection, fact assertions, validity windows, evidence links, or profile/timeline assembly. The next implementation should add those as data and pure domain functions first, then expose them through the UI.

## Reuse map

| ORBIT capability | Reuse decision | Personal Network use |
|---|---|---|
| `src/_shared/core/orbit-case.js` | Reuse directly through an adapter | Canonical people, organisations, interactions, facts, relationships and opportunities; stable IDs; subscriptions; local-first persistence |
| `src/_shared/core/case-file.js` | Reuse directly | Native shared case file, lock/read-only state, atomic save and cross-surface change feed |
| `src/_shared/core/assertions.js` | Reuse the mechanics, rename the vocabulary | Per-field evidence, source type, observed/valid dates, supersession and conflicting claims |
| `src/charting/timeline.js` | Adapt; do not load the whole DOM module | Personal timeline renderer over neutral events, using the existing grade/coverage/selection lessons |
| `src/charting/aggregate.js` | Reuse pure functions | Large interaction histories, calendar periods, top categories with explicit remainder, no silent truncation |
| `src/charting/netanalysis.js` | Reuse with a personal-store adapter | Degree, betweenness/brokers, clusters, paths, k-core and network position in a profile |
| `src/charting/analytics.js` | Adapt the explanatory pattern | “What stands out” panels for relationship activity, introductions and dormant periods; no invented conclusions |
| `src/charting/importer.js` | Reuse the CSV parsing/import shell | CSV exports, contact exports and future source adapters, always followed by review |
| `src/charting/review.js` | Reuse the analyst-in-the-loop interaction | Preview entities/facts/relationships, accept/reject, source highlighting, ambiguous-match review |
| `src/intelligence/extract.js` | Reuse the rule-backed extraction engine selectively | Names, organisations, emails, phones, dates, projects and relationship cues from notes/messages; low-confidence results remain reviewable |
| `src/charting/match.js` / registry matching patterns | Adapt identity resolution | Exact email/phone/handle first; contextual/fuzzy suggestions second; never silently merge label-only people |
| `src/registry/core/dossier.js` | Reimplement the aggregation shape neutrally | Contact Profile assembly, claims, deterministic convenience values, conflicts, appearances and evidence trails |
| `src/registry/core/spine-sync.js` | Reuse lifecycle principles, not registry semantics | Authorised/accepted import assertions enter the shared personal spine; withdrawn/deleted source contributions detach honestly |
| `src/context/context-view.js` | Reuse visual grammar, not data or law-enforcement content | A profile Context view with current state, historical snapshots, source/date captions and expandable evidence |
| `src/_shared/css/tokens.css`, `app.css`, `side-panels.css` | Reuse directly | ORBIT type ramp, mint palette, panel material, spacing, focus and reduced-motion behaviour |
| `src/charting/inspector.js` and proposed `record-card` direction | Use as the interaction target | One consistent Contact Profile/evidence drawer from graph, timeline, search and opportunity views |

## The Personal Network data spine

Keep the existing `OrbitCase` entity/link model as the persistence spine. Do not create a second address-book database.

Use neutral entities such as:

```text
person
organisation
project
place
interaction
fact
opportunity
commitment
note
```

Use typed links for relationships and evidence connections:

```text
ME_KNOWS, KNOWS, WORKS_WITH, WORKS_FOR, WORKED_ON,
ATTENDED, INTRODUCED, MENTIONED_IN, SUPPORTED_BY,
ABOUT, INVOLVES, PROMISES, RELATED_TO
```

An interaction is an entity rather than only an event-array row when it needs content, participants, source reference or extracted facts. Its attributes should include at least `occurredAt`, `source`, `sourceRef`, `direction`, `channel`, `title/summary` and `participantIds` or equivalent links.

A fact is an assertion, not a bare profile field:

```text
{
  value,
  factType,
  sourceType: private | public | user-entered | calculated | ai-inference,
  sourceRef,
  observedAt,
  validFrom,
  validUntil,
  confidence,
  supersededBy,
  assertedBy
}
```

Calculated relationship metrics must remain distinguishable from user-entered facts and AI interpretations. The product should never turn a score into a fact such as “close friend” without showing the basis.

## What “Context” should become

Context should be available from a selected Contact Profile and, later, as a network-wide mode. It should answer four questions:

1. **Now:** what is currently active or most recently observed?
2. **Then:** what changed, and when?
3. **Why:** which interactions or notes support this interpretation?
4. **As of:** what would the profile have shown at a chosen historical date?

### Profile Context layout

- **Current context:** current role/organisation, active projects, current interests, needs/offers, location and recent relationship state.
- **Change rail:** dated changes such as job moves, projects, location changes, new interests, introductions, promises and relationship trajectory changes.
- **Historical snapshot:** a date slider or year/period selector that filters facts by `validFrom`/`validUntil` and interactions by occurrence date.
- **Evidence drawer:** each fact expands to its source item, source type, observed date, confidence/provenance and superseded state.
- **Related network:** people, organisations and projects that explain the context; clicking one re-centres the profile or graph.

### Historical relationship view

The relationship timeline should not only show message dots. It should show phases derived from evidence:

```text
first contact → active exchange → introduction/project → quieter period → reconnect
```

The phase labels are calculated interpretations and must be visibly labelled as such. The underlying interactions remain inspectable. Dormancy should compare the current gap with that relationship’s own historical cadence, as required by the brief; lack of an interaction is never presented as proof that no interaction occurred.

### What can be borrowed from the existing Context visuals

- trend series and small multiples for interaction volume/cadence;
- source + “as of” captions;
- controlled layer visibility for current facts, historical facts, interactions and opportunities;
- map treatment later for places, travel and shared locations;
- explicit empty and unavailable states;
- direct labels and explanations rather than colour-only legends.

## Source strategy

The current Personal Network source list is a placeholder and still names Slack/LinkedIn. Make sources declarative so connectors can be swapped without changing the domain model.

The first neutral source registry should allow:

```text
Gmail, Google Calendar, Contacts, Phone/Call Log, Notes, CSV,
WhatsApp export, Facebook export, Instagram export
```

Facebook and Instagram fit best as optional import adapters, not as assumptions about a live API connection. Messages, comments, event participation and explicit profile/contact data are stronger evidence than likes, follows or views. Social handles belong in digital contact methods; a social signal must not silently become a personal fact.

Every adapter should produce the same reviewable intermediate shape:

```text
source item → candidate people → candidate interaction → candidate facts/links → review → OrbitCase
```

## Phased implementation plan

### Phase 1 — neutral record and evidence contract

- Add a personal-domain projection over `OrbitCase` for interactions, facts, commitments and opportunities.
- Add assertion helpers for source type, source reference, observed date, validity and supersession.
- Make source identifiers configurable and replace the stale placeholder list.
- Keep manual additions explicitly `user-entered`.
- Add pure tests for snapshot-at-date, current-vs-superseded facts, source classification and deterministic identity keys.

### Phase 2 — Contact Profile and historical Context

- Replace the small selection overlay with a reusable Contact Profile panel.
- Add Summary, Context, Timeline, Network and Evidence sections or tabs.
- Reuse the Context source/date caption and trend patterns.
- Assemble current facts, historical facts, interactions, commitments and opportunities without importing law-enforcement profile fields.
- Add “as of” filtering and a dated change rail.

### Phase 3 — imports and review

- Build CSV/contacts/manual adapters first.
- Add Gmail and Calendar normalization next.
- Add WhatsApp/Facebook/Instagram export adapters as optional source modules.
- Reuse Charting review patterns for source highlighting, candidate matches, accept/reject and provenance-preserving commit.
- Publish accepted contributions through the existing local-first spine; support withdrawal/detach when an imported source is removed or superseded.

### Phase 4 — analytical views

- Add the neutral personal timeline using the existing aggregation rules.
- Add relationship matrix/table and a selectable network analysis view.
- Reuse `CRNet` for network position, but label each measure plainly: degree, bridge/betweenness, cluster, path.
- Add coverage statements to counts: “interactions held”, “dated interactions”, “sources connected”.

### Phase 5 — deterministic opportunity detectors

Start with detectors whose evidence can be explained without an LLM:

1. dormant relationship against personal historical cadence;
2. outstanding promise with no matching completion evidence;
3. introduction candidate where one person needs something and another offers it;
4. reciprocal-help signal;
5. opportunity mention from an imported or manually entered interaction.

Each result should contain the candidate, detector, evidence list, calculated inputs, freshness and a review state. AI can explain or rank a candidate later; it should not be the sole source of the candidate.

## Boundaries

Do not reuse these as personal-network fields or labels:

- subject, nominal, criminal associate, risk, warning, threat area;
- 3×5×2 intelligence grade as a grade on a person;
- government classification, agency handling, PND, MoRiLE or NIM;
- law-enforcement warning markers, criminality or operational assessment;
- a generated “Subject Profile” claim.

The personal product can reuse provenance mechanics, but its language should be: **source, evidence, user-entered, calculated, AI inference, observed, valid, superseded and reviewed**.

## Acceptance checks for the next build slice

- A manually added fact appears in the Contact Profile with `user-entered` provenance.
- An imported fact can be opened back to its source item.
- A changed role shows both the current value and the historical value with dates.
- An “as of” date never shows a fact before `validFrom` or after `validUntil`.
- A withdrawn import removes only its own contribution; another source’s assertion remains.
- Timeline counts state their base and do not silently drop undated interactions.
- A network score names its measure and does not masquerade as relationship truth.
- Facebook/Instagram exports can be disabled without changing the profile schema.
- Selecting a person from the orbit, timeline, search or opportunity view opens the same Contact Profile surface.

## Recommended next implementation slice

Build Phase 1 plus the non-visual foundation of Phase 2: a neutral personal-domain projection, assertions, date validity, and a pure Contact Profile assembler. Then add the Context and Timeline sections on top of that contract. This makes the “address book with historical intelligence” real while preserving the existing ORBIT orbit as the primary overview.

## Mobile and vault architecture

The Personal Network should become a **vault-backed companion application**: desktop and mobile are two clients of the same user-owned data, not two databases that happen to exchange contacts.

### Recommended model

```text
user-owned ORBIT vault
    ├── people/
    ├── organisations/
    ├── interactions/
    ├── facts/
    ├── opportunities/
    ├── sources/
    ├── assets/
    └── manifest + sync journal

desktop client ─┐
mobile client  ─┴─ local index/cache → vault sync → conflict review
```

The vault format should be independent of the UI. `OrbitCase` remains the in-memory/domain façade, while a future `OrbitVault` adapter becomes the durable multi-device layer. The current `OrbitCaseFile` adapter can remain the native desktop implementation behind that façade, but mobile must not depend on `localStorage`, IndexedDB exports or the desktop process lock.

### Why a vault rather than one shared JSON blob

Obsidian’s useful idea is ownership and portability: the user has a folder of data that can be backed up, copied and opened by more than one client. For Personal Network, separate records are safer than one ever-growing case file:

- two devices can edit different people without rewriting the whole vault;
- interactions and imported source items can be appended;
- facts can be superseded instead of overwritten, preserving historical Context;
- a sync engine can detect the same record changing on two devices;
- assets such as contact photos, attachments and source exports remain addressable;
- the desktop app can rebuild its search and graph indexes from the vault.

The canonical records should be small, stable and source-referenced. Derived graph positions, scores, summaries and opportunity rankings should be rebuildable caches, not the only copy of truth.

### Sync rules

Sync should be operation-aware rather than “last modified file wins”:

- new interactions append;
- corrections create a new assertion or superseding fact;
- identical source items deduplicate by source fingerprint;
- edits to different fields merge;
- edits to the same fact value become a visible conflict;
- deletes become tombstones or withdrawals, not silent disappearance;
- every device records actor/device/time for the change;
- a conflict opens a review screen and never silently chooses a winner.

The existing local case-file lock protects one desktop process. It should not be treated as a cloud-sync protocol. A vault sync layer will need a change journal, stable record IDs, revision/base-revision fields and a recoverable conflict queue.

### Mobile’s first useful job

The mobile app should be capture-first, not a shrunken orbit dashboard:

- search and open a Contact Profile;
- add a person, note, interaction, promise or follow-up;
- record a meeting or introduction while it happens;
- attach a source, photo or voice-note transcript for later review;
- see recent Context and historical Timeline;
- review opportunities and draft an action;
- work offline and sync when connected.

The full network graph, dense analytics and large import/review flows remain desktop-first initially. Both clients should open the same Contact Profile and evidence records, so a fact captured on mobile appears in the desktop Context view without a separate translation step.

### Delivery route

1. Define and test the portable vault record format and sync journal.
2. Move the personal domain from direct `OrbitCase` persistence to a `OrbitVault`-compatible repository interface while retaining the current browser/native adapter.
3. Build a responsive mobile capture/profile surface as an installable PWA or shared web client.
4. Add a native mobile shell when filesystem access, encrypted vault storage, background sync or contact/call integration requires it.
5. Add encrypted backup/sync as an explicit user-controlled capability; never make a third-party cloud the silent system of record.

This gives the product an Obsidian-like ownership model without copying Obsidian’s document editor: ORBIT remains a structured, evidence-aware relationship intelligence system whose vault can be inspected, backed up and used by both desktop and mobile clients.
