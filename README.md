# Study Portal Framework

[![Windows desktop CI](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/actions/workflows/windows-desktop.yml/badge.svg?branch=master)](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/actions/workflows/windows-desktop.yml)
[![Latest Windows prerelease](https://img.shields.io/github/v/release/Sumire-no-kai/Personal-Study-Portal-Framework?include_prereleases&label=Windows%20alpha)](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/releases)
[![Platform: Windows x64 and ARM64](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20ARM64-0078D4)](#windows-desktop-alpha-note-portal)
[![License: MIT](https://img.shields.io/github/license/Sumire-no-kai/Personal-Study-Portal-Framework)](LICENSE)

> [!IMPORTANT]
> ## Academic integrity and private content only
> This repository is a **content-free local study framework**, not a notes
> repository. In line with the University of Sydney's
> [Academic Integrity Policy](https://www.sydney.edu.au/policies/a-to-z-policy/academic-integrity-policy.html),
> it does not provide any unit notes, course materials, assessment material,
> answers, or student work. **Contributors must not upload, commit, or open a
> pull request containing such content.**
>
> Deploy the framework privately and add only material you are authorised to
> use to your own local or private-hosted copy. You remain responsible for
> following the rules, permissions, attribution requirements, and AI guidance
> that apply to your unit of study.
>
> **Deployment recommendation:** do not publish an individual deployment to a
> public URL. Prefer `localhost` or an access-controlled private environment.
> A public personal deployment can unintentionally expose course material,
> assessment-related content, private notes, or generated indexes.

A local-first, content-agnostic Markdown reader for long-form learning material.
It provides structured navigation, responsive reading, LaTeX rendering,
reading-position persistence, and an optional assistant interface that can be
connected to a separate backend. The repository also contains **Note Portal**,
an alpha Windows desktop app that serves the same kind of reader for a local
folder of Markdown files.

This repository intentionally contains **no course material, personal notes,
model files, vector indexes, device configuration, or credentials**. Installer
binaries are distributed separately through GitHub Releases, not committed to
the source tree. The static reader starts in a safe empty-library state; add a generated
`notes-manifest.js` and Markdown files only in your own private deployment.

## Features

- Framework-free HTML, CSS, and JavaScript; serve the folder over HTTP.
- Markdown rendering with [Marked](https://github.com/markedjs/marked) and
  offline math rendering with [KaTeX](https://katex.org/).
- Semester, unit, and week navigation generated from a content manifest.
- Responsive sidebar, table of contents, search UI, and reading-position
  persistence.
- Optional assistant panel. The UI degrades safely when no assistant or search
  backend is configured.

## Windows desktop alpha: Note Portal

Note Portal turns a local folder of Markdown files into a reading site in your
normal browser. A small control window selects the folder, shows the
recognised structure and any problem files, watches for changes, and serves
the reader only to this computer (`127.0.0.1`) through a per-launch browser
session. It has no built-in AI service and does not upload notes. It is an
**alpha prerelease**: the installers are unsigned, and clean-machine
installation, accessibility, resource budgets and signing have not yet been
verified.

### Install

1. Open [Releases](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/releases) and download the installer for your
   processor: `*_x64-setup.exe` for most Windows PCs or `*_arm64-setup.exe`
   for Windows on ARM. The “Source code” archives and GitHub Packages are not
   the app. An x64 installer running under emulation on ARM does not count as
   native ARM64 testing.
2. Optionally compare the installer's SHA-256 with `SHA256SUMS.txt` from the
   same release, for example `Get-FileHash .\<installer>.exe` in PowerShell.
3. Windows SmartScreen may warn about the unsigned installer. Continue only on
   a computer you trust. Installing a newer alpha over an older one keeps your
   settings.
4. On first launch, open the full responsible-use notice, scroll to its end,
   agree, and complete the short guide. You are asked again whenever the notice
   changes.
5. Choose **General** for an ordinary folder of `.md` files, or **Study** for
   `content/<semester>/<unit>/<week-key>/<week-key>-notes.md`, check the
   recognition preview, then open the reader.

The [desktop guide](servers/desktop-windows/README.md) and the beginner
walkthrough in [Chinese](servers/desktop-windows/docs/GETTING_STARTED.zh-CN.md)
or [English](servers/desktop-windows/docs/GETTING_STARTED.en.md) cover daily
use. The control window follows the system's Chinese or English language and
has a manual switch; Windows settings offer reader accent colours and an
optional local PNG/JPEG/WebP logo, and no school logos are bundled. Settings
are stored in `%APPDATA%\io.github.sumirenokai.noteportal`. Apart from the
explicit **Create note** and **Create Week template** actions, which never
overwrite a file, the app does not write to your library, and it never moves,
renames or deletes your Markdown files.

### Known limitations

- Closing the control window keeps the service running with an icon in the
  notification area. If you cannot find the icon, launch Note Portal again to
  reopen the window. On Windows 11 you can keep the icon visible under
  **Settings → Personalization → Taskbar → Other system tray icons**.
- The browser reader interface is currently Chinese only; the control window
  is available in Chinese and English.
- There is no macOS build yet.
- Keep the reader on this computer. Do not expose the local service to a
  network or the public internet.

### Report a problem

Choose **Bug report** or **Feature request or feedback** on the
[new issue page](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/issues/new/choose).
The bug form asks for the version shown in **About**, your Windows version,
processor type and steps to reproduce. Do not include note contents, private
file paths, reader links with session tokens, or course or assessment material.

### For contributors

The repository-root reader is the static-site baseline. The Windows binary
embeds the independent, content-free copy at `servers/desktop-windows/reader/`
so desktop changes do not alter the root site or any separate private
deployment. It never bundles a user's library. Windows CI checks formatting,
runs the tests and Clippy, and builds NSIS installers on native x64 and ARM64
runners for relevant pull requests and `master` pushes. CI artifacts are
temporary test outputs kept for 14 days, not a public download release. After
a change is merged, a `v*-alpha.*` tag pointing to the current `master` commit
triggers the release workflow. The tag must match the version in the Tauri,
Cargo and npm manifests, and the workflow publishes both installers and their
SHA-256 checksums as a prerelease only if both architecture jobs pass. PR merge
alone does not create a tag or release. Release notes combine maintained
safety and installation guidance with automatically generated change notes.
The [Windows device test plan](servers/desktop-windows/docs/WINDOWS_TEST_PLAN.zh-CN.md)
covers clean installation, content safety, refresh and native ARM64 checks. Do
not label a build stable until the Windows device matrix and clean-machine
checks pass.

## Deploy the framework

Clone the framework and serve it over HTTP rather than opening `index.html`
directly:

```zsh
git clone git@github.com:Sumire-no-kai/Personal-Study-Portal-Framework.git
cd Personal-Study-Portal-Framework
python3 -m http.server 4173
```

Then open `http://localhost:4173/`. Without a private manifest, the portal
shows an empty-library state and makes no recurring content, search, or
assistant requests.

Any static HTTP server can host the same folder in a private environment. Do
not publish a deployment that exposes material you are not authorised to
share.

## Add notes in a private deployment

The public framework intentionally has **no upload API and no bundled notes**.
Content is file-based so that you control where it is stored:

1. Keep a private copy of the deployed folder; do not add course content to
   this public repository.
2. Create Markdown files under `notes/`, for example
   `notes/demo101/week-1.md`.
3. Create a `notes-manifest.js` beside `index.html` that lists only those files.
4. Serve the folder again and refresh the browser.

Both `notes/` and `notes-manifest.js` are ignored by Git. Confirm that before
you commit anything:

```zsh
git check-ignore -v notes/demo101/week-1.md notes-manifest.js
```

Never override these rules with `git add -f` for course or assessment content.

### Manifest format

Deployments that have their own content can provide a generated
`notes-manifest.js` in this shape:

```js
window.PORTAL_DATA = {
  id: "2026-s2",
  label: "2026 Semester 2",
  pickerLabel: "2026 · Semester 2",
  generatedAt: "2026-09-01 12:00:00",
  units: [
    {
      code: "DEMO101",
      name: "Example unit",
      topics: "A private collection",
      weeks: [
        {
          id: "demo101-w1",
          week: 1,
          weekLabel: null,
          title: "Example document",
          topics: [],
          path: "notes/demo101/week-1.md",
          updated: "2026-09-01 12:00"
        }
      ]
    }
  ]
};
```

The manifest and referenced `notes/` directory are intentionally ignored by
this repository. Keep any real source material, generated search indexes, and
AI/RAG artifacts in a private deployment.

## Third-party software

The vendored copies of Marked and KaTeX retain their upstream MIT license
files under `vendor/`. Their notices apply to those dependencies; this
repository's own code is available under the MIT License.

## License

MIT. See [LICENSE](LICENSE).
