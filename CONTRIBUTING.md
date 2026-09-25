# Contributing / 参与贡献

You do not need to write code to help improve Note Portal. Bug reports,
documentation corrections and suggestions are welcome.

不需要会写代码也能帮助改进 Note Portal。欢迎报告问题、指出文档错误或提出建议。

## Before opening an issue / 提交前

1. Check the [user guide](servers/desktop-windows/docs/GETTING_STARTED.zh-CN.md)
   ([English](servers/desktop-windows/docs/GETTING_STARTED.en.md)) and search
   [existing issues](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/issues),
   including closed ones. If an existing issue matches, add relevant new
   information there instead of opening a duplicate.
2. Use the [new issue page](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/issues/new/choose):
   choose **Bug report** for something broken or documented incorrectly, or
   **Feature request or feedback** for an improvement or new use case.
3. Use a temporary or example library when reproducing a problem. Public
   issues and pull requests must not contain real notes, course or assessment
   material, credentials, personal file paths, generated indexes, or reader
   URLs with session tokens. Redact screenshots before attaching them.

提交前请先看使用指南并搜索已有 Issue（包括已关闭的）。如果是同一个问题，
请在原 Issue 补充新信息。复现时尽量使用临时文件夹或仓库中的示例资料库；
公开内容中不要出现真实笔记、课程或评估资料、密钥、私人路径、生成的索引，
或带会话令牌的阅读页链接。截图也请先遮挡这些信息。

## Report a bug / 报告问题

Open the [bug report form](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/issues/new?template=bug_report.yml).
Please include:

- The app version shown in **About**, Windows version, and whether the device
  is x64 or Windows on ARM. Windows users can press Win+R and run `winver`
  to find the system version; choose **Not sure** for the processor if needed.
  If the problem is in the static reader, enter `N/A (static reader)` for the
  required app version and say which browser you used.
- What you did, what actually happened, and what you expected instead. List
  the steps in order so someone else can reproduce the problem.
- The exact error message or a redacted screenshot if useful. Say whether the
  problem happens every time or only sometimes.

填写时请写明“关于”中的应用版本、Windows 版本和处理器类型。按 Win+R、
输入 `winver` 可查看 Windows 版本；不知道处理器类型时可选“不确定”。
如果问题发生在仓库根目录的静态阅读页，应用版本可填
`N/A (static reader)`，并注明浏览器。按顺序写出操作步骤、实际结果和预期结果。
错误提示或截图可以附上，但必须先去除隐私信息。

## Suggest a change / 提出修改建议

Open the [feature and feedback form](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/issues/new?template=feature_request.yml).
Describe what you want to accomplish, what is difficult today, and how the
change would help. You do not need to design the implementation. Please keep
one coherent request per issue so it can be discussed and tracked clearly.

请说明你想完成什么、现在遇到什么不便，以及建议会带来什么帮助；
不需要先想好技术实现。一个 Issue 尽量只讨论一项完整的改进。

## Propose a pull request / 提交代码或文档

For a substantial change, open or join an issue before writing a large patch.
Keep the pull request focused, explain the problem and approach, and list the
checks you actually ran. Small documentation corrections can go straight to a
pull request. See the [desktop README](servers/desktop-windows/README.md) for
build instructions.

The repository-root reader is the static-site baseline. Windows-specific
reader changes belong in `servers/desktop-windows/reader/`; do not copy private
libraries into either reader. Never commit generated manifests, local
settings, build output, or real user content.

较大的修改请先在 Issue 中讨论；小型文档修正可以直接提交 PR。PR 中请说明
问题、改动方式和实际运行过的检查。根目录网页与 Windows 阅读页是独立副本，
Windows 专属改动只应修改 `servers/desktop-windows/reader/`。不要提交
私人资料库、本地设置、生成的清单或构建产物。
