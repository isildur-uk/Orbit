# ORBIT Personal Network

This is a sibling surface for personal relationship intelligence. It is not a
replacement for Charting or Database.

The first slice deliberately keeps the surface small:

- domain.js contains pure network vocabulary and calculated summaries.
- profile.js contains the neutral Contact Profile read model: reachability,
  social profiles, addresses, personal details, current context, historical
  facts, interactions, relationship phase and evidence.
- app.js renders the orbit workspace and owns user interaction.
- auth.js provides the first local-only Orbit account layer: create account,
  sign in, sign out and a device session. It is deliberately separate from
  future Google/Apple/social connections and cloud sync.
- auth-cloud.js is the active account layer when the Supabase public client is
  available. It handles Supabase email/password sessions plus Google, Apple and
  Facebook OAuth entry points. The local layer remains as an offline fallback,
  but it is not the production identity system.
- supabase-config.js contains only the public project URL and publishable key.
  Database passwords and service-role keys must never be committed or shipped
  in the browser/mobile payload.
- connections.js provides the provider registry and per-account connection
  state. It records setup/connection metadata only; it never stores provider
  passwords or pretends that an OAuth link exists. Google Contacts is the first
  real connector target, with Facebook and Instagram following their Meta app
  permission requirements.
- network.css carries the ORBIT analyst-console visual language.
- index.html is a standalone browser surface and the input to the personal
  network payload builder.
- vault.js is the repository seam: the current local OrbitCase adapter can be
  replaced by a synced vault without changing the profile or graph surface.
- manifest.json and sw.js provide an installable, offline-first mobile web
  surface while the signed Android/iOS builds are prepared.

The surface reads and writes the shared OrbitCase spine. People are stored as
type: "person" entities. Interactions and facts are separate linked entities;
the Contact Profile is assembled from them and is not a duplicate stored
record. Manual additions carry source: "manual" and attrs.provenance:
"user-entered". Imported facts and recommendations must add their own source
evidence before they are surfaced.

The Contact Profile is the address-book object: it can be edited after creation
and stores multiple contact channels, social profile links, home/work addresses,
birthday, interests and useful details alongside the relationship timeline.
The Summary surface also produces an explainable "Next Best Moment" prompt from
opportunities, promises and relationship cadence.

The first launch now uses Supabase Auth when configured. The browser/mobile
client keeps only the Supabase session; the app does not receive provider
passwords. The local vault is still device-local until the authenticated sync
schema is added. The Connections screen is intentionally separate: its buttons
move providers to "setup needed" until the corresponding OAuth/API
configuration exists.

Build the self-contained payload with:

    node standalone/build-personal-network.mjs 20260821-personal

The independent native shell embeds this payload when built from
`desktop/src-tauri/`.

For the mobile release path, see `docs/personal-network-mobile-release.md`.
