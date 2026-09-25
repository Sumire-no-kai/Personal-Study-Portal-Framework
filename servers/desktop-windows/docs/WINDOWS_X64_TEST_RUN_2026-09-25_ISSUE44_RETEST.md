# Note Portal Windows x64 复测 — Issue #44，2026-09-25

按照 [#44 最新评论](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/issues/44#issuecomment-5829952657)覆盖安装指定的 x64 构建，复测 A2、D1、D4、D5、E1、F1、F3 七项 ★ 检查。**6 项通过、1 项失败（D4）**。A1、B1、B2 沿用[上一轮记录](./WINDOWS_X64_TEST_RUN_2026-09-25_ISSUE44.md)的通过结果，本轮没有重测；F6 是评论列出的可选项，本轮未测。Windows on ARM 未测。

## 构建与环境

| 项目 | 本轮记录 |
| --- | --- |
| 源码与工件 | [Windows desktop Actions run 36116981117](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/actions/runs/36116981117) 成功；构建提交 `94c127f46ad1342b6e30739cc50f8fdf250aca1d`，包含 #54。工件名 `note-portal-windows-x64-installer`。这是发布前 Actions 构建，不是公开 Release。 |
| 工件 ZIP | 3,874,289 字节；SHA-256 `A73DDC018E0CEF666BB933884A9552547F7A3CEACA56DF5D6945138A83DC3463`，与 Actions API 的工件 digest 一致；ZIP 内只有下述 x64 安装程序。 |
| 安装程序 | `Note Portal_0.1.1-alpha.1_x64-setup.exe`，3,892,233 字节；SHA-256 `35E4080B68C60870310C7DAA6623BB918CEE53D1356441ACC72D44511C00123D`；Authenticode `NotSigned`。在本机原 alpha 安装上选择 **Add/Reinstall components**，安装器显示 **Installation Complete**，保留原设置。 |
| 安装后程序 | `0.1.1-alpha.1`，14,851,072 字节；SHA-256 `C096737057D1420FCC9395397EF19F08EF81365EE649AF03D07B0E6A66B5D4AB`；x64。版本号与上一包相同，以 Actions 运行、提交及文件哈希区分。 |
| 测试主机 | Windows 11 Home 25H2，构建 `26200.9457`，64 位 x86-64；Edge WebView2 Runtime `153.0.4234.48`；Chrome `153.0.8010.53` 为本机阅读器浏览器。这是有既存设置的本机账户，不是干净安装环境。 |
| 测试资料 | 原有 Study 资料库是先前建立的临时课程笔记副本；其余写入只发生在仓库虚构 General 示例的独立临时副本。另有 1,441 行虚构长文、空文件夹及临时图片。没有把私人课程资料或本机绝对路径写入本报告。 |

## 七项结果

| 项目 | 结果 | 实机观察 |
| --- | --- | --- |
| A2 升级同意与原库恢复 | **通过** | 1.3 完整提示为正式文本，未见开发说明；未滚到底时勾选禁用，滚到底后启用，切换中文/英文不重置已读状态。同意后直接回到原 Study 资料库状态页，显示原有 **3 篇**笔记、服务自动运行；同意步骤未观察到浏览器自动打开，手动点击“打开阅读器”可读。原来带 Windows `Encrypted` 属性的设置目录在本轮成功保存 `noticeVersion=1.3`，上轮“无法安全替换本机设置文件”未再出现。 |
| D1 夜间主题跨重启 | **通过** | 在 Chrome 阅读页设置中切换夜间，辅助功能状态为夜间 On；从控制窗口退出应用、重新启动并刷新阅读页后仍为夜间 On。测完恢复白昼主题。 |
| D4 CRLF front matter | **失败：首个 H1 缺失** | 按 [#44 原始示例](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/issues/44)创建 CRLF 文件 `crlf-test.md`，含 `title: CRLF test`、`# Heading`、`Body`。文件为 120 字节，SHA-256 `0A38997D897D79D6F743827A97303F7F1AC74621295752DAFDDC44616974063D`。导航与页面标题显示 `CRLF test`，正文显示 `Body`，没有 front matter 的列表点、横线或单字母伪标题；但正文 **没有 `Heading`**，不符合清单“从 Heading 开始”的要求。另一个标题不同的 CRLF 试件也复现。源码 `reader/app.js` 的 `enhanceMarkdownArticle()` 无条件移除正文首个顶层 H1（约第 2160–2167 行），可解释这个现象；需确认是修改阅读器还是调整验收约定。此现象不能归因为 CRLF 解析失败。 |
| D5 长文热刷新与保位 | **通过** | General 临时长文初始 1,441 行、160 个 Section，滚到第 80 节附近（约 49.6%）。外部在文末连续两次追加并保存不同标记；每次下一次约 0.5 秒轮询时页面结构已出现新标记，当前仍是同一篇笔记。第 80 节在两次更新后仍位于视口中部附近（约 y=528–529 px），没有跳回页首；未用独立秒表测精确刷新时延。 |
| E1 坏文件隔离 | **通过** | 临时库加入 4 字节无效 UTF-8 `legacy.md` 与 33 MiB `huge.png`；状态页仍列出其余 **7 篇**正常笔记，“2 个文件未识别”分别提示“文件不是有效 UTF-8”和“文件超过 32 MiB 的大小限制”。删除这两个测试文件后诊断自动消失。 |
| F1 General 新建笔记 | **通过** | 目标列表包含 `Empty Folder`，不包含 `_assets`；状态页没有 `\\?\` 扩展路径前缀。预览显示 `general-retest / Empty Folder / Issue 44 retest note.md`，创建后文件确实落入空文件夹。再次输入同名标题时预览提示不会覆盖、创建按钮禁用，原文件 SHA-256 保持 `F2CF5548C79E641B3486B98A3823FF9AB6B1848C1FD1055DDA7A9AAFDDEE3581`。 |
| F3 Logo 格式、大小与清除 | **通过** | 依次上传 136 字节 PNG、634 字节 JPEG、30,320 字节 WebP；设置成功保存与上传文件相同的字节，刷新 Chrome 阅读页后顶部显示对应图像。WebP 图来自 [Google WebP 示例图库](https://developers.google.com/speed/webp/gallery1)。2,097,153 字节 PNG 提示超过 2 MiB；SVG 提示仅接受 PNG/JPEG/WebP，拒绝后有效 WebP 保持。点击“清除 Logo”并刷新，顶部恢复纯文字 `Note Portal`。SVG 通过 WebView 文件输入模拟选择，以核对应用自身格式校验；普通文件选择器的 `accept` 属性也只列出三种允许格式。 |

## 测试边界与结束状态

- 本轮测试的是上述安装包的实际 Windows x64 程序与 Chrome 阅读页。为操作本机文件输入和下拉框，短时间以 `--remote-debugging-address=127.0.0.1` 参数启用 WebView2 调试端口；结束时应用已退出，端口不再监听。浏览器控制插件连接缺少运行文件，因此浏览器可见状态由 Windows 辅助功能和屏幕观察核对，F1/F3 的 WebView 控件由本机调试接口操作。
- 测试前本机应用设置目录和 `settings.json` 均带 `Encrypted` 属性，测试后两者仍带该属性。已恢复测试前所选 Study 资料库、绿色主题色和无 Logo 状态；1.3 同意记录保留。临时的明文原设置备份已删除，应用自己的设置备份保留。
- 原 General/Study 临时资料库的 **13 个基线文件**均存在，大小与 SHA-256 未变；D4、D5、E1、F1 的试件只写在新的 General 临时副本中。没有修改公开仓库示例原件或真实课程材料。
- D4 是本轮唯一未满足的 ★ 验收点。F6 为可选设置恢复测试，本轮未对仍加密的现有设置进行故意损坏测试，因此没有 F6 结果。
