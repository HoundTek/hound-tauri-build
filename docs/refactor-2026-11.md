# htb 重构设计：构建独立化 · 终端字符串模型 · 跨平台命令层 · 报错引导

> 日期：2026-11-23
> 范围：hound-tauri-build 全仓库（lib/、tasks/、bin/、tui-app/、config/）
> 目标：四项改造的设计约定与实施步骤。实施时以本文档为准，偏差需回写本文档。

---

## 0. 背景与现状问题

### 0.1 构建任务依赖宿主项目的 package.json scripts

| 位置 | 现状 | 问题 |
| --- | --- | --- |
| `tasks/android-init.cjs:24` | `execSync('yarn init:android')` | 要求宿主项目必须存在 `init:android` script，否则任务直接失败 |
| `tasks/ios-init.cjs:24` | `execSync('tauri ios init')` | 依赖裸 `tauri` 命令恰好在 PATH 中 |
| `tasks/run-tests.cjs` | `run.cmd = 'yarn test'` | 绑定 yarn 与 `test` script 名 |
| `lib/gen-icons.cjs:51` | `yarn tauri icon ...` | 同上，且多绕一层 yarn |
| `tasks/platforms.cjs`、`htb.default.json` 的 `commands.devCmd` | 裸 `tauri build/dev ...` | 依赖 `buildChildEnv()` 把 `node_modules/.bin` 注入 PATH，间接且脆弱 |

### 0.2 TUI 字符串处理重复造轮、能力不全

- `tui-app/utils/char-width.mjs`：手写码点范围表。**不处理** emoji ZWJ 序列（👨‍👩‍👧 被算成多列）、组合字符（é = e + ◌́ 算 2 列）、VS16 变体选择符、区域指示符（国旗）等，遇到复杂字符串宽度即错。
- `tui-app/utils/ansi.mjs`（357 行）：手写 ANSI tokenizer + split/slice/truncate/pad，带 OSC 8 状态追踪（这是特色，需保留）。
- `tui-app/utils/wrap-line.mjs`：与 `ansiSplit` 功能重叠的第二套实现。
- `colors.mjs` / `theme.mjs` / `components/text.mjs` / `status-bar.mjs`：各自硬编码 `\x1b[...m` 序列，无统一样式 API。
- `status-bar.mjs:54` 的宽度用 `label.length` 手算——含 ANSI 序列或全角字符时必错（现存 bug）。

### 0.3 POSIX shell 命令，Windows 不可用

| 位置 | 现状 |
| --- | --- |
| `tasks/platforms.cjs:31-38` `CROSS_CMD` | `rm -rf` / `cp -r` / `code=$?` / `exit $code` 拼接的 shell 串 |
| `config/htb.default.json:149-156` | 同样的 POSIX 串作为默认配置里的任务 cmd 覆盖 |
| `lib/clean.cjs:25` | Windows 分支用 `rmdir /s /q`（`fs.rmSync` 已足够，属冗余平台分支） |
| `lib/task-runner.cjs:473,524` | `spawn(cmd, { shell: true })`，所有任务命令走 shell 解释 |

### 0.4 报错缺少引导

- 子进程失败只透传退出码（`resolve(code === 0)`），用户面对「failed to build app」无从定位。
- 已知高频失败：Docker daemon 未启动、cross 未安装、ANDROID_HOME 未设、Java 缺失、Xcode license 未接受、tauri CLI 缺失——目前均无预检。
- `tasks/linux-init.cjs:42,44` 引用未定义变量 `tauriDir`，被触发即 ReferenceError（现存 bug）。

---

## 1. 任务一：构建命令独立化

**目标**：htb 全部内置任务不读取、不要求宿主项目 `package.json` 的任何 script；所有 tauri 调用直接定位 CLI 入口。

### 1.1 新增 `lib/tauri-cli.cjs`

```
resolveTauriCli()  → 解析 @tauri-apps/cli 的可执行 JS 入口绝对路径（带缓存）
tauriCmd(args)     → [process.execPath, cliPath, ...args]，供 spawn 使用
```

解析顺序（命中即止，全部失败时报带安装引导的错误，见 §4）：

1. `require.resolve('@tauri-apps/cli/package.json', { paths: [ROOT_DIR] })`，读其 `bin.tauri` 字段得到入口 JS（`tauri.js`），用 `node <入口>` 调用——**与包管理器无关**（yarn/npm/pnpm/bun 的 node_modules 布局均可解析，pnpm 的隔离布局因 `@tauri-apps/cli` 是 peerDependency 也必然可解析）。
2. 回退：在 `ROOT_DIR/node_modules/.bin/` 下找 `tauri`（含 `tauri.cmd`、`tauri.CMD`，Windows）——应对非常规布局。
3. 回退：PATH 中的全局 `tauri`。

调用形式统一为 **`spawn(process.execPath, [cliJs, ...args], { shell: false })`**：不经 shell、不经 `.bin` shim、不经 yarn/npm，天然跨平台。

### 1.2 逐处改造

| 位置 | 改为 |
| --- | --- |
| `tasks/android-init.cjs` | `fn` 内 `rm gen/android`（保留）→ `spawnTauri(['android', 'init'])` |
| `tasks/ios-init.cjs` | `fn` 内 `rm gen/apple`（保留）→ `spawnTauri(['ios', 'init'])` |
| `lib/gen-icons.cjs:51` | `spawnTauri(['icon', source, '--output', tempDir])` |
| `tasks/platforms.cjs` 的 `tauri build ...` | 见 §3.2，统一收敛为 `fn` 形式的 Node 实现 |
| `htb.default.json` 的 `commands.devCmd` | 保留字符串但语义改为「tauri 子命令参数」：`"dev"` / `"android dev"` / `"ios dev"`，由 `build-entry.cjs` 经 `tauriCmd()` 执行 |
| `tasks/run-tests.cjs` | 改为 `fn`：探测包管理器（`yarn.lock`→yarn、`pnpm-lock.yaml`→pnpm、`bun.lock(b)`→bun、默认 npm）+ 项目 `scripts.test` 是否存在；存在则 `<pm> test`，不存在则输出提示并视为通过（测试不是 htb 的内置职责，属宿主项目钩子）。`htb.default.json` 删除 `tasks.test` 的 cmd 覆盖 |

### 1.3 兼容性

- `tasks.<id>.cmd` 覆盖机制（`config.cjs` / `loadTaskRegistry`）**保留**：用户仍可用 `htb.config.json` 或 `--set tasks.build:win.cmd="..."` 把任何内置任务改回自定义 shell 命令——这是逃生门，不是默认路径。
- `buildChildEnv()` 保留（用户自定义 cmd 可能依赖 `.bin` 注入），但内置任务不再依赖它。

---

## 2. 任务二：终端字符串模型与静态样式 API

**目标**：建立一套「原始串 / 纯文本 / 显示宽度 / 分割 / 拼接」的统一模型与静态 API，底层委托功能完备的库处理复杂字符串，TUI 全部改用它，并消除 §0.2 的现存 bug。

### 2.1 术语与模型

终端字符串的三种视图与一族操作，全部收敛到一个模块：

- **raw**：原始串（含 ANSI 转义序列）。存储与传输形态。
- **plain**：纯文本（剥离全部 ANSI 序列）。用于搜索匹配、日志落盘、复制到剪贴板。
- **width**：显示宽度（终端列数）。CJK 全角计 2，emoji（含 ZWJ 序列、国旗、VS16）计 2，组合字符计 0，控制字符计 0。
- **操作**：`slice`（按列切片）、`truncate`（按列截断）、`wrap`（按列折行）、`pad`（补齐到列宽，支持对齐）、`concat`/`join`（拼接，宽度可加性由模型保证）。

所有操作**输入输出都是 raw**，宽度按终端列计算——调用方永远不需要自己数 `\x1b`。

### 2.2 库选型

原则：CJS 可 `require`（`lib/` 是 CommonJS，报错引导 §4 也要用样式），同时可被 `tui-app/` 的 ESM `import`（Node ESM-CJS 互操作，取 default）。

| 库 | 版本约束 | 承担 |
| --- | --- | --- |
| `string-width` | `^4`（最后的 CJS 主版本） | 显示宽度：emoji/组合字符/全角，业界标准实现 |
| `strip-ansi` | `^6`（CJS） | raw → plain |
| `slice-ansi` | `^4`（CJS） | 按列切片/截断的底层 |
| `wrap-ansi` | `^7`（CJS） | 按列折行的底层 |
| `chalk` | `^4`（CJS） | 样式：颜色/背景/粗体/暗色/下划线/反白/链式组合 |

写入 `package.json` `dependencies`（htb 目前零依赖，此为本任务引入的唯一一批）。

**保留的自研层**：现有 `ansi.mjs` 的 OSC 8 超链接状态追踪（跨行关闭/重开）是上述库不具备的能力，保留并下沉到新模块内部——tokenizer 逻辑沿用（已有 `tui-app/tests/ansi.test.mjs` 覆盖），但单字符宽度改由 `string-width` 的算法供给，废弃 `char-width.mjs` 的手写范围表。

### 2.3 新模块布局

```
lib/term/
  index.cjs      — 唯一入口，导出静态 API（见 §2.4）
  core.cjs       — 模型操作：width/plain/slice/truncate/wrap/pad/concat/join（委托 §2.2 库 + OSC8 薄层）
  style.cjs      — 样式 API（chalk 封装 + link() OSC 8）
tui-app/utils/term.mjs — ESM 转发层：export { default as term } from '../../lib/term/index.cjs'
```

`tui-app` 只许从 `utils/term.mjs` 取能力；`lib/`、`bin/`、`tasks/` 直接 `require('../lib/term/index.cjs')`。

### 2.4 静态 API 设计

```js
const { term } = require('../lib/term/index.cjs'); // 或 tui-app: import { term } from '../utils/term.mjs'

// —— 模型操作（raw in, raw out）——
term.width(str)              // 显示列宽
term.plain(str)              // 去 ANSI 纯文本
term.isAscii(str)            // plain 是否纯 ASCII（决定能否用快路径/对齐策略）
term.slice(str, start, end)  // 按列切片（OSC8/SGR 状态正确重开与关闭）
term.truncate(str, width)    // 按列截断
term.wrap(str, width)        // 折行为 string[]（OSC8/SGR 跨行保持）
term.pad(str, width, { align: 'left'|'right'|'center' }) // 补齐/截断到列宽
term.concat(...parts)        // 拼接（等价 +，语义占位，便于阅读）
term.join(parts, sep)

// —— 样式（链式，返回带 ANSI 的 raw）——
term.style.red('x')
term.style.bold.cyan('x')            // 链式组合
term.style.bgBlue.white.bold('x')
term.style.dim / underline / inverse / italic / strikethrough / hidden
term.style.hex('#ffd166') / rgb(r,g,b) / bgHex / bgRgb
term.style.link('https://…', '显示文本')   // OSC 8 超链接
term.style.task('build:win')         // 任务 ID → 稳定配色（吸收 colors.mjs 的 hashId 逻辑）
term.style.status('done'|'failed'|'running'|'pending'|'skipped') // 状态图标+配色（吸收 colors.mjs）
```

命名静态化（无实例、无配置对象），满足「静态 API」要求；`style` 基于 chalk 的链式 getter，样式种类随 chalk 全量开放。

### 2.5 TUI 迁移映射

| 废弃/改写 | 迁移到 |
| --- | --- |
| `utils/char-width.mjs` | 删除（`term.width` / 内部 string-width） |
| `utils/ansi.mjs` | 删除；`stripAnsi→term.plain`、`ansiWidth→term.width`、`ansiSlice→term.slice`、`ansiTruncate→term.truncate`、`ansiPad→term.pad`、`ansiSplit→term.wrap`；`PREFIX_W` 移到 `term` 常量；OSC8 tokenizer 下沉 `lib/term/core.cjs` |
| `utils/text-width.mjs` | 删除（原本就是 re-export） |
| `utils/wrap-line.mjs` | 删除（`term.wrap`） |
| `utils/colors.mjs` | 删除（`term.style.task` / `term.style.status`） |
| `utils/theme.mjs` | 改为对 `term.style` 的语义别名集合（保留语义名如 `theme.error`，值委托 style） |
| `components/text.mjs` | 改为薄封装：参数映射到 `term.style.* + term.pad` |
| `utils/highlight.mjs` | 保留选区/搜索逻辑，底层列操作换 `term.*` |
| `components/status-bar.mjs:54` | `label.length` 手算宽度 → `term.width(label)`（**修现存 bug**） |
| `tui-app/tests/ansi.test.mjs` | 改为测 `lib/term/core.cjs`（OSC8 行为用例全部保留，新增 emoji/ZWJ/组合字符宽度用例） |

---

## 3. 任务三：跨平台命令层（去 POSIX）

**目标**：内置任务不含任何 POSIX-only / Windows-only 的 shell 语法；文件操作一律 Node `fs` API；进程调用一律参数数组 + `shell: false`。

### 3.1 新增 `lib/sys/`

```
lib/sys/
  fsx.cjs  — rmrf(p)、cp(src, dst)、mkdirp(p)、exists(p)、isEmptyDir(p)（薄封装 fs，统一中文错误消息）
  run.cjs  — run(cmd, args, opts)：spawn 参数数组形式，shell:false；行级 stdout/stderr 回调；
             失败时返回 { ok, code, output } 并匹配常见错误模式给引导（与 §4 联动）
```

`run.cjs` 同时是 `task-runner.cjs` 的执行后端：`runCmdSilent`/`runCmdInherit` 改为接受 `{ cmd, args }` 结构；字符串形式的任务 cmd（用户自定义覆盖）仍走 `shell: true` 兼容路径，但**所有内置任务一律提供 args 数组**。

### 3.2 CROSS_CMD → `lib/cross-build.cjs`

`tasks/platforms.cjs` 的 `CROSS_CMD`（rm/cp/exit-code 拼接串）改为任务 `fn`：

```js
// lib/cross-build.cjs
async function crossBuild({ target, extraArgs, tauriDir, frontendDir }) {
  const staging = path.join(ROOT_DIR, tauriDir, '.htb-frontend-dist');
  fsx.rmrf(staging);
  fsx.cp(frontendDirAbs, staging);
  try {
    return await runTauri(['build', '--runner', 'cross', '--target', target,
      ...extraArgs, '--config', '{"build":{"frontendDist":"./.htb-frontend-dist"}}']);
  } finally {
    fsx.rmrf(staging);   // 等价原 code=$?/rm/exit 语义：任何结果都清理，退出码如实传递
  }
}
```

`build:win/linux` 与 `build-quick:*` 全部改为 `fn` 调用 `crossBuild` 或 `runTauri`；任务定义因此从「shell 串模板」变成「数据 + 函数」，`platforms.cjs` 保持数据表形态。

### 3.3 配置清理

- `htb.default.json` 的 `tasks` 域**整段删除**（里面的 5 条 POSIX cmd 覆盖是 §0.3 的污染源；删除后内置任务定义以代码为准）。`tasks.<id>.cmd` 覆盖机制本身保留（§1.3）。
- `lib/clean.cjs:25` 的 `rmdir /s /q` 平台分支删除，`fs.rmSync(..., { maxRetries: 3 })` 已是跨平台正解。
- 其余散点：`build-entry.cjs` 未使用的 `execSync` import 移除；`bin/hound-tauri-sim-install.js` 已是参数数组 spawnSync（macOS-only 工具，符合要求，不改）。

---

## 4. 任务四：报错引导与环境预检

**目标**：失败信息回答三个问题——**什么坏了、为什么、怎么修**（分操作系统给出命令）。

### 4.1 新增 `lib/preflight.cjs`

按目标平台关联检查项，任务调度前统一执行（inline 面板输出，任一失败即中止）：

```
检查项（每项：detect() → { ok, detail, hint }）
  node           — process.version >= 18
  tauri-cli      — resolveTauriCli() 可解析（否则：npm i -D @tauri-apps/cli）
  rust           — cargo --version（否则：rustup 安装引导 https://rustup.rs）
  cross          — 目标含 win/linux 且主机非该目标时：cross --version（否则：cargo install cross）
  docker         — 目标含 win/linux 时：docker info（daemon 未运行 → 启动 Docker Desktop /
                   systemctl --user start docker；未安装 → 安装引导，分 OS）
  makensis       — 目标含 win 且需 nsis 时（macOS: brew install makensis）
  xcode          — 目标含 mac/ios 时：xcodebuild -version + license 状态
  android-sdk    — 目标含 android 时：ANDROID_HOME 设置、platform-tools/adb 存在
  java           — 目标含 android 时：JAVA_HOME 或 java -version（→ 安装 JDK 17 引导）
```

输出样式（用 §2 的 style API）：

```
✗ 环境检查未通过

  docker        Docker daemon 未运行
                修复：启动 Docker Desktop（macOS: open -a Docker）
  android-sdk   ANDROID_HOME 未设置
                修复：export ANDROID_HOME="$HOME/Library/Android/sdk"
```

`htb doctor` 新命令：跑全部检查项并打印报告（不构建）。

### 4.2 运行时错误增强（`lib/sys/run.cjs`）

子进程失败时对输出做模式匹配，附加引导段落：

| 模式 | 引导 |
| --- | --- |
| `ENOENT` / `command not found` | 命令不存在 → 对应安装引导 |
| `Cannot connect to the Docker daemon` | 启动 Docker Desktop / docker service |
| `frontendDist ... doesn't exist` | 前端未构建 → 先跑前端 build（提示项目 beforeBuildCommand） |
| `Connection refused`（gradle/cargo 下载） | 网络/代理提示（检查代理配置或直连） |
| `license`（Xcode） | `sudo xcodebuild -license accept` |
| 进程被信号杀死（SIGKILL/SIGTERM） | 提示内存不足或被外部终止，重试建议 |

引导文本按 `process.platform` 三选一（darwin/win32/linux）组织。

### 4.3 顺手修复的现存 bug

- `tasks/linux-init.cjs:42,44`：`tauriDir` 未定义（应取自 `getConfig().project.tauriDir`，同文件已有模式）。
- `components/status-bar.mjs:54`：宽度手算（见 §2.5）。

---

## 5. 调试工作流（yarn link）

```bash
cd ~/Code/HoundTek/hound-tauri-build && yarn link          # 注册全局链接
cd ~/Code/Parallel/parallel && yarn link hound-tauri-build  # 项目接入本地包
# 解除：yarn unlink hound-tauri-build（项目侧）→ 恢复 yarn install
```

验证矩阵（每个阶段完成后跑）：

| 验证 | 命令 | 通过标准 |
| --- | --- | --- |
| 单元 | `node tui-app/tests/ansi.test.mjs`（改造后） | 全绿，含新增 emoji 用例 |
| TUI 冒烟 | `htb build win --no-tui`（先断 Docker 验证 §4 引导） | 引导面板正确；修复后构建通过 |
| 独立化 | 临时移除 parallel 项目 `package.json` 的 `init:android`，`htb build android --no-tui` 至少走到 gradle | 不再报 script 缺失 |
| 跨平台 | `node -e` 直接调用 `crossBuild` 的 stage/unstage（Windows 语义路径） | 无 POSIX 语法残留（grep `rm -rf`/`cp -r`/`rmdir` 应为零命中，templates/Dockerfile 除外） |
| 回归 | `htb build all --no-tui`（parallel 项目） | 桌面四平台 + android 通过（ios 视环境） |

---

## 6. 实施步骤

按依赖关系排序，每步独立可验证、独立可提交：

1. **lib/term 模块 + 依赖引入**（§2.2–2.4）：新增 `lib/term/`、package.json dependencies、`tui-app/utils/term.mjs` 转发、迁移 ansi 测试。此时不删旧文件。✅ 已完成（87 测试全绿，含 emoji/ZWJ/组合字符用例）
2. **TUI 全量迁移**（§2.5）：逐文件替换 import 与调用，删除旧 utils，跑 ansi 测试 + 各 demo 页面目验。✅ 已完成（删除 ansi/char-width/text-width/wrap-line/colors 五个旧模块，全仓引用清零，demo 冒烟通过；status-bar 宽度 bug 已修）
3. **sys 层 + tauri-cli**（§1.1、§3.1）：`lib/sys/fsx.cjs`、`lib/sys/run.cjs`、`lib/tauri-cli.cjs`。✅ 已完成（含 Windows `.cmd/.bat` shim 特判）
4. **内置任务改造**（§1.2、§3.2）：`platforms.cjs`（含 `lib/cross-build.cjs`）、`android-init`、`ios-init`、`run-tests`、`gen-icons`、`build-entry`（devCmd）；删 `htb.default.json` 的 tasks 域；clean.cjs 去 rmdir 分支；修 linux-init bug。✅ 已完成（另：artifacts patterns 支持 `{productName}` 占位符，修掉 linux 产物收集硬编码）
5. **preflight + 错误引导**（§4）：`lib/preflight.cjs`、run.cjs 模式匹配、`htb doctor`。✅ 已完成（makensis 检查因 NSIS 打包在 Docker 镜像内完成而移除，避免误报）
6. **联调与文档回写**：§5 验证矩阵全跑；README「前置要求/故障排除」章节更新；本文档标注完成状态。🔄 进行中

### 明确不做

- 不改动 TaskDAG / ReadWriteLockSet / TUI 交互（focus/events/mouse）逻辑。
- 不引入 TypeScript、不改构建产物形态（仍 tsc-free 的 cjs/mjs）。
- `tasks.<id>.cmd` 字符串覆盖的 shell 路径保留（逃生门），不强制 args 化。
- iOS/Android 的签名、sim-install 等 macOS-only 工具不做 Windows 适配（本就平台专属）。
