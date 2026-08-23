# ORBIT Personal Network development log

## 2026-08-21 - foundation slice

- Added the Personal Network side project under `Projects/Personal_Network/`, with its
  source separated from the main ORBIT workspace.
- Reused OrbitCase and case-file.js for local-first persistence and native case-file support.
- Added deterministic orbit bands, source status, calculated network counts, search, opportunity mode, person selection and a manual person form.
- Added `standalone/build-personal-network.mjs` and the independent Orbit
  desktop manifest.
- Added a local Orbit icon set for the first packaging target.
- No imported or demo statistics are generated. Empty counts remain zero until data is added.
- Added the neutral Contact Profile domain model, using the existing subject-profile structure as a reference while excluding law-enforcement-specific fields.
- Added `profile.js`, a pure Contact Profile read model that assembles current context, dated history, relationship phase, contact methods, commitments and source evidence from the shared entity/link spine.
- Expanded the desktop Contact Profile into Summary, Context, Timeline and Evidence sections. Historical facts are selected by validity/observation date and are not overwritten by newer values.
- Added the first mobile interaction slice: thumb-reachable bottom navigation,
  touch-sized controls, a capture action, and a full-height profile detail
  panel on narrow screens.
- Added the vault repository seam (`vault.js`) so the local case remains the
  current implementation while a synced, user-owned vault can be attached
  behind the same interface.
- Added local copies of the four shared runtime files required by the browser
  surface; the project no longer relies on a filesystem junction into ORBIT.
- Copied the native Tauri shell into `desktop/src-tauri/` and reduced its
  surface manifest to Personal Network only.
- Added a web-app manifest and small offline service worker for phone testing
  and install-to-home-screen use.
- Added portable `orbit.vault.v1` JSON export/import with additive merge semantics,
  so the address book can move between Orbit clients without a server dependency.
- Expanded manual contact capture with preferred name, organisation, location,
  email, phone, Instagram, Facebook, relationship context and a private note.
  Private notes are retained as dated Contact Profile context.
- Added pure CSV and vCard parsers plus a selectable review screen; imported
  contacts are not merged until the user confirms the selected rows.
- Added calendar `.ics` review/import. Events become dated Interaction records,
  link to matching contacts by email/name, and can create an explicitly
  calendar-sourced contact when an attendee is not yet in the network.
- Added an explainable relationship-health score using recency, frequency and
  reciprocity signals, with the component signals surfaced in the profile.
- Installed the Android toolchain required for native packaging, initialized the
  Tauri Android project, and added the Rust library target plus desktop shim
  needed by Tauri mobile builds.
- Added the pinned Tauri npm script and verified a debug ARM64 APK build.
- Added the macOS-only iOS preparation script and package command; it will
  initialize the Tauri Apple project and hand off signing to Xcode.
- Added a local Wi-Fi phone preview script so the web app can be tested on an
  iPhone without Android, macOS or App Store packaging.
- Hardened iPhone vCard import with a `FileReader` fallback, Apple quoted-
  printable decoding, visible merge errors and a service-worker cache bump so
  updated import code reaches the phone.
- Added a phone-specific readability pass: 16px mobile inputs, 48px touch
  controls, larger profile and dialog type, full-screen contact detail, and
  bottom-sheet forms with safe-area padding.
- Replaced the basic phone HTTP server with a live-reload preview server that
  serves the shared runtime correctly and refreshes the open phone page when
  source files change.
- Restored the shared Inter and Geist Mono font assets so the phone preview and
  standalone payload render with the intended typography instead of browser
  fallbacks.
- Reworked the Orbit visual system around the supplied luxury-automotive
  reference: near-black #181818 canvas, scarce Rosso Corsa #da291c, white/grey
  editorial type, 8px spacing rhythm, sharp precision controls, hairlines and
  brightness-step surfaces.

## 2026-08-22 - audit, polish and hardening pass

- **Never a blank screen.** Added a boot gate (`#boot-screen`) shown immediately
  on load, with a spinner and, on failure or a 12s long-stop, a visible "Reload
  Orbit" recovery action. A global `error` / `unhandledrejection` guard reveals
  recovery only while the app has not yet booted, so a script or OAuth-callback
  failure can no longer leave the user on a dead page.
- **Fixed a swallowed OAuth-callback error.** `boot()` set the auth status and
  then called `showAuth()`, which cleared it — so provider/callback errors were
  never shown. Order corrected; callback and provider errors now surface via
  `friendlyAuthMessage()` (maps "provider not enabled", redirect and network
  failures to plain, actionable text).
- **One shared contact classifier (`classify.js`).** Automated/system addresses
  (noreply, no-reply, donotreply, notifications, alerts, updates, newsletter,
  mailer-daemon, postmaster, calendar notifications, and more) are filtered for
  **every** source. Records are classified as individual / organisation /
  generic-inbox / ambiguous. Google Contacts now uses the same classifier
  instead of its own copy.
- **CSV and vCard imports now classify and filter too** (previously only Google
  did). `OrbitNetworkImporters.review()` returns `{ candidates, skippedCount }`
  so the review screen reports how many records were filtered.
- **Duplicate detection extracted to a tested module (`matching.js`).** Matches
  on exact email, normalised phone, exact/close name, name+organisation,
  organisation+generic-inbox and source identifiers; converges two duplicate
  incoming records in one batch; and returns a human reason for every flag
  ("Same phone number", "Same name at Acme"), shown in the review UI.
- **Review screen counts** now include organisations alongside totals, selected,
  filtered and likely-match counts; the selected count reads "N of M selected".
- **People vs organisations are visually distinct**: a gold organisation badge in
  the profile header and a square gold-bordered graph node.
- **Removed off-brand mint/green** from the connected-account state; connected and
  syncing now use the Rosso Corsa / white system. Added a `syncing` status style.
- **Added `DESIGN.md`** at the project root capturing the Ferrari-inspired token
  system and a pre-ship checklist.
- **Security hygiene**: the Google OAuth client-secret JSON is now git-ignored
  (`client/`, `client_secret*.json`); only the publishable Supabase key remains
  in client config.
- **Tests**: `npm test` runs `scripts/test-import-pipeline.mjs` (36 assertions
  covering the full fake-import scenario) and `scripts/test-boot-smoke.mjs` (a
  jsdom boot test asserting a visible surface and zero uncaught errors).

## 2026-08-22 - UX fixes, charting interaction and graph polish

- **Fixed the empty-state overlay covering a populated graph.** The "Bring the
  first relationship into orbit" card used an inverted condition
  (`people === 0`), so it showed *on top of* real contacts with no way to close
  it — the reported "unclosable window". It now appears only at zero contacts.
- **Fixed toolbar overflow.** The 32px-padding editorial button was applied to
  the 7-button workspace toolbar, pushing "Add person" and "Opportunities"
  off-screen; the toolbar row now uses compact buttons and wraps.
- **Removed case-file jargon** per user feedback: the sidebar "evidence stays on
  this device" note, "MANUAL INTELLIGENCE" kickers, provenance form-notes, the
  Supabase auth note, and renamed Evidence/Reachability → Sources/Contact.
- **Added an inline SVG favicon** (no more `/favicon.ico` 404).
- **Draggable nodes with persisted positions.** People nodes can be moved and
  stay where dropped across re-renders; ME stays anchored; the camera only
  refits when the set of people changes.
- **Charting interaction (draw-to-link relationships).** A "Link people" tool
  enters connect mode; dragging from one person to another creates a KNOWS
  relationship saved to the vault (each carries a per-link `contrib` so it can be
  withdrawn). Selecting a relationship offers Remove; imported connections are
  marked non-removable. Escape exits connect mode / clears selection. This is how
  imported contacts (which arrive unconnected) get wired into the network.
- **Graph visual polish.** Solid, gently curved relationship edges instead of the
  dashed sunburst; ME gets a red anchor glow; labels get a stroke outline for
  legibility over the rings; inner-circle contacts read slightly warmer;
  organisations remain gold squares.
- Added a URL-gated (`?orbittest=1`) QA hook exposing select/link/unlink for
  headless screenshot testing, plus `scripts/screenshot-app.mjs` (puppeteer-core)
  which drives the real app with seeded contacts. jsdom + puppeteer-core are now
  devDependencies.

## 2026-08-22 - SOLAR-style charting interaction (right-click context menu)

Mirrored SOLAR Charting's interaction model (`Solar/src/charting/chartmenu.js`),
which runs on the same vis-network engine this surface already uses — so this is
an interaction port, not an engine change. A dev bypass (`?dev=1`, sticky) was
also added to skip the sign-in gate during development.

- **Right-click / long-press context menu** (`.ctx-menu`, ported styling):
  - Node: Open profile · Edit contact… · **Link from here →** · Pin/Unpin ·
    Delete contact (confirm).
  - Background: **Add person here…** (opens the add form and drops the new node
    at the click point, pinned) · Fit chart.
  - Relationship (edge): Show · Delete (manual relationships only).
- **Link-from-here** click-to-link replaces the clunky drag as the primary way
  to connect two people (drag mode kept as a secondary tool). Esc cancels.
- **Delete contact** works via OrbitCase `withdraw`: every contact created here
  now carries a per-entity `contrib` (`ent:<id>`) on its person, note and links,
  so deletion removes exactly that contact and its relationships.
- **Pin/Unpin** toggles whether a node is fixed; pinned nodes keep their spot.
- Tests: `scripts/test-charting-menu.mjs` (6 assertions — menu opens,
  link-from-here, add-here, delete) and `scripts/test-charting-drag.mjs` (3).

## 2026-08-22 - SOLAR parity batch 2: undo/redo + face photos

- **Undo/redo** (SOLAR's snapshot model): the vault is snapshotted before every
  edit (add/link/unlink/delete/import/record). Ctrl+Z / Ctrl+Y and toolbar
  buttons on the chart; 40-deep stack; restore = clear + merge the snapshot.
- **Face photos on nodes** (SOLAR's `circularImage`): right-click a contact →
  Set/Change/Remove photo. Photos are downscaled to 220px JPEG and kept local in
  the vault. A load-gate renders a plain dot until the image is decoded, so vis
  never draws a 0-size image.
- Tests: `scripts/test-history-photo.mjs` (9 assertions — undo/redo via button
  and Ctrl+Z, photo renders with no drawImage error).

## 2026-08-22 - SOLAR parity batch 3: relationship labels & types

- **Relationship types on the edge**: right-click a relationship → pick Friend /
  Family / Partner / Colleague / Acquaintance / Knows, a custom label, or clear
  it. Stored as `attrs.relationshipType`, shown as the edge label, undoable.
- Test: `scripts/test-relationship-types.mjs` (6 assertions — set via menu + hook,
  read back, undo, menu offers types).

### SOLAR charting parity — running status
Done: right-click context menu, link-from-here, add-person-here, pin/unpin,
delete, draggable nodes, undo/redo, face photos, **relationship labels & types**,
curved edges + node polish.
Deferred (fit this surface, not yet built): type/role glyph icons (photo
fallback), link corners/bends, network analysis (shortest path / key players /
centrality), snap-to-grid, timeline range filter.
Not porting (law-enforcement-specific, off-purpose): conditional formatting by
risk, redaction, i2/ANX interchange.

## 2026-08-22 - SOLAR parity batch 4: linking, icons, layout & delete

Product direction clarified: this is a neutral **dossier-builder for people** (any
people, not personal contacts) — take SOLAR's charting *functionality and polish*,
NOT its intelligence/law-enforcement terminology or content.

- **Linking rebuilt to the SOLAR model**: removed the drag toggle; linking is now
  purely right-click / **touch long-press → "Link from here" → tap target**
  (`wireLongPress`, ported from SOLAR chartmenu.js). This fixed linking on phones,
  where the desktop-only `oncontext` never fired.
- **Node icons** (`icons.js`, ported from SOLAR's icon library): no-photo contacts
  render as circular glyph chips (person / group / organisation / favourite /
  family / home / work) with a right-click **"Choose icon…"** picker.
- **Selection is circular, not square** — chips use `circularImage`.
- **ME is a normal draggable node** (was pinned centre); the orbit rings are now a
  non-constraining backdrop. Node positions (incl. ME) persist on drag.
- **Easy delete**: Delete key removes the selected contact or relationship
  (undoable), plus a Delete button on the profile and the right-click item.
- **Both sidebars drag-to-resize** (`panelresize.js`, ported from SOLAR): the left
  intel panel and the right contact dossier, each with double-click reset and
  width persisted per browser.
- Tests: `test-touch-linking.mjs` (3), `test-icons-delete.mjs` (6). Full suite now
  73 assertions across 7 suites, 0 failures.

## 2026-08-22 - graph overhaul: reliable delete, box-select, dynamic rings, themes

Large interaction/visual batch (built and APK-rebuilt):

- **Delete actually works now.** Added `OrbitCase.removeEntity(id)` — a hard remove
  that doesn't need a per-entity contrib, so contacts imported before that existed
  (which `withdraw` silently no-op'd) can be deleted. Verified it persists to
  storage (the "respawn on reload" bug). Delete via Delete key, profile button, or
  right-click.
- **Box / rubber-band select**: plain left-drag on empty canvas draws a marquee and
  selects people; Delete removes them all (undoable). Right-drag pans; touch keeps
  one-finger pan + long-press menu.
- **Linking de-clunked**: removed the drag toggle; right-click/long-press
  "Link from here" is the one flow, with a live **ghost line** following the cursor,
  plus shift-click-to-link as a fast path. Relationship type labels via the edge menu.
- **Dynamic orbit rings**: rings are drawn INSIDE the vis canvas (via `beforeDrawing`)
  so they zoom/pan with the graph, centred on ME. Named **Orbit layout**; ME is
  centre-pinned in it. A **Free layout** frees ME and hides the rings.
- **Pin people to a ring** (Inner/Working/Outer/Deep) via the node menu; each ring
  has a distinct colour (red→amber→gold→grey) and a pinned person takes their ring's
  colour on their node.
- **Canvas background themes** (Charcoal default — fixes readability — plus Orbit,
  Peacock, Midnight, Forest, Graphite), selectable from a toolbar swatch or the
  background context menu; persisted per browser.
- **Icons**: no-photo nodes are circular glyph chips with a right-click icon picker;
  selection is circular (no square). **Both sidebars drag-to-resize**; the right
  dossier docks full-height flush to the edge.
- Pickers open deferred so the opening click doesn't instantly dismiss them.
- **Dossier photo/avatar header** (photo or glyph), a **ring badge** showing which
  circle a person is pinned to, a **recentre** toolbar button, and the legend now
  keys the ring-tier colours.
- Test suites: 73 assertions across 7 files (import, boot, charting-menu,
  icons-delete, relationship-types, history-photo, touch-linking), all passing.

## Batch — file-drop importer for social exports

Facebook, Instagram and WhatsApp have no usable contacts API for a personal tool
(Meta closed friend/follower access post-2018; WhatsApp only reads the phone's
address book). So the honest route is their **data-export files**, read locally.

- **JSON parsing** added to `importers.js` (`json()`): Meta "Download Your
  Information" exports — Facebook `friends_v2`/`friends`, Instagram
  `relationships_following`/`followers` and bare follower arrays — plus generic
  contact arrays/objects. Routed from `review()` by `.json` extension or a
  `[`/`{` content sniff; Orbit's own vault import stays on its separate path.
- **LinkedIn CSV** now parses correctly: `csv()` locates the real header row past
  the export preamble ("Notes:" block), combines **First Name + Last Name**, and
  maps **Email Address** — the one export that carries emails.
- **Connected accounts** reworked: Facebook/Instagram dead-end "Set up" buttons
  become **export → import** cards with in-app instructions; new **LinkedIn** and
  **WhatsApp/phone (vCard)** cards. Google (live) and Apple (native, later) kept.
- **Drag-and-drop anywhere**: `wireFileDrop()` + `#drop-overlay`; only recognised
  contact formats (.csv/.vcf/.json/.ics/.txt) are read, others ignored. `#contact-file`
  accept widened to include JSON. Every path still passes through the review screen.
- All imports reuse the existing filter→classify→dedupe pipeline. Import-pipeline
  suite extended to **51 assertions** (added LinkedIn-CSV, Facebook/Instagram JSON,
  generic-JSON automated-address filtering); boot smoke still 7/7.

## Batch — layout switcher (SOLAR parity)

"Peacock" was a SOLAR *layout*, not a background theme. SOLAR offers its
arrangements through one segmented `applyLayout(kind)` control; Orbit only had
its custom ring layout ("orbit") + "free". Added the rest.

- **`layouts.js`** (new, testable module like classify/matching): ports SOLAR's
  positioning maths — **peacock** + **compact** (radial hub-and-spoke fans),
  **force** (barnesHut physics), **hierarchy/Tree** (BFS spanning forest, parents
  centred over children), **grouped** (per-kind sub-circles on a ring),
  **circle**, **grid**. Each returns `{positions, physics}`; orbit/free stay
  app-owned (compute returns null).
- **`renderGraph` integration**: when a computed layout is active it builds a
  node/link list (ME + visible people, grouped by entityKind), computes positions
  once, and pins every node (physics off). **Force** enables barnesHut only until
  `stabilizationIterationsDone`, then freezes and captures positions so selecting/
  editing never re-shuffles. Orbit rings only draw in the orbit layout.
- **UI**: a labelled **Layout** button in the graph-tools bar opens a picker
  (name + one-line tip per option), and both background/ME context menus now open
  it via "Layout: <current> ▸". Choice persists (`orbit_layout`).
- **Bug caught by screenshot verification**: `.drop-overlay{display:flex}`
  overrode the `[hidden]` attribute (class beats the UA rule), so the import
  overlay covered the whole app permanently. Fixed with `.drop-overlay[hidden]{display:none}`.
- Tests: new `test-layouts.mjs` (**39** maths assertions) + `test-layouts-render.mjs`
  (**22** real-canvas puppeteer assertions: every layout activates, moves nodes off
  the rings, finite coords, force settles, orbit re-centres ME, no errors).
  `npm test` now runs import(51) + layouts(39) + boot(7).

## Batch — graph interactions + social sign-in

Four interaction/auth changes:

- **Drag-to-re-pin** (`applyNodeDrop`): ring-pinned and position-pinned people are
  now draggable (`fixed:false`; physics stays off so they hold). In the orbit
  layout a drop snaps to the nearest ring band and pins there (taking the ring
  colour), keeping the angle it was dragged to (`state.ringAngle`); dropping past
  the outer ring (r>640) unpins. Unpin deletes the `ring` attr directly (the store
  ignores blank attrs, so `ring:""` wouldn't clear it — mirrors `clearRing`).
- **Arrow-key cycling** (`cycleConnection`/`neighboursOf`): with a person selected,
  ←/→ walk that person's connections (label-sorted, wrapping). The anchor is set on
  node click, so you scan one person's links without the anchor drifting; guarded
  against firing while typing in a field.
- **Relationship-type picker on draw** (`showRelTypePicker`): completing a link
  (`addRelationship` now returns the link id) immediately opens a type picker
  (Friend/Family/Partner/Colleague/Acquaintance/Knows/Custom) at the cursor;
  dismissing leaves the link unlabelled.
- **FB + LinkedIn sign-in** (login/identity, NOT contact import — Meta/LinkedIn
  expose no friend/connection API): `auth-cloud.js` maps button names to Supabase
  provider keys (`linkedin` → `linkedin_oidc`); the login screen now offers Google,
  LinkedIn, Facebook, Apple (2×2 grid). Contacts for these still come from the
  file-drop importer. Requires the user to configure a Meta app + LinkedIn app in
  the Supabase dashboard (same as the Google setup), with Orbit's redirect URLs.
- **Bug fixed**: unpin via drag initially set `ring:""` which the store dropped as
  a blank attr, so the person stayed pinned — now deletes the attr.
- Tests: new `test-interactions.mjs` (**16** real-canvas assertions: ring snap for
  all four bands + unpin + persistence; ←/→ cycling incl. wrap/leaf; picker opens
  on draw and labels the link). QA hooks added: `__ORBIT_DRAGTO__`, `__ORBIT_RING__`,
  `__ORBIT_CYCLE__`, and `__ORBIT_SELECT__` now anchors the cycle.

## Batch — profile-first layout, recycle bin, popup sign-in, GitHub + isildur deploy

- **GitHub**: repo `isildur-uk/Orbit` (gh account punch-monkey). **isildur deploy**:
  self-contained bundle → `Isildur/site/projects/orbit/index.html` (git root
  `Isildur/site` → `isildur-uk/isildur` → isildur.co.uk/projects/orbit/), with a
  no-cache `/projects/orbit/*` rule in `site/_headers`. Cloud auth stays on;
  needs `https://isildur.co.uk/projects/orbit/**` in Supabase Redirect URLs.
- **Standalone build fixes**: closed a malformed CSP `<meta>` (stray quote had
  swallowed the offline-flag script); skip SW registration + drop the PWA manifest
  link in offline builds (`ORBIT_OFFLINE_BUILD`). Bundle verified zero console errors.
- **Profile-first left panel** (Option A): the selected person's profile now fills
  the LEFT sidebar (CSS-grid relocation of `#person-dossier` into column 1, row 2;
  no DOM move — keeps mobile's bottom-sheet rules intact). No-selection shows a
  placeholder (`#person-dossier:not([data-selected])`). Stats removed from the
  sidebar; People/Relationships count moved to the toolbar (`#toolbar-count`);
  sources live in the Connect modal. `panelresize` now resizes only the left
  column (initDossier retired; default width 360).
- **Recycle bin**: delete is frictionless (all `window.confirm` removed) and
  reversible — soft-delete captures the entity + notes + links + pinned state to
  `orbit_trash_v1`, with a bin button (badge count) in the graph tools opening a
  restore/purge modal. Undo (Ctrl+Z) still works for immediate reversal.
- **Popup sign-in**: `signInWithProvider(p, {popup:true})` uses Supabase
  `skipBrowserRedirect` + `window.open`; the session syncs back to the opener via
  Supabase's cross-tab broadcast and the popup self-closes on SIGNED_IN (guarded
  by `window.name === "orbit-oauth"`). Falls back to full-page redirect if blocked.
  **Needs live verification on the deploy** (headless can't drive real OAuth).
- Tests: new `test-recycle.mjs` (11). Suites this session all green: import 51,
  layouts 39, boot 7, layouts-render 22, interactions 16, recycle 11.

## Next

1. Replace the local vault adapter with an encrypted sync repository while preserving offline-first edits.
2. Extend interaction/fact capture with approved social-source adapters.
3. Add opportunity candidate detectors, beginning with introductions and dormant relationships.
4. Initialize the Tauri Android/iOS targets, then add native builds and signed store submissions.
5. Optional SOLAR extras not yet ported: Packed and Theme (time-lane) layouts; orthogonal edge bends for Tree/Grid.

1. Replace the local vault adapter with an encrypted sync repository while preserving offline-first edits.
2. Extend interaction/fact capture with approved social-source adapters.
3. Add opportunity candidate detectors, beginning with introductions and dormant relationships.
4. Initialize the Tauri Android/iOS targets, then add native builds and signed store submissions.
