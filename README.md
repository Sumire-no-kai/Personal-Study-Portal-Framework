# Study Portal Framework

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
connected to a separate backend.

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

## Windows desktop alpha

The [Windows prereleases](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/releases)
contain an unsigned `*-setup.exe` installer and a `SHA256SUMS.txt` checksum.
Use the installer, not GitHub Packages. GitHub automatically supplies source
archives for each release. This is an alpha: a Windows clean-machine install,
runtime behavior, accessibility, resource budgets, and signing have not yet
been verified by the maintainers. macOS packaging is planned but not released.

The small desktop window selects a local Markdown folder, shows the recognised
structure and diagnostics, and opens the reader in your normal browser. The
local server watches for file changes and requires a per-launch browser session
to read the library. The first launch requires acceptance of the responsible-use
notice. The desktop alpha has no built-in AI service and does not upload notes.
See the [desktop guide](servers/desktop-windows/README.md) and
[beginner walkthrough](servers/desktop-windows/docs/GETTING_STARTED.zh-CN.md).

For contributors, the public repository uses one canonical reader at its root.
The desktop binary embeds only its explicitly listed public reader assets; it
does not bundle the selected library. Windows CI tests and builds the NSIS
installer on pull requests and relevant pushes. A `v*-alpha.*` tag at the
current `master` commit publishes a prerelease after those checks pass.

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
