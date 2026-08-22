# Personal Network

This is the separate ORBIT Personal Network side project: a private, evidence-aware
address book and relationship network for desktop and mobile.

The project owns its source, documentation, design plan, standalone payload,
native shell and the small shared-runtime subset it needs under this folder.
The runtime files in `src/_shared` and the native shell are local copies, so
this project can be moved or developed without depending on another project
folder being present.

Build the browser payload from this folder:

```powershell
node standalone\build-personal-network.mjs 20260821-personal
```

The independent native shell is under `desktop/src-tauri/`; the mobile release
notes are in
`docs/personal-network-mobile-release.md`.

Supported contact transfer formats are CSV and vCard (`.vcf`); calendar events
can be reviewed from iCalendar (`.ics`) files. Orbit shows a review list before
merging imported contacts or events into the local vault.
