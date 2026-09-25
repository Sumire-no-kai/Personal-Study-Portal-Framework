# Note Portal

Note Portal is a lightweight Windows alpha, with macOS support planned, that turns a local
Markdown folder into a structured reading website. The desktop process selects
and watches a library, runs the local service, and opens the user's normal
browser. Study notes are an important built-in profile, not the only supported
content.

## Product boundary

- The user's Markdown files remain the authoritative source.
- Scanning, rendering, indexing, refresh, and diagnostics are read-only.
  Explicit **Create note** and **Create Week template** actions may add new
  files but never overwrite existing paths.
- Content is rendered in the browser rather than in a large application
  window.
- External editors and automation may update the Markdown files. The Portal
  detects those changes and refreshes the affected browser state.
- Built-in AI generation and local model execution are not part of the first
  desktop release.
- The service listens on `127.0.0.1` by default. LAN access is a later,
  explicitly enabled capability.
- First launch requires opening and scrolling to the end of the rendered
  academic-integrity and responsible-use notice, explicit agreement, then
  completion of the non-skippable guide before the app may select content or
  start its service.
- The compact control window defaults to Chinese or English from the system
  language and offers a manual switch. Windows reader settings offer four
  accent colours and an optional local PNG/JPEG/WebP logo up to 2 MiB. No
  official institution logos are bundled.
- General libraries preserve ordinary folders and recognise eligible `.md`
  documents recursively.
- Study libraries follow the deterministic layout documented in
  [docs/LIBRARY_STRUCTURE.md](docs/LIBRARY_STRUCTURE.md):
  `content/<semester>/<unit>/<week-key>/<week-key>-notes.md`.
- A no-terminal, beginner-oriented walkthrough is available in
  [Chinese](docs/GETTING_STARTED.zh-CN.md) and
  [English](docs/GETTING_STARTED.en.md).
- A release-install and device QA checklist, including Windows on ARM, is in
  [docs/WINDOWS_TEST_PLAN.zh-CN.md](docs/WINDOWS_TEST_PLAN.zh-CN.md).

## One project, two platforms

macOS and Windows must share one product implementation. Do not create two
independent applications. Platform-specific code is limited to behavior that
cannot be shared, such as startup registration, tray conventions, signing,
notarization, and installer configuration.

The current alpha implements the Windows path first, using Tauri 2, a Vanilla
TypeScript status panel, and one Rust process for scanning, watching, and HTTP.
The macOS package remains planned, not tested or released. Tauri supports
system-tray applications and startup registration on both target platforms:

- <https://v2.tauri.app/learn/system-tray/>
- <https://v2.tauri.app/plugin/autostart/>

## Source layout

```text
servers/desktop-windows/
├── AGENTS.md
├── .gitignore
├── PRD.md
├── README.md
├── docs/                        # User-facing policy and product documents
├── examples/                    # General and Study library fixtures
├── package.json
├── reader/                      # Windows-only, content-free browser reader copy
├── src/                         # Small tray/status window
├── src-tauri/
│   ├── capabilities/            # Minimum Tauri permissions
│   ├── icons/
│   ├── src/
│   │   ├── library.rs           # Discovery, metadata and snapshots
│   │   ├── platform/            # OS-specific integration
│   │   ├── server.rs            # Loopback HTTP, SSE and watcher
│   │   └── main.rs
│   └── tauri.conf.json
└── package-lock.json
```

The desktop server embeds the Windows reader copy at compile time and uses
shared vendored Marked/KaTeX libraries; it does not include any user content.
General and Study differ by their
discovery contract and navigation data, not by a second web application.

## Build the Windows alpha

On Windows, install Node.js and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):
Rust with the MSVC toolchain, Microsoft C++ Build Tools with “Desktop development
with C++”, and the WebView2 runtime. The checked-in `rust-toolchain.toml`
selects Rust 1.98.1 for local and CI builds. In PowerShell from this directory:

```powershell
npm ci
npm run build
cd src-tauri
cargo test
cd ..
npx tauri build
```

For a local **native Windows on ARM** build, install the Visual Studio C++
ARM64 build tools, then run `rustup target add aarch64-pc-windows-msvc` and
`npx tauri build --target aarch64-pc-windows-msvc` from this directory. The
ARM64 NSIS output is under
`src-tauri/target/aarch64-pc-windows-msvc/release/bundle/nsis/`.
The CI uses a native `windows-11-arm` runner instead of asking x64 testers to
cross-compile.

The default host build writes its unsigned
[NSIS setup executable](https://v2.tauri.app/distribute/windows-installer/)
under `src-tauri/target/release/bundle/nsis/`. The public repository's
Windows CI builds x64 and native ARM64 targets on separate Windows runners and
uploads temporary architecture-labelled artifacts for review. After a PR is
merged, a `v*-alpha.*` tag at the current `master` commit triggers a GitHub
prerelease with both installers and `SHA256SUMS.txt` only if both jobs pass. A
tag must match the version in the Tauri, Cargo, and npm manifests; the About
dialog reads the packaged version so testers can identify the installed alpha.
A version bump alone does not publish or replace an existing release. A
PR or `master` push without that tag does not publish a release. The release
description contains fixed installation/safety guidance plus generated change
notes; it does not assert clean-machine compatibility. ARM64 testers should
choose the `arm64-setup.exe` asset, not treat an emulated x64 run as native
ARM64 validation.
The ARM64 NSIS bootstrapper itself may use x86 emulation while the installed
application is native ARM64.
Windows Defender/SmartScreen may warn about an unsigned alpha. Do not bypass
such warnings on a machine you do not trust.

The app must show the current responsible-use notice and require the first-run
guide before any folder picker, watcher, or HTTP listener. The full notice has
separate complete Chinese and English user-facing text; the internal
implementation reference is not shown in the app. If local settings become
unreadable, the control window can restore a backup or preserve the damaged
file before an explicit reset. Choose General for ordinary recursive `.md` files,
or Study for `content/<semester>/<unit>/<week-key>/<week-key>-notes.md` plus
optional `inbox/`. The status window previews recognised files and warnings;
the normal browser reads the notes on a loopback `127.0.0.1` port. The app
tries the previous port on later starts to retain browser reading preferences,
and uses another port if it is occupied. Only explicit
**Create note** and **Create Week template** actions write into the library;
the General form previews the exact destination and blocks a detected name
collision before submission. A bad individual note or image appears in
diagnostics without hiding other notes; an already visible note keeps its last
readable body while it is temporarily malformed. The backend still creates
exclusively, so a file appearing after the preview cannot be overwritten.

## Relationship to the existing Portal

The repository-root reader remains the static-site baseline. Windows embeds
its own copy in `reader/` and serves it over loopback with a local library.
Changes to the Windows copy do not change the root site or a separate private
deployment. Review any future root-to-Windows reader sync explicitly.

What the desktop build does exclude is content, not code: private notes,
generated manifests, course configuration and indexes, and any credential.

## Alpha limitations

The [PRD](PRD.md) defines the stable-release acceptance criteria. Formatting,
unit tests and Clippy run on native Windows x64 and ARM64 CI runners, and
Windows alpha builds were installed and exercised on one x64 PC and one Windows
on ARM device (see the [test plan](docs/WINDOWS_TEST_PLAN.zh-CN.md), the
[alpha.3 x64 test record](docs/WINDOWS_X64_TEST_RUN_2026-09-25_ALPHA3.md), and
the [earlier x64 record](docs/WINDOWS_X64_TEST_RUN_2026-09-23.md)). Clean-machine
installation, accessibility, signing, resource budgets and tray-icon visibility
across devices are not yet verified. The in-memory
search snapshot currently retains Markdown bodies and rescans the whole
library after a relevant file event; an image whose size and modification time
are unchanged keeps its previous hash instead of being read again, and served
images are still verified against that hash. Incremental indexing, the 100 MiB
idle-memory budget for a large library, and the sub-second refresh target are
not yet demonstrated. Do not present this as a stable public release until
those checks and the notice's requested policy review are complete.
