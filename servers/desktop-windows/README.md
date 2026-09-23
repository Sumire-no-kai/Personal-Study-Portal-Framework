# Note Portal

Note Portal is a lightweight macOS and Windows service that turns a local
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
- First launch requires an explicit academic-integrity and responsible-use
  acknowledgement before the app may select content or start its service.
- General libraries preserve ordinary folders and recognise eligible `.md`
  documents recursively.
- Study libraries follow the deterministic layout documented in
  [docs/LIBRARY_STRUCTURE.md](docs/LIBRARY_STRUCTURE.md):
  `content/<semester>/<unit>/<week-key>/<week-key>-notes.md`.
- A no-terminal, beginner-oriented walkthrough is available in
  [docs/GETTING_STARTED.zh-CN.md](docs/GETTING_STARTED.zh-CN.md).
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
├── src/                         # Small tray/status window
├── src-tauri/
│   ├── capabilities/            # Minimum Tauri permissions
│   ├── icons/
│   ├── src/
│   │   ├── library.rs           # Discovery, metadata and snapshots
│   │   ├── server.rs            # Loopback HTTP, SSE and watcher
│   │   └── main.rs
│   └── tauri.conf.json
└── package-lock.json
```

The desktop server embeds only the root reader's public assets at compile time;
it does not copy that reader or include any user content. General and Study differ by their
discovery contract and navigation data, not by a second web application.

## Build the Windows alpha

On Windows, install Node.js and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/):
Rust with the MSVC toolchain, Microsoft C++ Build Tools with “Desktop development
with C++”, and the WebView2 runtime. In PowerShell from this directory:

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
uploads distinct artifacts for review. A version tag publishes both installers
as a GitHub prerelease after both jobs pass; it does not assert clean-machine
compatibility. The first `v0.1.0-alpha.1` release predates the ARM64 build and
contains only x64. ARM64 testers should choose an `arm64-setup.exe` asset from
a newer release, not treat an emulated x64 run as native ARM64 validation.
The ARM64 NSIS bootstrapper itself may use x86 emulation while the installed
application is native ARM64.
Windows Defender/SmartScreen may warn about an unsigned alpha. Do not bypass
such warnings on a machine you do not trust.

The app must show the current responsible-use notice before any folder picker,
watcher, or HTTP listener. Choose General for ordinary recursive `.md` files,
or Study for `content/<semester>/<unit>/<week-key>/<week-key>-notes.md` plus
optional `inbox/`. The status window previews recognised files and warnings;
the normal browser reads the notes on a random `127.0.0.1` port. Only explicit
**Create note** and **Create Week template** actions write into the library.

## Relationship to the existing Portal

There is exactly one reader at the repository root. The desktop server embeds
its audited static assets and serves them over loopback with a local library;
it does not fork the reader.

What the desktop build does exclude is content, not code: private notes,
generated manifests, course configuration and indexes, and any credential.

## Alpha limitations

The [PRD](PRD.md) defines the stable-release acceptance criteria. This alpha
has passed macOS static compilation and focused unit tests, but the Windows
installer, actual window/browser behaviour, accessibility, clean-machine
installation, signing, and resource budgets are not yet verified. The in-memory
search snapshot currently retains Markdown bodies and rescans the whole
library after a relevant file event. Incremental indexing, the 100 MiB
idle-memory budget for a large library, and the sub-second refresh target are
not yet demonstrated. Do not present this as a stable public release until
those checks and the notice's requested policy review are complete.
