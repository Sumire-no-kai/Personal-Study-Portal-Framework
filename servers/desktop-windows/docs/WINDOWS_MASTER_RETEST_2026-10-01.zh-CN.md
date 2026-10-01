# Windows x64 / ARM64 本轮测试任务（2026-10-01）

本轮验证最近合入的图片路径、阅读器双语、本地诊断和日志故障容错，补齐
Windows 1.0 的真机与性能证据。总跟踪位置是
[#57](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/issues/57)；
性能与冷启动分别关联 #67、#69。**这是测试计划，不是通过报告，也不是正式版发布。**

## 1. 固定测试对象：不要只看版本号

只测下面这一次成功的 **master 构建**，不要用 Releases 中的旧 beta，也不要
在测试中途换成其他 Actions 包。它包含 #70、#71、#79、#80 的实现及补充修复。

- [Windows CI run 36813069837](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/actions/runs/36813069837)
- 源码提交：`60625afbd4e86c579bfe110d0a02f682113755d1`
- “关于”仍应显示：`0.2.0-beta.1 · Windows`。同一个版本号不代表同一个二进制。
- 安装包仍未签名；不是 1.0，不做签名验收。

| 设备 | 下载并解压的 artifact | 解压后的安装包 |
| --- | --- | --- |
| Intel / AMD Windows x64 | [note-portal-windows-x64-installer](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/actions/runs/36813069837/artifacts/11139833989) | `Note Portal_0.2.0-beta.1_x64-setup.exe` |
| Windows on ARM | [note-portal-windows-arm64-installer](https://github.com/Sumire-no-kai/Personal-Study-Portal-Framework/actions/runs/36813069837/artifacts/11139764638) | `Note Portal_0.2.0-beta.1_arm64-setup.exe` |

下面是**解压后的 EXE** 的 SHA-256，不是 artifact ZIP 的摘要：

```text
x64:   cf3ed44c900604c0e8c77208d7d3fa7272a86e04005f46c5fff842afab7ae59e
ARM64: f90546b536649338ce22575abc1358bbdb896267d2f32999854149f359403dcf
```

用 `Get-FileHash -Algorithm SHA256 '<实际安装包路径>'` 核对。不一致就停止安装。
Actions 下载通常需要登录 GitHub，产物保留 14 天；无法下载或已过期时请反馈，
不要悄悄改测另一份包。文档后续提交触发的 CI 不改变本轮固定对象。

## 2. 两台设备的分工与执行边界

| 项目 | x64 | ARM64 |
| --- | --- | --- |
| V：安装来源、版本、主体架构 | 必测 | 必测，确认原生 ARM64 |
| R1–R7：图片、双语、诊断、容错、刷新、无障碍、安全 | 必测 | 必测 |
| P1–P4：小库/大库内存、启动、刷新 | 必测 | 必测，独立记录数字 |
| H1：新 Windows 用户的首次使用、卸载 | 推荐补测；未做则明确标记 | 必测，补齐剩余干净用户证据 |
| H2：断网阅读与搜索 | 必测，人工操作 | 必测，人工操作 |
| H3：重启后第一次启动 | 必测，人工操作 | 必测，人工操作 |

执行顺序：V → 准备副本 → R1–R3/R5–R7 → P → H2/H3 → 新测试用户中的 H1/R4。
H1 安装后、首次启动前先布置 R4 的日志冲突，两项合并观察；恢复正常日志后再卸载。
预计需要 45–90 分钟；内存采样至少 10 分钟，另需等待人工重启、切换用户。

给执行者的约束：

- **只做测试和脱敏记录，不改产品源码、不修 bug、不发新 Release。**
- 由用户在普通 Windows 桌面的**资源管理器双击安装器**，从开始菜单/桌面
  快捷方式启动。不要从远程工具的命令执行子进程安装或启动后，把隔离环境
  的结果当成普通桌面结果。
- 测试脚本需要启动应用时，也由用户在普通桌面 PowerShell 执行。若做不到，
  写明“隔离环境测量/未完成正常桌面验证”，不能填通过。
- 升级原有安装须先征得用户同意；保留原设置，不删除 AppData 来制造首启。
  不修改注册表、系统语言、防护设置、网络规则或其他程序。
- 重启、注销、断网、新建测试用户、卸载前由用户确认并保存工作。远程连接
  会中断的步骤必须交给用户；不能用“预计正常”代替实际观察。
- 使用独立的虚构副本。不要选择真实笔记、同步盘、当前生产部署或仓库原件。
- 公开记录不含真实正文、用户名、计算机名、IP、私人绝对路径、设置全文、
  Cookie 或带会话令牌的阅读页地址。只分享相对路径、计时和脱敏错误。

## 3. V：安装及准备资料

1. 记录系统版本/Build、OS 架构、CPU、RAM、默认浏览器及 WebView2 版本，
   原 Note Portal 版本、是否覆盖安装、下载 run/提交/EXE 校验值。
2. 在原应用点“退出”，确认进程结束；在资源管理器安装对应包，再用快捷方式
   打开。记录 SmartScreen/UAC/杀毒提示，不关闭防护、不自动绕过拦截。
3. “关于”版本匹配；检查安装后 `note-portal-desktop.exe` 的 PE Machine：
   x64 为 `0x8664`，ARM64 为 `0xAA64`。可使用现有检查工具；下面是只读检查：

   ```powershell
   $qaExe = Join-Path $env:LOCALAPPDATA 'Note Portal\note-portal-desktop.exe'
   if (-not (Test-Path -LiteralPath $qaExe -PathType Leaf)) { throw '请按快捷方式找到实际 EXE，并修改 $qaExe' }
   $qaStream = [IO.File]::OpenRead($qaExe)
   $qaReader = [IO.BinaryReader]::new($qaStream)
   try {
     if ($qaReader.ReadUInt16() -ne 0x5A4D) { throw '不是 MZ 可执行文件' }
     $qaStream.Position = 0x3C
     $qaPeOffset = $qaReader.ReadInt32()
     if ($qaPeOffset -lt 0 -or $qaPeOffset -gt $qaStream.Length - 6) { throw '无效 PE 位置' }
     $qaStream.Position = $qaPeOffset
     if ($qaReader.ReadUInt32() -ne 0x00004550) { throw '不是 PE 可执行文件' }
     'Application Machine: 0x{0:X4}' -f $qaReader.ReadUInt16()
   } finally { $qaReader.Dispose() }
   ```

   ARM64 的 NSIS 安装器外壳可能为 x86；**以安装后的应用主体为准**。
4. 新建一个名称唯一的 `NotePortalQA-日期-随机标识` 文件夹，复制仓库的
   `examples/general-library-template/` 和 `examples/study-library-template/`
   为 `general`、`study`。记录全部副本文件的相对路径、大小、SHA-256 基线。
   基线清单放在资料库外；不要公开真实笔记的哈希或路径。
5. 选择 General 的 `general/`、Study 的 `study/`。
   **Study 选择包含 `content/` 的最外层，不选择 `content/` 本身。**

## 4. R：两种架构都执行的功能回归

### R1：以 `/` 开头的图片（#79 / #66）

只编辑副本：将示例 `example-diagram.svg` 复制到 Study 的
`content/assets/root-diagram.svg`，在有效的
`content/2026-semester-2/DEMO101/week-01/week-01-notes.md` 中追加：

```markdown
![Root asset](/assets/root-diagram.svg)
```

- 选择 Study 后，原 `_assets/example-diagram.svg` 相对图片和新图都**目视显示**；
  DevTools Network 的新图路径为 `/library/content/assets/root-diagram.svg`
  （可带版本查询参数），不再请求错误的 `/assets/...`。
- General 副本中另建 `assets/root-diagram.svg` 和普通 `image-check.md`，使用
  同一 Markdown 引用。图片显示，路径为 `/library/assets/root-diagram.svg`。
- 在正在阅读的副本里用另一张有效 SVG 覆盖同名图片，确认自动显示新内容。
- 测试笔记再引用 `/assets/missing.svg`：缺图可以失败，但正文、导航和搜索
  仍可用，不崩溃。不要把缺失文件当作有效图片显示失败。
- 比较文件基线；除了测试者明确复制/编辑的副本，应用不得修改任何原件。

### R2：阅读器双语（#71）

准备一篇标题为“设置”、正文包含“关闭设置”、中文标题、表格、公式的虚构笔记。

1. 小窗口设置切到 English，打开/刷新阅读器；阅读器设置选 **Follow app**。
   导航、设置、按钮、搜索空结果、断线提示、表格辅助标签应为英文。
   原笔记标题、正文、目录标题、文件夹名仍是原来的中文。
2. 阅读器独立选中文，刷新后仍中文。把小窗口切回英文并刷新阅读器，浏览器
   的中文覆盖仍生效；再选“跟随应用”，刷新后回到英文。
3. 关闭再打开小窗口，手动语言保持；在**同一浏览器、同一端口**重新打开
   阅读器，独立语言选择保持。端口变化会换浏览器存储空间，不算持久化缺陷。
4. 切回中文重复关键界面检查。中文/英文各测空库、无匹配搜索；停止再启动
   服务后，先不要点“打开阅读器”，直接刷新旧标签。同一端口应按控制窗口
   语言显示“阅读会话已结束”，不暴露正文。若服务换端口，旧标签连接失败
   属另一场景，需单独记录，不能当作过期提示翻译已通过。
5. 在长文中滚动后切语言，仍打开原文，不回首页；记录位置是否明显丢失。
   记录缺失翻译、混杂语言、按钮截断或控制台异常；不要发布控制台中的私有 URL。

### R3：正常日志与复制诊断（#70）

1. 小窗口“设置与条款 → 打开日志文件夹”实际打开资源管理器，目录包含
   `note-portal.log`。Windows 默认位置是
   `%LOCALAPPDATA%\io.github.sumirenokai.noteportal\logs`，不是保存设置的 Roaming 目录。
2. 正常选择资料库、刷新、停止/启动服务后，日志包含固定事件名、计数或耗时，
   如 `scan.complete`、`listener.bound`。`app.start` 是后台写入，不必是第一行。
3. “复制诊断信息”后，在本地文本编辑器粘贴，确认有应用版本、系统、架构和
   本次运行最近错误；无错误时 `None recorded` 属正常。别只看成功提示。
4. 虚构笔记中写入唯一正文标记 `QA_PRIVATE_BODY_SENTINEL_20261001`，阅读并搜索。
   检查日志与复制内容：不得包含此正文、资料库绝对路径或会话令牌。
5. 若自然发生轮转，只有活动日志和 `note-portal.1.log` 至 `.3.log`，各不超过
   1 MiB。不人为灌入日志、冒充发生过轮转；未触发则标“未触发，CI 已有覆盖”。

### R4：日志无法初始化仍可用（#80；隔离测试用户中做）

**不得在日常用户下破坏已有日志、权限或设置。**在 H1 的新测试用户下做：

1. 安装后、首次启动前，确认下面目标不存在（文件或目录都不能存在）。
   已存在则停下，换新的测试用户，不能覆盖或删除它。
2. 在该测试用户创建一个**目录**而不是文件：
   `%LOCALAPPDATA%\io.github.sumirenokai.noteportal\logs\note-portal.log`。
   只制造这个可逆冲突，不更改 ACL 或系统权限。
3. 快捷方式启动应用：仍能读完整告知、完成引导、选择虚构库、阅读、搜索、
   自动刷新，不因日志错误退出。
4. “复制诊断信息”粘贴后包含 `diagnostics.init_failed`。这一轮没有正常文件
   日志是预期，不能因此把整个应用判失败；记录打开日志文件夹的实际表现。
5. 点“退出”，确认应用停止；确认冲突目录仍为空且确为本步骤所建，**仅删除
   这个空目录**，不递归清理上级。再启动，正常日志恢复，其余功能仍正常。

没有新用户权限/用户未批准时写“未测：需要隔离用户”，不得据代码推断通过。

### R5：刷新与单文件故障恢复

- 在 General 副本创建 `Node.js 笔记/intro.md`，然后在资源管理器改目录名、
  删除到回收站：导航自动跟随；手动点刷新后才更新不能算通过。
- 两篇有效 frontmatter 笔记先分别打开。保存时删掉第一篇结束的 `---`，同时
  修改第二篇：第一篇保留旧正文并有诊断，第二篇正常自动更新。
  恢复第一篇 delimiter 后正文与诊断自动恢复。中英界面各检查一次诊断。
- 当前笔记由外部工具保存后正文、目录、搜索自动更新；临时 `.tmp` 改成
  `.md` 后才进入导航。记录功能观察；精确耗时另在 P4 测，不能凭轮询猜毫秒。
- 关闭小窗口仍后台运行；托盘可重开小窗口/阅读器；“停止服务”后阅读器断线；
  “退出”后进程及监听结束；再次启动应用不产生第二实例。

### R6：键盘与缩放

Tab/Shift+Tab/Enter/Esc 操作指南、设置、语言选择、创建笔记成功后的继续按钮；
焦点可见，不跳到不可操作位置。用户批准后检查 150% 缩放，记录按钮截断，
恢复原缩放。讲述人测试可选；没用耳朵核查不能写“无障碍全部通过”。

### R7：安全与只读抽查

- 监听仅限 loopback；全新无会话的隐私窗口直接访问根地址，不可读取笔记。
  不把含令牌的启动地址复制到隐私窗口或公开记录。
- 按 #57 D1/D2 做路径逃逸、意外来源访问抽查；只记录状态码/阻止结果。
  浏览器策略导致请求根本未发出时，标明只证明浏览器拦截，不声称服务端已测。
- C5 符号链接检查仅在已有权限时做；不为测试开启开发者模式或提权。可选的
  raw-script 用虚构内容，确认不执行，不向公开报告贴真实文档。
- 除本轮主动编辑/创建的文件外，副本基线 SHA-256 应一致。任何应用主动改写
  源文件、泄露库外文件或绕过首次同意，立即停止该项，保留证据并报告。

## 5. P：性能，两台设备各自测量

均用安装后的 release 构建、普通桌面，浏览器资源**单独记录，不计入应用**。
先测小 General 示例库，再测相同形状的大库。不据 macOS 数字推断 Windows
瓶颈，不把防病毒软件当作已证实原因，也不关闭它来争取通过。

### P1：生成独立大库

以下是批量生成虚构压力数据，不是修改仓库。普通桌面 PowerShell 运行一次；
路径随机且拒绝复用，生成约 48 MiB Markdown + 200 MiB 附件，低于 64 MiB
Markdown 上限。200 个 `.png` 是**扫描负载用的随机字节**，不用于图片渲染验收。
图片显示只用 R1 的有效 SVG。

```powershell
$qaLarge = Join-Path ([IO.Path]::GetTempPath()) ('NotePortalQA-Large-' + [Guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $qaLarge) { throw '目标已存在，停止；不要覆盖' }
[void][IO.Directory]::CreateDirectory($qaLarge)
$qaUtf8 = [Text.UTF8Encoding]::new($false)
$qaBody = (('Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' * 4) + "`n") * 110
foreach ($i in 1..2000) {
  $qaFolder = Join-Path $qaLarge ('folder-{0:D2}' -f ($i % 40))
  [void][IO.Directory]::CreateDirectory($qaFolder)
  [IO.File]::WriteAllText((Join-Path $qaFolder ('doc-{0:D4}.md' -f $i)), "# Document $i`n`n$qaBody", $qaUtf8)
}
foreach ($i in 1..200) {
  $qaBytes = [byte[]]::new(1MB)
  [Random]::new($i).NextBytes($qaBytes)
  [IO.File]::WriteAllBytes((Join-Path $qaLarge ('folder-{0:D2}\image-{1:D3}.png' -f ($i % 40), $i)), $qaBytes)
}
$qaMd = @(Get-ChildItem -LiteralPath $qaLarge -Recurse -File -Filter '*.md')
$qaAll = @(Get-ChildItem -LiteralPath $qaLarge -Recurse -File)
'{0} notes, Markdown {1:N1} MiB; {2} files, total {3:N1} MiB' -f $qaMd.Count, (($qaMd | Measure-Object Length -Sum).Sum / 1MB), $qaAll.Count, (($qaAll | Measure-Object Length -Sum).Sum / 1MB)
if ($qaMd.Count -ne 2000 -or ($qaMd | Measure-Object Length -Sum).Sum -ge 64MB) { throw '负载不符合要求，停止测试' }
$qaLarge # 仅供本机选目录；不要公开这个绝对路径
```

用“更换资料库 → General”选择该文件夹，记录预览耗时、确认到 Running 的耗时，
应识别 2,000 篇。二者分别记录，不能把预览和启动重复扫描混在一起。

### P2：小库和大库，各采样五分钟

打开阅读器一次，关闭小窗口（×），等一分钟。沿用 #57 **F1 的完整采样脚本**，
统计 Note Portal 与其 WebView2 后代，不包含其他应用的 WebView2 或浏览器。
每个库都采五分钟；记录平均/峰值工作集、私有内存、进程数、单核及总核 CPU。
不要把第一次 `Get-CimInstance` 查询耗时混入启动计时。

PRD 预算：应用合计工作集不超过 100 MiB，平均 CPU 低于 1%。若超过，如实填
“超预算”，不自行修改 PRD、不把旧 129 MiB 数字当新结果。应用重启、崩溃或
进程变化使 CPU 累计差不可靠时，这次采样无效并说明原因。

### P3：暖启动三次及扫描分解

每个库先正常启动过一次并选好，退出后检查 saved port 没有被占用。用户在普通
桌面 PowerShell 用下面的直接 TCP 探针启动；不要用冷的 `Get-NetTCPConnection`
测启动，也不要从远程执行宿主直接启动应用。

```powershell
$qaExe = Join-Path $env:LOCALAPPDATA 'Note Portal\note-portal-desktop.exe'
if (-not (Test-Path -LiteralPath $qaExe -PathType Leaf)) { throw '请按快捷方式找到实际 EXE，并修改 $qaExe' }
if (Get-Process -Name note-portal-desktop -ErrorAction SilentlyContinue) { throw '请先在应用中点退出' }
$qaSettings = Join-Path $env:APPDATA 'io.github.sumirenokai.noteportal\settings.json'
$qaPort = [int](Get-Content -LiteralPath $qaSettings -Raw | ConvertFrom-Json).preferredPort
if ($qaPort -lt 1 -or $qaPort -gt 65535) { throw '没有有效保存端口；先正常启动一次并退出' }
function Test-QALocalPort([int]$Port) {
  $qaClient = [Net.Sockets.TcpClient]::new()
  try { return $qaClient.ConnectAsync([Net.IPAddress]::Loopback, $Port).Wait(30) -and $qaClient.Connected }
  catch [AggregateException] {
    if ($_.Exception.InnerException -is [Net.Sockets.SocketException]) { return $false }
    throw
  }
  catch [Net.Sockets.SocketException] { return $false }
  finally { $qaClient.Dispose() }
}
if (Test-QALocalPort $qaPort) { throw '保存端口已占用，不是有效启动测量' }
$qaClock = [Diagnostics.Stopwatch]::StartNew()
Start-Process -FilePath $qaExe
$qaConnected = $false
while ($qaClock.Elapsed.TotalSeconds -lt 60) {
  if (Test-QALocalPort $qaPort) { $qaConnected = $true; break }
  Start-Sleep -Milliseconds 10
}
if (-not $qaConnected) { throw '60 秒内未连接保存端口；记录实际状态/是否换端口，不填有效耗时' }
'TCP ready: {0:N0} ms' -f $qaClock.Elapsed.TotalMilliseconds
```

小库、大库分别三次，每次正常退出再测。另记录小窗口出现、托盘可用、正文可读
的人工观察时间；TCP 可连接不等于所有指标都达标。PRD 的暖启动目标是托盘
就绪两秒，TCP 探针只是可复核的补充数据，不偷换验收指标。

每次从本次启动对应的日志复制 `scan.complete`、`listener.bound`、
`service.started` 行，并记录其关联库/顺序。`scan.complete elapsed_ms` 是本轮
扫描经过的时间，`listener.bound elapsed_ms` 从扫描启动点累计；二者不是
“双击到启动”的全部耗时。不要拿历史运行/预览的数据混配。

### P4：大库单次保存到更新，三次

打开 `folder-01/doc-0001.md`，F12 控制台建立额外的只读 SSE 探针：

```javascript
const qaRefreshProbe = new EventSource('/api/portal-events');
qaRefreshProbe.addEventListener('release', () => console.log('QA release', new Date().toISOString()));
```

忽略连接时第一次 release。外部编辑器/脚本在**副本**追加唯一的虚构行，记录
保存完成 UTC 时间；用下一次 release UTC 减去它，并目视确认新增行出现。
每次间隔至少十秒，重复三次。记录网络事件延迟和正文观察，前者不冒充精确
DOM 渲染耗时。目标单文件更新一秒内；不能精确计时则写明观察精度。
结束在控制台执行 `qaRefreshProbe.close()`；不改程序轮询频率或防护设置。

## 6. H：需要用户在电脑前操作

### H1：新用户、首次告知和卸载（ARM 必测）

用户批准后新建本地测试用户并登录，由资源管理器安装上述同一包，先按 R4
布置日志冲突，再首次启动，将两项合并观察。按 #57
A1–A5 的步骤执行，**把旧版本指定替换为本轮 run/哈希**：

- 首次未同意前没有资料库服务或登录启动；拒绝/关闭后没有残留监听。
- 必须打开已渲染的完整告知并滚到底才能勾选；引导不能跳过。
- 全程用界面创建空 General 与第一篇笔记、空 Study 与 Week 模板，重复路径
  不能覆盖。Settings 能重看告知，键盘焦点和双语正常。
- 安装目录仅程序相关文件，payload 不超过 30 MiB，无笔记/密钥/索引。
- 完成 R4 后卸载，快捷方式、程序文件、登录启动项按预期消失，测试笔记
  哈希不变。只记录 AppData 保留情况；不额外删除其他用户的数据。

新本地用户不等于整台全新 Windows：已有机器级 WebView2、杀毒与系统组件仍
存在，必须写清这个边界，不能声称“全新系统安装通过”。

### H2：离线使用（#57 G8）

先确认 WebView2 已安装、Guide/模板本地可用。用户保存工作后断开整机网络，
**退出再启动应用**，从按钮打开阅读器，验证正文、图片、公式、全文搜索和
外部保存后的自动刷新。记录联网/离线两种状态，恢复网络。无法现场断网时
只写未测，不用网络请求拦截代替整机离线。首次安装下载 WebView2 是另一个场景。

### H3：重启后的第一次启动（#69）

用户先保存工作，记下 Note Portal 原登录启动设置。经批准暂时关闭它，确保
重启后不会先启动应用；选好小示例库并正常退出。核对 EXE/安装包在重启前做。

用户重启、登录、等待约一分钟，**不先启动应用、不先读取或计算 EXE 哈希**。
普通桌面 PowerShell 执行 P3 探针一次，记录 TCP 时间、小窗口出现的大致时间
和本次扫描日志。这是未签名构建的冷启动证据，不能代替签名后的复测。
恢复原登录启动设置。应用若自动先启动或被测试工具预启动，冷启动测量作废。

## 7. 报告与收尾

每台设备单独提交结果，不共享另一台的“通过”。优先脱敏评论到 #57；失败项
可关联 #67/#69 或已合并修复，但不要自动重开/关闭 issue，也不直接修代码。
报告过长可保存 Markdown 再贴链接；若要进仓库，另走窄范围文档 PR。

```markdown
测试机：x64 / ARM64；Windows 版本与 Build：…；CPU / RAM：…
构建：run 36813069837；提交：60625afbd4e86c579bfe110d0a02f682113755d1
关于版本：…；安装包文件名与 SHA-256：…；应用主体 PE：…
安装/启动来源：普通资源管理器/快捷方式，或明确写隔离环境
覆盖安装/新用户：…；浏览器 / WebView2：…；本轮边界：…

| 项目 | 通过 / 失败 / 未测 / 部分完成 | 实际步骤、证据与限制 |
| --- | --- | --- |
| V | | |
| R1 图片 | | |
| R2 双语及原文不变 | | |
| R3 诊断与隐私 | | |
| R4 日志失败容错及恢复 | | |
| R5 刷新与生命周期 | | |
| R6 键盘/缩放 | | |
| R7 安全/只读 | | |
| P1 大库识别 | | |
| P2 小库/大库五分钟资源 | | |
| P3 小库/大库各三次暖启动 | | |
| P4 大库三次保存更新 | | |
| H1 干净用户安装/卸载 | | |
| H2 离线 | | |
| H3 冷启动 | | |

性能原始数字：分别写小库/大库、三次启动/刷新，日志对应行，工作集和 CPU。
失败：复现步骤、预期/实际、是否稳定、脱敏截图/错误。不填写猜测的根因。
清理：列出本轮创建/下载的目标、实际处理方式及最终应用/登录启动状态。
```

用户确认后，只清理本轮登记的安装包下载、虚构库和临时探针。先退出应用/切换
到非待删库，确认目标路径及文件清单、没有进程占用；目录不明就停下。
优先资源管理器移到回收站，**不要清空系统 TEMP、其他 `.tmp*`、缓存或整片
AppData**。日常安装与用户原有设置不自动卸载/删除；新测试用户保留或移除
由用户决定。保留脱敏测试报告，说明回收站可恢复，完成后报告未测项目。
