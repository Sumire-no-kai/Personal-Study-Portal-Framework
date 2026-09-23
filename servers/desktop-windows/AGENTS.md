# Desktop App Working Agreement

## Product invariants

- Keep one shared macOS and Windows implementation. Add platform modules only
  for behavior that cannot be shared.
- The native surface is a small tray/status controller. Document reading stays
  in the user's browser.
- Treat **Note Portal** as the English product name. Do not invent or add a
  Chinese product name until the product owner selects one.
- Treat selected Markdown and assets as read-only authoritative content.
- Never move, rename, delete, or rewrite source-library files.
- Keep built-in AI and provider-specific behavior outside the first-release
  core.
- Bind the local service to loopback unless a separately reviewed requirement
  explicitly enables another interface.
- Do not select a library, start the service, open the Portal, or enable login
  launch before the current academic-integrity notice has been accepted.
- Keep the notice available from Settings and require renewed acceptance when
  its version changes materially.
- Stage and validate derived state before atomically publishing it.

## Engineering conventions

- Prefer one product-owned Tauri/Rust executable for the launcher, watcher,
  and HTTP service until evidence justifies an application-managed sidecar.
- Use Vanilla TypeScript and minimal CSS for the status panel. Do not add a
  frontend component framework without measured need.
- Keep OS-specific code behind narrow interfaces in `platform/`.
- Use stable document IDs and library-relative paths at every browser boundary.
- Do not expose absolute paths or document bodies in normal logs.
- The reader lives once, at the repository root, and is shared by all server
  forms. Layout, design and reader-behavior changes are made there so that one
  edit reaches every form. This replaces the earlier rule that treated the
  desktop copy as an independent baseline; the two copies were byte-identical
  duplicates, never a fork.
- Change the root reader only for behavior that is correct on every form. Put
  desktop-only behavior in this directory instead, and never fork the reader to
  get it.
- Keep the root reader self-contained and content-free: it ships with
  `vendor/` because `index.html` references it relatively, and it must never
  carry notes, generated manifests, course configuration, indexes, credentials,
  model files, or font binaries.
- Store notice acceptance locally as a version and timestamp; do not treat it
  as telemetry or send it over the network.
- Implement both library profiles in `docs/LIBRARY_STRUCTURE.md`. General
  libraries recursively preserve ordinary Markdown folders. Study libraries
  use `content/<semester>/<unit>/<week-key>/<week-key>-notes.md`; the week
  directory and primary-note basename must match.
- Do not silently reinterpret invalid or shallow paths as another hierarchy.
  Do not treat other Markdown beside a weekly primary note as navigation or
  searchable course content. Report it in diagnostics and leave it unchanged.
- Keep `docs/GETTING_STARTED.zh-CN.md` understandable without terminal,
  Markdown-metadata, or programming knowledge whenever the library contract or
  onboarding changes.
- Diagnostics may suggest and reveal a destination, but must never silently
  move, rename, overwrite, or delete a user's source files.
- Keep scanning, rendering, indexing, refresh, and diagnostics read-only. The
  explicit note/template commands may only create validated missing directories
  and new files; they must fail if any destination file already exists.
- Enforce the release budgets in PRD section 13.2. Do not ship the full CJK OTF
  files in the default application package. The reader no longer embeds them
  via `@font-face`; its reading stack resolves installed system fonts by name.
- Add regression coverage for file-event normalization, snapshot rollback,
  path containment, library-layout validation, case collisions, and browser
  event contracts.

## Validation expectations

- Run focused Rust and frontend tests before broad packaging checks.
- Validate filesystem behavior on both macOS and Windows before claiming
  parity.
- Verify installers on clean machines or clean virtual machines before a
  stable release.
- Treat signing and notarization as release requirements, not evidence that
  runtime behavior is correct.
- Review the final diff for source-file mutation, platform drift, excessive
  permissions, accidental network access, and unrelated changes.
