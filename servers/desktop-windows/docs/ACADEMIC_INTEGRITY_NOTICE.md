# Responsible Use, Privacy, and Academic Integrity Notice

**Notice version:** 1.3

This is an internal implementation reference. The user-facing full notices are
[`NOTICE.zh-CN.md`](NOTICE.zh-CN.md) and [`NOTICE.en.md`](NOTICE.en.md);
only those files are bundled for the mandatory full notice and Settings entry.
No separate qualified review is required before the stable release (maintainer
decision, 2026-09-26).
They are not legal advice or institutional approval.

## First-run concise copy — Simplified Chinese

### 学术诚信与负责任使用提示

Note Portal 用于帮助用户整理、阅读和检索其有权使用的本地 Markdown 文档。
学习笔记是其中一项重要用途。本工具不会授予用户复制、处理、发布或分享任何
课程材料、考试资料、作业内容、个人信息或第三方作品的权利。

在继续使用前，请检查并遵守你所在学校、院系、课程和考试的学术诚信规定，
以及适用的版权、隐私、保密和信息安全要求。不同学校、课程和评估活动的规定
可能不同；本提示不能替代学校规则或专业法律意见。

默认情况下，建议仅在自己的电脑上使用本工具。通常不建议将 Portal 服务直接
部署到公网，因为公开访问可能意外暴露课程资料、评估内容、私人笔记或个人信息。
如需分享或远程访问，请先确认你拥有必要授权，并采取合适的访问控制措施。

不得使用本工具从事侵犯版权、泄露受限资料、规避学术诚信要求、未经授权访问，
或其他违反适用法律及学校规定的行为。用户应对其导入、处理、发布、分享的内容
以及服务配置和使用方式负责。

☐ 我已阅读并理解以上提示，同意仅处理我有权使用的内容，并遵守适用的学校规定、
法律和授权要求。

**Primary action:** 同意并继续

**Secondary action:** 不同意并退出

**Link:** 查看完整使用提示、隐私说明与开源许可证

## First-run concise copy — English

### Academic integrity and responsible use

Note Portal helps users organise, read, and search local Markdown documents
they are authorised to use. Study notes are an important use case. The product
does not grant any right to copy, process, publish, or share course material,
assessment content, personal information, or third-party works.

Before continuing, review and follow the academic-integrity rules of your
institution, faculty, course, and assessment, together with applicable
copyright, privacy, confidentiality, and information-security requirements.
Rules differ between institutions and activities. This notice does not replace
institutional policy or professional legal advice.

Use on your own computer is recommended by default. Direct public-internet
deployment is generally discouraged because it may unintentionally expose
course material, assessment content, private notes, or personal information.
Before sharing or enabling remote access, confirm that you have permission and
apply appropriate access controls.

Do not use this tool to infringe copyright, disclose restricted material,
circumvent academic-integrity requirements, gain unauthorised access, or engage
in conduct that violates applicable law or institutional rules. You are
responsible for the content you import, process, publish, or share and for how
you configure and use the service.

☐ I have read and understood this notice. I agree to process only content I am
authorised to use and to follow applicable institutional rules, laws, and
permission requirements.

**Primary action:** Agree and continue

**Secondary action:** Decline and quit

**Link:** View full usage notice, privacy information, and open-source licences

## Full notice requirements

The full Settings view must display the concise notice plus the following:

### Local processing and privacy

- The first release reads the folder selected by the user and derives local
  navigation, hashes, and search data.
- The first release does not provide cloud accounts or built-in AI services and
  does not intentionally upload note content.
- The service listens on the local computer by default.
- Acceptance metadata consists only of the notice version and acceptance time
  in local application settings.
- Diagnostic logs must not contain complete note bodies, credentials, or
  unnecessary absolute paths.

### Source files

- Markdown files and referenced assets remain under the user's control.
- The first release treats existing files as read-only and does not silently
  move, rename, delete, or rewrite them. Explicit **Create note** and **Create
  Week template** actions may add a new file but must never overwrite one.
- External editors and automation remain responsible for their own changes.

### Public and remote access

- Loopback-only use is the first-release default.
- Public deployment is outside the first-release supported scope.
- A later LAN or hosted mode must add explicit authentication, authorisation,
  secure transport, and separate disclosure before release.

### No institutional endorsement

Note Portal is an independent tool unless a specific distribution explicitly
states otherwise. Displaying a university name, course code, or user-provided
branding does not imply endorsement, approval, or verification by that
institution.

### User responsibility

Users are responsible for determining whether they are permitted to possess,
process, index, display, publish, or share particular content. If uncertain,
they should keep the service private and ask the relevant institution, content
owner, or qualified adviser before proceeding.

## Implementation contract

- Stable identifier: `academic-integrity-and-responsible-use`
- Current version: `1.3`
- The first-run checkbox stays disabled until the full notice is opened and scrolled to its end.
- The first-use guide must be completed before library selection or service startup.
- Required local acceptance fields: `noticeVersion`, `acceptedAt`
- Acceptance must precede library selection, service startup, browser launch,
  filesystem watching, indexing, and launch-at-login registration.
- A material change increments the version and invalidates older acceptance.
- The complete notice remains available from Settings after acceptance.
- Decline or window close exits setup without activating background behavior.
