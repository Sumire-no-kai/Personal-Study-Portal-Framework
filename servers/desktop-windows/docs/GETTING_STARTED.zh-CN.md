# Note Portal 零基础开始指南

Note Portal 把电脑中的 Markdown 文件夹变成可搜索、自动刷新的阅读网页。你不
需要会编程，不需要打开终端，也不需要理解服务器或 YAML。

你可以用普通编辑器写笔记，也可以让外部 AI 工具生成或更新 Markdown。Note
Portal 负责识别、整理和阅读这些文件，**本身不提供 AI 总结或聊天服务**；正文
会在你平时使用的浏览器中打开，不会塞进应用的小窗口。

## 第一次打开应用

应用先显示小窗口和必须阅读、同意的使用提示。请点击 **查看完整使用提示**，
在排版好的正文中滚动到末尾，再勾选同意；仅打开窗口还不能勾选。之后必须完成
三步 **一分钟了解** 指引，才能选择资料库或启动本地服务。指引介绍软件用途、
两种文件摆放方式和主要按钮。之后可以随时从 **使用指南** 重看详细说明。
界面会按系统语言默认显示中文或英文；也可以在窗口右上角或 **设置与条款**
中手动切换。

选好文件夹后，小窗口会展示它识别到的 Markdown 目录树、文档数量，以及未识别
文件的数量和具体原因。目录树只显示文件夹与名称，不显示文档正文。如果 Study
笔记放错位置，先看提示中的建议路径；软件不会擅自移动或重命名文件。

小窗口的常用按钮：

- **打开阅读器**：在默认浏览器打开阅读网页；
- **立即刷新**：重新检查文件夹，查看新文件或结构问题；
- **打开文件夹**：用文件管理器打开当前资料库；
- **更换资料库**：改选资料库，先预览识别结果；
- **设置与条款**：管理登录启动、界面语言、Windows 阅读页主题色和本机 Logo，
  并重看排版后的完整使用提示；
- **使用指南**：重看本页介绍与文件摆放示例。

关闭小窗口不等于退出服务；需要停止时请使用 **停止服务**，完全退出时请
使用 **退出**。**关于** 中可以找到自愿支持项目的 Buy Me a Coffee
链接；是否支持不影响任何功能，也不需要等待或付款才能继续使用。

## 先选择资料库类型

首次使用时，应用会让你选择：

- **General notes**：个人笔记、项目文档、工作记录、读书摘录等普通 Markdown；
- **Study notes**：需要按 Semester、Unit 和 Week 显示的学习笔记。

选择只决定文件如何被识别和显示。两种类型都保留本地文件、自动刷新，并使用
同一个阅读网页。

## General notes

已有 Markdown 文件夹时，选择 **Use an existing folder**，再选择 General。你
选择的文件夹就是资料库，不需要重命名或增加固定层级：

```text
My Notes/                      # 应用中选择这一层
├── ideas.md
├── projects/
│   ├── roadmap.md
│   └── meeting-notes.md
└── reading/
    └── book-notes.md
```

网页会保留 `projects` 和 `reading` 等目录结构。普通 `.md` 都会成为文档；隐藏
目录、临时文件和 `_assets` 附件目录不会进入导航。

创建新资料库时：

1. 选择 **Create a new library**；
2. 选择 **General notes**；
3. 选择保存位置并填写资料库名称；
4. 点击 **创建并打开**，让软件建立资料库；
5. 在状态窗口点击 **＋ 创建笔记**，填写标题和可选文件夹，确认资料库内的目标
   位置后创建；空文件夹也可选择；
6. 用平时的 Markdown 编辑器写入内容并保存；
7. 点击 **打开阅读器**。

应用不会覆盖同名文件。如果文件已经存在，会停止并提示你选择其他名称。

## Study notes

Study 使用固定的四段结构：

```text
Semester → Unit → Week → 这一周的主笔记
```

例如：

```text
content/2026-semester-2/UNIT1001/week-01/week-01-notes.md
```

文件夹叫 `week-01`，主笔记就叫 `week-01-notes.md`。两个名称必须对应，从而
避免草稿、说明或外部工具上下文被误当成另一篇 Week 笔记。

创建新 Study 资料库：

1. 选择 **Create a new library**；
2. 选择 **Study notes**；
3. 选择保存位置并填写资料库名称；
4. 点击 **创建并打开**，再点 **＋ 创建 Week 模板**；
5. 填写 Semester，例如 `2026-semester-2`；
6. 填写 Unit，例如 `UNIT1001`；
7. 选择 Week 数字 `1`；
8. 确认预览路径为
   `content/2026-semester-2/UNIT1001/week-01/week-01-notes.md`；
9. 点击 **创建主笔记**，用编辑器写入笔记并保存；
10. 点击 **打开阅读器**。

完成后的结构：

```text
My Study Notes/                         # 应用中选择这一层
├── content/
│   └── 2026-semester-2/
│       ├── UNIT1002/
│       │   ├── week-01/
│       │   │   └── week-01-notes.md
│       │   └── week-02/
│       │       └── week-02-notes.md
│       └── UNIT1001/
│           └── week-01/
│               └── week-01-notes.md
└── inbox/
```

在应用中选择 `My Study Notes`，不要选择里面的 `content`、Semester、Unit 或
Week 文件夹。

### 为什么使用 `week-01-notes.md`

```text
week-01/
├── week-01-notes.md          # 系统识别的唯一主笔记
├── draft.md                  # 不进入 Week 导航
├── prompt-context.md         # 不进入 Week 导航
└── README.md                 # 不进入 Week 导航
```

统一使用小写英文、连字符和两位数字：

| Week | 文件夹 | 主笔记文件 |
|---|---|---|
| Week 1 | `week-01` | `week-01-notes.md` |
| Week 2 | `week-02` | `week-02-notes.md` |
| Week 10 | `week-10` | `week-10-notes.md` |

合并 Week 1 到 Week 3 时使用：

```text
weeks-01-03/weeks-01-03-notes.md
```

## 迁移旧版学习笔记

旧网页逻辑上显示 Semester → Unit → Week，但文件通常是：

```text
notes/unit1002/week-1.md
```

新 Study 资料库显式保存完整层级：

```text
content/2026-semester-2/UNIT1002/week-01/week-01-notes.md
```

第一次迁移请复制旧文件，给复制品建立标准位置和名称，确认新网页显示正确后再
决定是否保留旧副本。

如果旧笔记引用 `assets/week6/chart.png`，新文件增加了 Week 目录，图片的相对
位置也要一起保留。例如：

```text
week-06/
├── week-06-notes.md
└── assets/
    └── week6/
        └── chart.png
```

Note Portal 不会修改源文件或图片链接。

## Inbox 与草稿

Study 中暂时不知道属于哪个 Week 的笔记可以放进 `inbox/`，它们显示在单独的
Inbox 区域。General 中不需要 Inbox；如果不想让一篇文档进入普通导航，可以在
frontmatter 中设置 `draft: true`，或把它放到隐藏目录。

## 图片

推荐在文档旁建立 `_assets`：

```text
topic/
├── notes.md
└── _assets/
    └── diagram.png
```

Markdown 中使用相对路径：

```markdown
![Diagram](_assets/diagram.png)
```

`_assets` 不会显示成导航栏目。

## 让外部工具更新笔记

把完整目标路径告诉编辑器或自动化工具。例如 Study 笔记：

```text
请只更新这篇文件：
My Study Notes/content/2026-semester-2/UNIT1001/week-03/week-03-notes.md
```

保存后 Note Portal 会自动刷新。它不提供 AI 服务，也不会主动上传笔记。

## 常见问题

### 网页中没有出现文档

先确认选择的资料库类型。General 会递归识别普通 `.md`；Study 还要求完整的
Semester、Unit、Week 层级和匹配文件名。然后点击 **Refresh now** 查看诊断给
出的具体路径和建议。

### 放错位置会不会丢文件

不会。扫描、显示、搜索和诊断不会移动、重命名、覆盖或删除文档。创建模板时
如果目标已存在，应用也会停止。

### 文件夹必须使用英文吗

General 文件夹、Study 的 Semester 和 Unit 都可以使用中文。Study 的 Week 与
主笔记保持标准英文格式，以保证 macOS、Windows 和外部工具得到相同结果。

### 提示“本机设置需要恢复”怎么办

这表示应用自己的设置文件无法读取，不代表你的笔记损坏。先点击 **恢复上一份设置**；
如果没有可用备份，点击 **备份后重置设置**，阅读确认内容后再继续。应用会保留损坏
设置的副本供以后检查，并重新进行首次设置；资料库中的笔记不会被删除或改写。
已选择的 Logo 如果丢失或损坏，应用会改用文字标识，你可在 **设置与条款** 中重新选择
或清除 Logo。

## 进阶说明

需要自定义标题、排序、稳定 ID 或安全写入方式时，再阅读
[资料库结构规范](LIBRARY_STRUCTURE.md)。
