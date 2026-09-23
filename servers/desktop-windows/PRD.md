# Note Portal — Product Requirements Document

**Status:** Windows alpha in development; stable-release criteria remain open

**Version:** 0.4

**Date:** 2026-09-23

**Target platforms:** macOS and Windows

## 1. Product summary

Note Portal turns a local Markdown folder into a continuously updated personal
reading website. The installed application has a compact control window backed
by a system-tray item. It runs a lightweight local service and opens the reader
in the user's default browser. The control window shows library status and
structure, not document content.

The product does not compete with Markdown editors or AI authoring tools.
Users create and update files with any editor or external automation. Note
Portal owns discovery, organisation, indexing, safe refresh, and presentation.

The product is useful for any organised Markdown collection: personal notes,
project documentation, reading notes, work records, and knowledge archives.
Study notes remain a first-class use case with a dedicated Semester → Unit →
Week profile rather than defining the whole product.

The first-release English product name is **Note Portal**. No Chinese product
name is assigned. The working bundle identifier is
`io.github.sumirenokai.noteportal`.

## 2. Locked product decisions

1. macOS and Windows use one shared codebase and one shared product model.
2. The desktop application does not contain a full document-reading window.
3. The normal browser is the only first-release reading surface.
4. Source Markdown remains authoritative. Scanning, rendering, indexing, and
   refresh are read-only. Explicit template actions may create missing
   directories and new files but must never overwrite an existing path.
5. External tools may update Markdown; the Portal reacts to file changes.
6. Built-in AI, local models, RAG, and provider-specific APIs are excluded from
   the first release.
7. The local service binds to `127.0.0.1` by default.
8. The first release supports one active library. Multi-library switching is a
   later enhancement.
9. The implementation target is Tauri 2 with a shared Rust backend. A sidecar
   process requires evidence that the in-process service is insufficient.
10. Windows is the first distribution and user-validation target. macOS shares
    the core implementation but is not considered released until its own
    packaging and clean-machine checks pass.
11. The current academic-integrity and responsible-use notice must be accepted
    before first use. Until then, the app cannot select a library, start the
    service, open the Portal, or enable launch at login.
12. Every library uses one explicit profile: **General** or **Study**. Profiles
    change discovery and navigation labels, not the service, renderer, search,
    refresh protocol, or security boundary.
13. The status-panel frontend uses Vanilla TypeScript. A component framework,
    embedded browser engine, database server, or always-running sidecar is not
    part of the first release.

## 3. Target user

The primary user keeps Markdown documents on a personal computer and may update
them through a text editor, scripts, or external automation. They want a calm,
structured reading experience without manually generating manifests, running
terminal commands, configuring a web server, or uploading private content.

Common uses include:

- course notes organised by Semester, Unit, and Week;
- personal or research notes organised in ordinary folders;
- project documentation, work records, and reading archives;
- Markdown generated or updated by external automation.

The user may know only the everyday actions of opening a folder, creating a
file, and dragging a file. They must not need to understand a terminal,
frontmatter, file watching, server ports, or the Portal's internal schema.
Instructions and errors must assume no computing or engineering background.

## 4. User problem

The current framework can render a generated Markdown library, but onboarding
and updates depend on repository-specific scripts and directory conventions.
It does not yet offer a general desktop lifecycle:

- choosing an arbitrary Markdown library;
- keeping it synchronized without manual commands;
- reporting service and indexing health;
- opening the reader consistently;
- surviving partial or invalid file writes;
- distributing the experience as a normal macOS or Windows application.

## 5. Goals

- A first-time user can select a Markdown folder and open a working Portal
  without using a terminal.
- The app remains visually small and operationally quiet.
- General libraries preserve the user's ordinary folder hierarchy and recognise
  Markdown without requiring academic naming.
- Study libraries provide deterministic Semester, Unit, and Week navigation and
  prevent unrelated Markdown from becoming a weekly primary note.
- File additions, changes, renames, and deletions update the Portal
  incrementally.
- Browser updates do not require a full-page reload for every file event.
- The repository-root reader remains the single reading implementation for every server
  form. The desktop product adapts its library manifest and local interfaces
  without copying or forking the reader.
- Source files are never silently changed or reorganized.
- A non-technical user can create either a general library or the canonical
  Semester/Unit/Week structure through labelled fields without typing a path.
- Every user sees and explicitly accepts the academic-integrity and
  responsible-use notice before content processing begins.
- The same core behavior is tested on macOS and Windows.
- The packaged app can later serve as the local foundation for self-hosted or
  Git-synchronized editions without changing the library contract.

## 6. Non-goals for the first release

- Editing Markdown inside Note Portal.
- Built-in chat, AI generation, local inference, RAG, or API-provider setup.
- Public cloud accounts, cloud storage, or multi-user collaboration.
- Automatic movement, renaming, rewriting, or deletion of user files.
- Public internet hosting.
- LAN sharing enabled by default.
- Mobile applications.
- Multiple simultaneously active libraries.
- Automatic application updates. The first stable release may use manual
  downloads while signing and update infrastructure are established.

Existing phone-specific capabilities are not desktop requirements. The
desktop manifest switches the shared reader to Note Portal labels and disables
phone-only onboarding and assistant/feedback surfaces; the phone server keeps
its existing manifest contract.

## 7. Core user journeys

### 7.1 First launch

1. The app starts with a tray item and opens its compact setup window.
2. A blocking first-run notice explains local processing, authorised use,
   copyright/privacy responsibility, academic integrity for study materials,
   and why public deployment is discouraged.
3. The user opens the full notice, checks **I have read and agree**, and selects
   **Agree and continue**.
4. A short first-run guide explains what Note Portal does, including reading
   Markdown written by a person or generated by an external AI tool; the app
   does not itself summarise documents or provide AI. It shows General and Study
   folder examples, what each profile recognises, how automatic refresh works,
   and the purpose of the main control-window buttons. The guide can be reopened
   from Help; optional support information is not a condition of use.
5. The compact setup window offers **Create a new library** and **Use an
   existing folder**.
6. The user chooses **General notes** or **Study notes** from two plain-language
   cards with small example trees. General notes is suggested for ordinary
   Markdown folders; Study notes explains the Semester → Unit → Week structure.
7. A new General library asks only for its name and location, then offers
   **Create first note** and **Open library folder**.
8. A new Study library creates `content/` and `inbox/`, then offers **Create my
   first Week**. The Week form asks for Semester, Unit, and Week, previews the
   exact path, and creates a minimal matching `week-NN-notes.md` only after
   confirmation.
9. Choosing an existing folder opens a native picker, asks which profile to use,
   then previews recognised Markdown as a folder tree and lists excluded files
   with plain-language reasons before continuing.
10. The app validates access and scans supported files without moving,
   renaming, deleting, or rewriting source files.
11. The app builds a versioned library snapshot.
12. The local service starts on an available loopback port.
13. The default browser opens the Portal URL.
14. The compact control window reports the library name, profile, document
    count, recognised folder tree, excluded-file warnings, service state, and
    last successful refresh. It remains available from the tray.

If no Markdown files are found, the app keeps the library selected and shows a
clear empty state rather than treating this as a service failure. The empty
state provides **Create note** or **Create Week**, **Open library folder**,
**View setup guide**, and **Choose another folder** actions. It does not show an
internal error code.

The canonical beginner guide is `docs/GETTING_STARTED.zh-CN.md`. Advanced
features such as `_index.md`, frontmatter, explicit IDs, and safe-write patterns
must be visually separated from the basic path so a first-time user can succeed
without learning them.

### 7.2 Notice acceptance and versioning

- The notice is shown before any file picker, watcher, indexer, HTTP listener,
  browser launch, or login-start registration is activated.
- **Agree and continue** remains disabled until the acknowledgement checkbox is
  selected.
- Closing or declining the notice exits setup without starting the service.
- Acceptance is stored locally as `noticeVersion` and `acceptedAt`. It is not
  sent to a server or used as analytics.
- A materially changed notice receives a new version and must be accepted
  again before the service starts.
- Rewording, spelling, or layout-only changes do not require renewed consent.
- Settings always provides **Usage terms, academic integrity & privacy**, which
  opens the complete current text and displays its version and acceptance date.
- The canonical first-release copy is maintained in
  `docs/ACADEMIC_INTEGRITY_NOTICE.md`.

### 7.3 Manual launch

When the user starts the app directly, the service starts and the browser opens
unless the Portal is already open. Closing the compact status window does not
stop the service.

### 7.4 Login launch

When launch-at-login is enabled, the service starts quietly in the tray. It
does not open a browser automatically. The user opens the Portal from the tray
menu when needed.

### 7.5 External content update

1. An editor or external tool writes a Markdown file or referenced asset.
2. The watcher groups related filesystem events.
3. The service waits until the relevant files form a stable readable state.
4. Only affected documents and indexes are rebuilt in a staging snapshot.
5. Validation succeeds and the snapshot is switched atomically.
6. The service emits a browser event describing the change.
7. Navigation, search, or the current document updates without reloading the
   entire application shell.

### 7.6 Invalid or interrupted write

If a file cannot be read or the next snapshot fails validation, the previous
valid snapshot remains active. The tray/status window reports the affected
relative path and a safe explanation. The service retries only after another
filesystem event or an explicit **Refresh now** action; it does not enter an
unbounded retry loop.

### 7.7 Stop and quit

- **Stop service** stops the HTTP listener and watcher but leaves the tray app
  available with a **Start service** action.
- **Quit** stops all processes and removes the tray icon.
- Closing a browser tab does not stop the service.
- Closing the compact status window does not stop the service.

## 8. Desktop UI requirements

The app has no conventional large reading window. Its primary native surface
is a compact control window, which appears during first-run setup and can be
opened from the tray later. Closing this window does not stop the service.

The panel contains, at minimum:

- overall state: stopped, starting, indexing, running, degraded, or failed;
- active library display name and path abbreviation;
- active library profile: General or Study;
- Markdown document count;
- a collapsible, scrollable tree of recognised folders and Markdown documents,
  with no document-body preview;
- excluded-file count and a way to see each reason and suggested location;
- last successful refresh time;
- **Open Portal**;
- **Refresh now**;
- **Open library folder**;
- **Choose library…**;
- contextual **Create note…** or **Create Week template…**;
- **Start service** or **Stop service**;
- launch-at-login setting;
- **Settings**;
- **Usage terms, academic integrity & privacy** settings entry;
- **Help / First-run guide**, available after setup;
- **About / Support**, containing an optional Buy Me a Coffee link clearly
  labelled as voluntary and unrelated to access or features;
- diagnostics entry;
- **Quit**.

Folder-selection and diagnostics surfaces must also:

- explain both profiles with a small example tree instead of path-pattern
  terminology;
- use Folder and Document labels for General libraries, and Semester, Unit,
  Week, and Primary note labels for Study libraries;
- detect likely Study-profile mistakes such as selecting `content/`, a Unit,
  a Week folder, or a folder one level above the library and suggest the exact
  folder to choose;
- use messages of the form “what happened / where / how to fix it”;
- provide **Open containing folder** and **Copy suggested location** actions;
- keep raw stack traces and implementation terms out of the normal interface;
- never offer a one-click destructive repair. Moving, renaming, overwriting, or
  deleting user files always remains a deliberate action outside the Portal.

The Study Week-template form uses labelled controls rather than asking for a
path:

- Semester, with the current or most recently used value suggested;
- Unit code or short name;
- Week number, with a separate optional end Week for a combined range;
- read-only filename and destination preview;
- **Create and show in folder** confirmation.

The form validates each name before creation, does not run if any target path
already exists, and records no template content beyond the minimal heading and
optional stable ID. The normal watcher never receives general write access.

The General note form asks for a title and optional destination folder. It
previews the resulting `.md` path, creates a minimal new document, and refuses
to overwrite an existing file.

The compact panel must use native system scaling, remain keyboard accessible,
and avoid dashboards, document previews, analytics, chat, or large settings
surfaces. A large library must not make the window grow indefinitely: the tree
scrolls within the panel and may collapse folder branches. The guide and About
content must not delay or gate access for a donation.

The first-run notice is the only mandatory modal flow. It must use clear,
readable language and a visible decline/quit path. Agreement cannot be inferred
from merely opening, scrolling, or closing the notice.

## 9. Library model

### 9.1 Library profiles

The selected folder is the library root. The user explicitly chooses one
profile when adding it. The profile is stored in local application settings and
can be changed only through a previewed full rescan; Note Portal does not add a
configuration file to an existing library.

Both profiles recognise UTF-8 `.md` documents, supported referenced images,
and optional presentation frontmatter. They use the same parser, renderer,
search, file watcher, snapshot model, and HTTP interfaces.

#### General profile

The selected folder itself is the content root. Note Portal recursively maps
ordinary folders and `.md` files into navigation, including Markdown directly
inside the selected folder:

```text
My Notes/
├── projects/
│   ├── roadmap.md
│   └── meeting-notes.md
├── reading/
│   └── book-notes.md
└── ideas.md
```

Every eligible `.md` file is a document. Folder hierarchy determines
navigation. `draft: true` excludes a document from normal navigation and search.
The General profile does not require a naming suffix or academic vocabulary.

#### Study profile

The selected folder contains `content/` for organised study material and an
optional `inbox/`. Organised notes use:

```text
content/<semester>/<unit>/<week-key>/<week-key>-notes.md
```

A normal week key is `week-NN`; a combined range is `weeks-NN-NN`. The parent
directory and primary-note basename must match. For example:

```text
content/2026-semester-2/COMP5318/week-01/week-01-notes.md
```

Only that matching primary note becomes the Week entry. Other Markdown in the
Week folder is excluded and reported with the expected filename, preventing a
draft, export, README, or automation context file from becoming a second Week
note. Markdown at a shallower or deeper Study path is also reported.

`inbox/` accepts ordinary Markdown directly or in subfolders and presents it
under a single Inbox group without interpreting its hierarchy as Semester,
Unit, or Week.

The exact contracts and examples are defined in
`docs/LIBRARY_STRUCTURE.md`. Both repository fixtures under `examples/` must
remain valid against the production parser.

### 9.2 Reserved names and assets

- `_index.md` optionally describes a General folder or a Study Semester/Unit.
  It is folder metadata and never appears as a normal document. Study Week
  metadata belongs in the matching primary note.
- `_assets/` may appear beside a document or below the selected library. Its
  contents are never shown as navigation entries.
- Files and directories beginning with `.` are ignored.
- Markdown files beginning with `_`, other than `_index.md`, are reserved and
  ignored in the first release.
- Common dependency/cache directories such as `node_modules`, `.git`, and
  `.obsidian` are ignored and do not generate warnings.
- Temporary, backup, and partial-write suffixes such as `.tmp`, `.part`, `.swp`,
  and `.bak` are ignored.
- Symlinks that resolve outside the selected library are rejected.

Documents refer to assets using relative Markdown paths. The server validates
the resolved path before serving an asset.

### 9.3 Organization and display precedence

Hierarchy always comes from the path. The General profile preserves ordinary
folders; the Study profile derives Semester, Unit, and Week from its canonical
path. Frontmatter cannot move a document or make an invalid Study filename a
primary Week note.

Document titles use valid frontmatter `title`, then the first Markdown level-one
heading, then the cleaned filename. General folders use `_index.md` title or the
folder name. Study Weeks use their numeric key for ordering; other siblings use
valid `order` metadata and then case-insensitive natural name order.

The first release does not use AI classification. Ambiguous files remain
in `inbox/` or are reported as invalid rather than being silently assigned to
an inferred category.

### 9.4 Frontmatter

Frontmatter is optional. The first release recognises only:

- `id`: stable document ID;
- `title`: display title;
- `order`: integer sibling order for General folders or Study Semester/Unit
  `_index.md`; ignored in weekly primary notes because Week order comes from
  the path;
- `tags`: string list used for filtering and search;
- `draft`: boolean; a draft is excluded from normal navigation and search.

Unknown fields are preserved in source and ignored. Frontmatter cannot grant
filesystem access, alter the library root, insert raw executable HTML, or
change a document's hierarchy.

### 9.5 Stable identity

Each document receives a stable internal ID. Renames should preserve identity
when the service can establish continuity from content hash and the same
filesystem change batch. A valid explicit frontmatter `id` takes precedence and
must be unique across the library. Duplicate IDs invalidate the next snapshot.
Ambiguous cases without an explicit ID create a new ID rather than risking
incorrect history association.

Source paths exposed to the browser are library-relative. Absolute local paths
must not appear in page HTML, URLs, browser events, or normal logs.

### 9.6 Cross-platform path rules

- Text is UTF-8.
- Paths must be unique under case-insensitive comparison so one library behaves
  the same on default macOS and Windows filesystems.
- Names cannot contain Windows-invalid characters `< > : " / \\ | ? *`, end in
  a period or space, or use reserved device names such as `CON`, `PRN`, `AUX`,
  `NUL`, `COM1`–`COM9`, or `LPT1`–`LPT9`.
- Unicode and Chinese names are supported, but lower-case ASCII slugs are
  recommended for stable IDs and automation.
- Paths that violate the contract are reported and excluded; the app never
  renames them automatically.

### 9.7 Derived state

Manifest, search index, content hashes, refresh state, and user overrides are
stored in the operating system's application-data directory. They are derived
or recoverable state and must not be written into the selected library during
the first release.

## 10. Dynamic refresh requirements

### 10.1 Change detection

- Watch Markdown and supported local assets recursively.
- Coalesce save patterns that appear as create, rename, remove, and replace
  events.
- Hash content before rebuilding; timestamp-only changes do not trigger a
  browser refresh.
- Never parse a file directly into the active snapshot.
- A watcher overflow or lost-watch condition triggers one bounded full scan.

### 10.2 Snapshot publication

Every successful refresh produces a monotonically ordered snapshot containing:

- snapshot ID;
- library profile;
- generated time;
- document metadata;
- content hashes;
- navigation structure;
- search-index version;
- validation result.

The service stages and validates the next snapshot before switching the active
snapshot pointer. A failed build cannot replace the current snapshot.

### 10.3 Browser notification

The browser subscribes to a Server-Sent Events endpoint. Events cover:

- service ready;
- snapshot changed;
- document changed;
- navigation changed;
- index changed;
- refresh failed;
- service stopping.

The event contains stable IDs and hashes, not absolute paths or full Markdown
content. The browser fetches changed data through normal HTTP endpoints.

### 10.4 Browser behavior

- A changed non-current document updates navigation and search silently.
- A changed current document is fetched without reloading the full shell.
- The reader restores the nearest surviving heading anchor; if none survives,
  it falls back to a proportional reading position.
- A substantial structural change may show a non-blocking **Content updated**
  notice before replacing the visible article.
- Deleted current content shows a clear unavailable state and a route back to
  the library overview.
- Asset URLs include content hashes so updated images are not hidden by stale
  browser caches.

## 11. Local service

The service owns:

- library scanning and validation;
- metadata and manifest generation;
- incremental search indexing;
- filesystem watching;
- serving packaged Portal assets;
- serving library content by stable ID;
- Server-Sent Events;
- health and diagnostics endpoints;
- lifecycle coordination with the tray app.

The service chooses an available loopback port and persists the active endpoint
for the current app session. Opening the Portal always uses the endpoint
reported by the running listener; no component assumes that a preferred port
was successfully acquired.

The implementation should run inside the Tauri process for the first release.
A separate executable is justified only if crash isolation, self-hosted reuse,
or measured constraints require it.

## 12. Proposed interfaces

The exact schemas are finalized during implementation, but the first release
requires these stable responsibilities:

```text
GET  /api/health
GET  /api/library                 # includes profile and navigation
GET  /api/documents/{document-id}
GET  /api/search?q={query}
GET  /api/portal-events           # shared reader's SSE release contract
GET  /library/{relative-asset}    # validated, library-relative images
```

Refresh, service lifecycle, folder selection, and explicit template creation
are Tauri commands available only to the control window. The browser has no
HTTP control endpoint, so arbitrary web origins cannot trigger a rescan. The
browser receives only stable IDs, relative paths, and read-only content.

## 13. Cross-platform structure

### 13.1 Shared implementation

These capabilities must not fork by operating system:

- library schema;
- Markdown and frontmatter parsing;
- path validation rules;
- hashing and snapshot logic;
- file-event normalization contract;
- search indexing;
- local HTTP interfaces;
- SSE event schema;
- tray status model;
- browser behavior;
- tests and fixtures.

### 13.2 Lightweight runtime and packaging

- Use one product-owned Tauri/Rust executable for the tray, watcher, loopback
  service, and indexing. Do not add an application-managed sidecar or embedded
  database server in the first release. Platform WebView implementations may
  create operating-system-managed helper processes.
- Build the compact panel with Vanilla TypeScript and minimal CSS. Do not add a
  component framework unless measured complexity justifies its cost.
- Create the status WebView on demand and release it after the panel closes when
  the platform permits; the Rust tray/service continues without a hidden large
  window.
- Use filesystem events and incremental work. Do not poll the library on a
  timer while it is idle.
- Cache metadata, hashes, and the search index as derived state. Do not duplicate
  complete source documents in the application-data directory.
- Use the system font stack by default. The two full CJK OTF files in the
  extracted baseline total about 48 MiB and must not ship in the default
  package; a later licensed subset or optional font pack requires separate
  measurement.
- Keep the release application payload at or below 30 MiB before installer
  container overhead. Report signed installer size separately.
- On the reference macOS and Windows machines, after indexing and with the
  status panel closed, target at most 100 MiB aggregate resident/working-set
  memory across processes attributable to the desktop app, and less than 1%
  average CPU over a five-minute idle sample.
- With a warm derived cache, target tray-ready state within two seconds on the
  reference machines. After a stable single-file save, target browser update
  within one second for a 2,000-document, 250 MiB test library.
- Performance measurements use release builds. Record desktop-app aggregate
  usage and the separately launched default browser independently because the
  reading surface runs in the user's browser.

These are first-release budgets, not marketing claims. A missed budget blocks
release until the cause is measured and the PRD is deliberately revised.

### 13.3 macOS-specific implementation

- menu-bar conventions;
- application bundle and icon resources;
- launch-at-login integration;
- sandbox/file-access persistence if distribution mode requires it;
- code signing, hardened runtime, and notarization;
- Apple silicon and supported Intel build targets if release policy includes
  both.

### 13.4 Windows-specific implementation

- notification-area conventions;
- launch-at-login integration;
- installer configuration;
- code signing and reputation considerations;
- WebView runtime prerequisite handling;
- long-path, drive-letter, and case-insensitive path tests.

Platform modules implement narrow interfaces owned by the shared core. They do
not contain separate copies of library, server, or refresh logic.

## 14. Security and privacy

- Bind only to loopback in the first release.
- Reject requests with unexpected `Host` and `Origin` values.
- Protect control endpoints with a per-launch unguessable token unavailable to
  unrelated web origins.
- Treat Markdown and frontmatter as untrusted input.
- Sanitize rendered HTML and disable raw HTML unless a future explicit policy
  allows it.
- Resolve and validate every source and asset path inside the selected library.
- Reject traversal and symlink escapes outside the selected library.
- Do not execute code blocks, shell commands, scripts, or HTML event handlers.
- Do not log full document content or absolute library paths in normal logs.
- Do not send content over the network.
- Do not store API keys because the first release has no AI provider integration.
- Store notice acceptance only in local application settings. Retain the
  notice version and timestamp, not device identity or document information.
- Keep Tauri capabilities to the minimum paths and commands required.

## 15. Reliability requirements

- Only one desktop instance may control a library at a time.
- A second launch focuses or opens the existing tray/status instance.
- A service crash must not corrupt source content or the last valid snapshot.
- Restarting the app reconstructs state from the selected library and derived
  cache without requiring manual cleanup.
- Repeated editor save patterns must not produce duplicate navigation entries.
- File deletion propagates to navigation and search after a successful
  snapshot switch.
- Refresh work is cancellable during service stop.
- Diagnostics distinguish access failure, parse failure, watcher failure,
  port conflict, index failure, and browser-open failure.

## 16. Accessibility

- All tray/status actions have keyboard-accessible equivalents.
- Status is communicated with text, not color alone.
- The compact panel follows system text scaling and reduced-motion settings.
- Existing browser-reader accessibility remains part of release verification.
- Error messages identify the action the user can take without exposing
  internal stack traces.

## 17. Release plan

### Milestone 1 — Shared service baseline

- Tauri project scaffold.
- Note Portal naming, bundle identifier, and general reader labels.
- Single-instance lifecycle.
- Native folder selection.
- General and Study profile selection, validation, and fixtures.
- Versioned first-run notice gate and permanent Settings entry.
- Loopback HTTP service.
- Packaged current Portal reader.
- Full initial library scan.
- Tray actions and compact status model.
- System-font default with the full extracted CJK fonts excluded from packaging.

### Milestone 2 — Live refresh

- Cross-platform watcher normalization.
- Content hashing and staged snapshots.
- Incremental navigation and search updates.
- SSE browser events.
- Current-document soft refresh with reading-position recovery.
- Failure recovery and diagnostics.

### Milestone 3 — Windows alpha validation

- Windows installer build, tray and login-launch verification.
- Windows path and editor save-pattern compatibility tests.
- Clean-machine installation, update, and removal checks.
- Signed installer and reputation plan before a public stable release.

### Milestone 4 — macOS parity and stable release

- Menu-bar behavior, Apple silicon validation, and login launch.
- macOS signing, hardened runtime, and notarization path.
- Clean-machine installation, update, and removal checks.
- Cross-platform regression matrix.

### Later editions

- Explicit LAN sharing with pairing.
- Multiple libraries.
- Git-synchronized hosted deployment.
- Self-hosted headless service.
- Optional provider-neutral extensions, kept outside the core refresh path.

## 18. First-release acceptance criteria

The release is complete only when all of the following are demonstrated on a
supported macOS machine and a supported Windows machine:

1. A clean install shows the complete first-run notice before accessing a
   library or starting the service.
2. Declining or closing the notice leaves no listener, watcher, selected
   library, or login-launch registration active.
3. Acceptance records the current notice version and time locally; materially
   increasing the version requires renewed acceptance.
4. Settings can always reopen the full current notice and show the accepted
   version and date.
5. After acceptance, a clean install can create a General library and first
   document, create a Study library and first Week, or select an existing
   library, without typing a path or using a terminal.
6. Direct launch opens the browser; launch at login stays quiet in the tray.
7. Adding, editing, renaming, and deleting Markdown updates navigation and
   search without restarting the app.
8. The General fixture preserves arbitrary folder navigation and ordinary
   Markdown filenames; the Study fixture maps Semester, Unit, Week, matching
   primary note, folder metadata, inbox, and asset paths exactly as specified.
9. A Week folder exposes exactly one matching primary note. Extra Markdown,
   filename/week mismatches, invalid depths, duplicate IDs, case-colliding
   paths, reserved names, and escaping symlinks are reported without source
   mutation or accidental indexing.
10. A General library recognises eligible Markdown directly in its selected
    root and nested folders without requiring Study naming or changing files.
11. Updating the current document does not reload the complete Portal shell and
   preserves a sensible reading position.
12. A partial or invalid write cannot replace the last valid snapshot.
13. Scanning, rendering, indexing, refresh, and diagnostics leave source
    Markdown and assets byte-for-byte unchanged. Explicit template creation
    creates only the previewed new paths and refuses to overwrite existing data.
14. Closing the status panel leaves the service running; **Stop service** and
   **Quit** have distinct verified behavior.
15. A port conflict results in another loopback port and a working **Open
   Portal** action.
16. Traversal, symlink escape, raw-script, unexpected-origin, and unauthorized
   refresh tests fail safely.
17. The installed package contains no user notes, credentials, AI model files,
    or machine-specific paths.
18. macOS and Windows consume the same General and Study library contracts,
    manifest, notice, and SSE fixtures.
19. Release builds meet the application-size, idle memory, idle CPU, warm-start,
    and single-file-refresh budgets in section 13.2, with recorded measurements.
20. The final diff and packaged artifacts pass focused security, accessibility,
    and clean-machine review.

## 19. Launch definition

“Online” for the first release means the local Portal is available in the
browser while the desktop service runs. It does not mean public cloud hosting.

A future hosted edition will use Git or an explicit sync client as its content
source because a remote server cannot observe files on a user's computer. That
edition reuses the same versioned library contract but has a separate security,
identity, deployment, and content-authorization PRD.

## 20. References

- Existing framework overview: `../README.md`
- Legacy Study Portal product principles: `../PRODUCT.md`
- Academic-integrity notice: `docs/ACADEMIC_INTEGRITY_NOTICE.md`
- Beginner setup guide: `docs/GETTING_STARTED.zh-CN.md`
- Library structure contract: `docs/LIBRARY_STRUCTURE.md`
- Tauri architecture: <https://v2.tauri.app/concept/architecture/>
- Tauri app-size guidance: <https://v2.tauri.app/concept/size/>
- Tauri system tray: <https://v2.tauri.app/learn/system-tray/>
- Tauri autostart plugin: <https://v2.tauri.app/plugin/autostart/>
- Tauri distribution overview: <https://v2.tauri.app/distribute/>
