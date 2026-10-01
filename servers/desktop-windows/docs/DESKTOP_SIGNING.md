# Desktop signing / 桌面应用签名

## Current status

- Windows x64 and ARM64 Releases remain unsigned. SignPath enrollment is being
  prepared in [#68](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/issues/68);
  no certificate or approved SignPath project is configured yet.
- macOS has an Apple Silicon **experimental build** with ad-hoc signing.
  This verifies bundle integrity but does not authenticate a publisher. It is
  not Developer ID signing or Apple notarization, and does not remove
  Gatekeeper's download checks. No paid Apple account is used.
- Signing does not demonstrate runtime compatibility. macOS first-run,
  menu-bar behavior, login launch and library tests still need device results.
  Windows remains the first stable-release target.
  The experimental build still inherits Windows-oriented labels in About and
  Settings, and its macOS language fallback reads `LANG`; those are not yet
  platform-polished user flows.

## Build and verify the macOS artifact

Use the existing shared project; do not copy or modify the separately deployed
reader. On macOS, from `servers/desktop-windows/`:

```sh
npm ci
npx tauri build --target aarch64-apple-darwin --bundles app -- --locked
codesign --verify --deep --strict --verbose=2 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Note Portal.app'
codesign --display --verbose=4 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Note Portal.app'
```

Tauri automatically merges `src-tauri/tauri.macos.conf.json` on macOS. Its
`signingIdentity` is `-`. The shared Windows NSIS configuration is unchanged.
The target must be installed in Rust; on an Intel build host run
`rustup target add aarch64-apple-darwin` first. This artifact runs on Apple
Silicon, not Intel. The deployment target is macOS 11.0; that is a build setting,
not a claim that every intervening macOS version has been tested.

The `macOS experimental desktop` GitHub workflow checks the bundle's signature
and ARM64 architecture, then archives the `.app` using `ditto` to retain bundle
metadata. It uploads the ZIP, a signature report and SHA-256 checksum as a
14-day Actions artifact. It does not create or edit a public Release.
An extracted bundle should report `Signature=adhoc` and pass `codesign --verify`.

从 GitHub 下载后的首次打开可能仍被 macOS 拦截。只有确认下载来源及校验值后，
才按系统“隐私与安全性”中的提示决定是否允许打开；本项目不要求关闭系统防护。
本地构建能打开，不等于浏览器下载的副本已经通过 Gatekeeper 验证。

## Every new package must be signed

A signature covers the bytes of a particular executable or bundle. Rebuilding
or changing those files requires a new signature; an unchanged signed package
can be redistributed without signing it again. The signing account/certificate
is reused while valid, not reapplied for on every release.

The release sequence is build, sign, verify, compute checksums, then publish.
Never replace files inside a signed app afterward. The macOS workflow performs
ad-hoc signing on each build automatically. Windows signing can use the same CI
sequence after enrollment, with a maintainer approval for each SignPath request.

## Code signing policy — Windows enrollment preparation

Status: **proposed SignPath route; not yet approved or in use**.
The current maintainer, [Sumire-no-kai](https://github.com/Sumire-no-kai), is the
proposed code author, reviewer and release-signing approver. Confirm these
roles during enrollment. Contributors' changes require maintainer review;
signing approval remains a human action. GitHub and SignPath MFA must be
confirmed before enabling the service.

The planned provider is [SignPath Foundation](https://signpath.org/), which
offers free signing for eligible open-source projects. Approval is discretionary.
After approval and a verified signed release, add the provider's required
credit: “Free code signing provided by [SignPath.io](https://about.signpath.io/),
certificate by [SignPath Foundation](https://signpath.org/).” Do not present
this credit as an existing sponsorship before acceptance.

Privacy: the desktop app serves notes over loopback and does not upload notes
or telemetry. External documentation and support links open only on user action.
The Windows installer may download Microsoft WebView2 if it is missing.
Signing submissions contain public build artifacts, never a user's library,
runtime configuration or credentials. See the user-facing
[notice](NOTICE.en.md) ([中文](NOTICE.zh-CN.md)).

### Application facts ready to copy

- Project: Note Portal (repository: Personal-Study-Portal-Framework).
- Repository: https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework
- License: MIT; bundled third-party license notices remain in `vendor/`.
- Function: local Markdown reader with a small desktop controller, a loopback
  HTTP service and a browser reading interface. No built-in AI service.
- Distribution: GitHub Releases; currently `v0.2.0-beta.1`, Windows x64 and ARM64.
- Build: GitHub-hosted Windows runners, pinned actions and Rust toolchain,
  npm/Cargo lockfiles, tests and Clippy before NSIS packaging.
- Signing scope requested: the project's own application executable and NSIS
  installer for each architecture. Confirm uninstaller handling with SignPath.
- Maintainer contact email, MFA confirmation and service terms acceptance:
  to be completed by the maintainer, not inferred from commit metadata.

Apply through https://signpath.org/apply after reviewing its
[conditions](https://signpath.org/terms). No application has been submitted by
this preparation, and no paid service or certificate has been purchased.

### Integration after approval

Record the assigned organization ID, project slug, signing policy and artifact
configuration. Put the API token in a GitHub Actions secret, never source code
or an issue. Restrict the service to this public repository and maintainer-
approved builds on GitHub-hosted runners.

Before changing the release workflow, confirm the signing sequence with the
service: sign the application executable before embedding it in NSIS, then sign
the final installer (and arrange uninstaller signing). Signing only the outer
installer does not sign its embedded application. Do not assume NSIS supports
the same nested-signing process as MSI.

Use SignPath's [official GitHub action](https://docs.signpath.io/trusted-build-systems/github)
with a reviewed, pinned commit and the assigned configuration. Upload the input
artifact before requesting its signature. Fail the signing job on refusal,
missing credentials, timeout, wrong publisher or an invalid signature; never
substitute the unsigned input in a release advertised as signed.

On Windows, verify `Get-AuthenticodeSignature` for both the installer and the
installed application, require `Status = Valid`, inspect the expected publisher
and timestamp, then test install/upgrade/uninstall on both architectures.
Compute published SHA-256 checksums from the **signed** outputs. Keep signed
and unsigned build results distinguishable, and record actual SmartScreen
behavior rather than promising that every warning will disappear.
