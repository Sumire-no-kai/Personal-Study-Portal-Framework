# Note Portal 资料库结构规范

**规范版本：** 2.0

Note Portal 支持两种资料库：**General** 用于普通 Markdown 文件夹，**Study**
用于按 Semester、Unit 和 Week 整理的学习笔记。用户在添加资料库时明确选择类型，
应用不会根据文件名偷偷猜测。

如果你只想开始使用，请先阅读
[零基础开始指南](GETTING_STARTED.zh-CN.md)。Frontmatter、`_index.md` 和稳定 ID
全部属于可选功能。

## 1. 两种资料库

| 类型 | 适合内容 | 识别方式 |
|---|---|---|
| General | 个人笔记、项目文档、工作记录、读书摘录 | 递归识别所选文件夹中的普通 `.md` |
| Study | 课程与每周学习笔记 | 严格识别 Semester → Unit → Week → 主笔记 |

两种类型共用同一个阅读器、搜索、刷新服务和安全规则。类型只改变文件发现方式、
导航标签和可用模板。

资料库类型保存在本机应用设置中。对现有文件夹，Note Portal 不会为了记录类型而
写入配置文件。切换类型必须先显示重新扫描预览。

## 2. General 资料库

用户选择的文件夹本身就是资料库根目录。普通文件夹成为导航层级，符合规则的
`.md` 文件成为文档：

```text
My Notes/                       # 应用中选择这一层
├── ideas.md
├── projects/
│   ├── roadmap.md
│   └── meeting-notes.md
├── reading/
│   ├── _index.md               # 可选的文件夹说明
│   ├── book-a.md
│   └── _assets/
│       └── cover.jpg
└── archive/
    └── 2025-summary.md
```

General 模式不要求特殊后缀，也不使用 Semester、Unit 或 Week 术语。以下文件都
可以成为普通文档：

```text
ideas.md
projects/roadmap.md
会议记录/九月会议.md
```

`draft: true` 的文档不进入普通导航和搜索。用户也可以把不希望扫描的内容放入
隐藏目录或本规范列出的忽略目录。

## 3. Study 资料库

Study 模式的资料库根目录包含 `content/` 和可选的 `inbox/`：

```text
My Study Notes/                          # 应用中选择这一层
├── content/
│   └── 2026-semester-2/                 # Semester
│       ├── _index.md                    # 可选的学期说明
│       └── COMP5318/                    # Unit
│           ├── _index.md                # 可选的 Unit 说明
│           ├── week-01/                 # Week
│           │   ├── week-01-notes.md     # 本周唯一主笔记
│           │   └── _assets/
│           │       └── diagram.png
│           └── weeks-02-03/             # 可选的连续多周笔记
│               └── weeks-02-03-notes.md
└── inbox/
    └── captured-note.md
```

普通每周笔记的正式路径：

```text
content/<semester>/<unit>/week-<NN>/week-<NN>-notes.md
```

合并连续多周的正式路径：

```text
content/<semester>/<unit>/weeks-<NN>-<NN>/weeks-<NN>-<NN>-notes.md
```

`NN` 是补零后的两位正整数，例如 `01`、`02`、`12`。目录中的 Week 标识必须
与主笔记文件名完全一致。

### 3.1 Week 命名

有效名称：

```text
week-01/week-01-notes.md
week-10/week-10-notes.md
weeks-01-03/weeks-01-03-notes.md
```

以下文件不会成为 Study 主笔记：

```text
week1/week1-note.md
week-01/notes.md
week-01/week-02-notes.md
week-01/lecture.md
week-01/week-01-notes-copy.md
```

应用在诊断中显示实际路径和建议名称，但不会自动重命名、移动、覆盖或删除文件。

### 3.2 每个 Week 只有一篇主笔记

```text
week-01/
├── week-01-notes.md          # 识别：主笔记
├── draft.md                  # 排除并提示
├── prompt-context.md         # 排除并提示
├── README.md                 # 排除并提示
└── week-01-notes.md.bak      # 忽略：备份文件
```

首版不会扫描同一 Week 中的所有 Markdown 后猜测主笔记。如果以后需要一个 Week
展示多篇文档，应通过新版规范明确设计。

### 3.3 Inbox

`inbox/` 中的普通 Markdown 显示在单独的 Inbox 区域，可以包含子目录。Inbox
不会被解释为 Semester、Unit 或 Week，也不会被自动分类或移动。

## 4. 共同忽略规则

两种资料库都遵循以下规则：

- 以 `.` 开头的文件与目录默认忽略；
- `.git/`、`.obsidian/` 和 `node_modules/` 默认忽略；
- `_assets/` 中的文件不成为导航项目；
- 除允许位置的 `_index.md` 外，以下划线开头的 Markdown 保留并忽略；
- `.tmp`、`.part`、`.swp` 和 `.bak` 等临时、未完成或备份文件忽略；
- 指向资料库外部的符号链接拒绝读取；
- 无效 UTF-8、无法稳定读取或违反跨平台路径规则的文件进入诊断。

General 资料库中的普通 `README.md` 可以成为文档。Study 的 Week 中只有匹配的
`*-notes.md` 是主笔记，因此 `README.md` 会被排除并提示。

## 5. `_index.md`

General 的任意普通目录可以使用 `_index.md` 设置文件夹标题和顺序。Study 只在
Semester 与 Unit 目录中使用 `_index.md`；Week 的标题和元数据属于其主笔记。

```yaml
---
title: Machine Learning Notes
order: 20
---

# Machine Learning Notes
```

`_index.md` 是文件夹元数据，不作为普通文档显示。

## 6. 标题、顺序与 Frontmatter

文档标题优先级：

1. YAML frontmatter 的 `title`；
2. 第一个一级标题 `# Title`；
3. 清理扩展名后的文件名；
4. Study 主笔记没有标题时，根据 Week 目录生成 `Week 1` 或 `Weeks 1–3`。

Frontmatter 完全可选。首版识别：

```yaml
---
id: stable-document-id
title: Display title
order: 20
tags:
  - example
draft: false
---
```

| 字段 | 类型 | 作用 |
|---|---|---|
| `id` | 字符串 | 整个资料库内唯一的稳定文档 ID |
| `title` | 字符串 | 网页显示标题 |
| `order` | 整数 | General 文件夹或 Study Semester/Unit 的同级排序 |
| `tags` | 字符串列表 | 搜索和筛选标签 |
| `draft` | 布尔值 | 为 `true` 时不进入普通导航和搜索 |

Frontmatter 不能改变文件层级、访问资料库外部路径，或让错误命名的 Study 文件
成为主笔记。未知字段保留在源文件中，但首版忽略。

没有显式 `id` 时，系统使用资料库类型和相对路径生成稳定 ID。重命名事件可以在
同一文件事件批次中通过内容哈希保持连续性；无法确定时创建新 ID。

## 7. 附件

推荐把附件放在文档附近的 `_assets/`：

```text
topic/
├── notes.md
└── _assets/
    └── diagram.png
```

Markdown 使用相对路径引用：

```markdown
![Diagram](_assets/diagram.png)
```

首版支持 `.gif`、`.jpeg`、`.jpg`、`.png`、`.svg` 和 `.webp`。安全的相对引用
也可以使用已有的 `assets/` 目录。服务端提供附件前必须确认解析后的路径仍在
资料库内。

为避免误选超大文件时占满内存，单个 Markdown 文件最多 8 MiB，单个图片最多
32 MiB，一次扫描读取的 Markdown 总量最多 64 MiB。超出时会提示错误，不会修改
原文件；请拆分资料库或缩小文件后重试。

旧 Study 笔记增加 Week 目录后会比以前深一层。迁移时必须保持图片与笔记的相对
关系，或者同时修改复制品中的链接。例如旧链接为 `assets/week6/chart.png` 时，
可以把相关 `assets/week6/` 一起复制到新的 `week-06/` 内。

## 8. macOS 与 Windows 兼容

- Markdown 和 frontmatter 使用 UTF-8；
- 名称在忽略大小写后仍必须唯一；
- 名称不能包含 `< > : " / \\ | ? *`；
- 名称不能以空格或英文句号结尾；
- 不得使用 `CON`、`PRN`、`AUX`、`NUL`、`COM1`–`COM9`、
  `LPT1`–`LPT9` 等 Windows 保留设备名；
- 中文及其他 Unicode 名称可以使用。

这些约束保证同一资料库在默认 macOS 和 Windows 文件系统上生成相同结果。

## 9. 外部工具写入

外部工具只需写入所选资料库。General 可以使用用户自己的目录：

```text
projects/roadmap.md
```

Study 应使用完整标准路径：

```text
content/2026-semester-2/COMP5318/week-03/week-03-notes.md
```

推荐先写临时文件，关闭后再原子重命名为最终 `.md`。修改现有文件时保留显式
frontmatter `id`。Note Portal 忽略临时文件，并在最终文档稳定后刷新。

## 10. 错误与诊断

诊断必须说明“发生了什么、相对路径、如何处理”，不能显示原始堆栈或静默修改
文件。常见情况包括：

- Study 路径缺少 Semester、Unit 或 Week；
- Study Week 目录与主笔记文件名不一致；
- Study Week 中出现其他 Markdown；
- frontmatter 语法错误或显式 `id` 重复；
- 仅大小写不同的冲突路径；
- Windows 不兼容名称；
- 附件或符号链接逃逸出资料库；
- 文件在读取期间处于不完整状态。

例如：

```text
未识别：content/2026-semester-2/COMP5318/week-01/summary.md
原因：Study 模式下，Week 1 主笔记必须与文件夹名称匹配。
建议名称：week-01-notes.md
```

新的资料库快照只有在验证通过后才替换当前快照。单个文档问题不应使其他有效
文档消失；结构或全局 ID 冲突导致快照不安全时，继续提供上一个有效版本。

## 11. 模板与只读边界

仓库中的 General 与 Study 示例是生产解析器的契约测试模板。macOS 和 Windows
必须生成相同导航、ID、顺序和附件路径。

用户明确点击 **Create note** 或 **Create Week template** 后，应用可以创建预览中
显示的新目录和文件。任何目标已经存在时必须停止。除此以外，扫描、显示、索引、
刷新和诊断全部只读，应用不得自动移动、重命名、覆盖或删除源文件。
