# Hound Tauri Build

> 面向 Tauri v2 的声明式构建辅助工具 —— 任务编排、并行调度、TUI 可视化，一套搞定。

[![npm version](https://img.shields.io/npm/v/hound-tauri-build)](https://www.npmjs.com/package/hound-tauri-build)
[![license](https://img.shields.io/npm/l/hound-tauri-build)](https://github.com/HoundTek/hound-tauri-build/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/hound-tauri-build)](https://nodejs.org/)

---

## 特性

- **声明式任务系统** —— 每个任务一个 `.cjs` 文件，声明依赖、冲突资源、执行命令，零模板代码
- **统一配置体系** —— 默认配置 + 项目 `htb.config.json` + 命令行 `--set <path>=<value>` 三级合并覆盖，任务/命令/图标/产物全部可配置
- **产物统一收集** —— 构建完成后自动把各平台产物拷贝到 `release/<platform>/`，一条命令交付所有安装包
- **DAG 并行调度** —— 自动解析依赖图，拓扑排序，最多 4 任务并行，冲突资源自动串行化
- **自定义 TUI 界面** —— 零依赖终端 UI，实时展示任务树、构建日志、进度统计，支持键盘/鼠标交互
- **日志过滤与搜索** —— 按日志级别（success/warning/error/info/log）、任务、关键词实时过滤
- **跨平台构建** —— 支持 Windows (x86_64 + ARM64) / macOS (x86_64 + Universal) / Linux / Android / iOS
- **图标自动化** —— 两阶段生成（生成 + 复制），带缓存，支持按平台指定不同图标源
- **智能回退** —— TUI 启动失败或非 TTY 环境自动降级为内联串行模式
- **可编程 API** —— 支持以 npm 包形式引入，在你的脚本中调用核心引擎

## 安装

```bash
npm install -D hound-tauri-build
```

**前置要求：**
- Node.js >= 18
- `@tauri-apps/cli` ^2.0.0（peer dependency）
- Rust / Android SDK / Xcode 等对应平台的 Tauri 构建依赖
- [`cross`](https://github.com/cross-rs/cross) + Docker（win/linux/linux-arm64 目标通过 `--runner cross` 交叉编译，同平台时 cross 自动回退到原生 cargo；Windows NSIS 打包在 Docker 镜像内完成，宿主机无需安装 makensis）
- [`cargo-xwin`](https://github.com/Jake-Shadle/xwin) + LLVM（仅 win-arm64 目标需要：`cargo install cargo-xwin` + `rustup target add aarch64-pc-windows-msvc`；macOS 上 `brew install llvm` 提供 clang/lld/llvm-rc，brew 的 keg-only 路径由 htb 构建时自动注入 PATH）

> 不确定环境是否齐备？运行 `htb doctor` 一键体检——逐项报告依赖状态并给出安装/启动引导。

## 快速开始

在你的 Tauri 项目中安装后，准备好图标源文件：

```
your-tauri-project/
├── icons/                     # 图标源文件目录
│   ├── icon.png               # 默认图标（兜底）
│   ├── icon-desktop.png       # 桌面端通用图标（可选）
│   ├── icon-win.png           # Windows 专属图标（可选）
│   ├── icon-mac.png           # macOS 专属图标（可选）
│   ├── icon-linux.png         # Linux 专属图标（可选）
│   ├── icon-android.png       # Android 专属图标（可选）
│   └── icon-ios.png           # iOS 专属图标（可选）
├── src-tauri/
└── package.json
```

然后在 `package.json` 中添加脚本（可选）：

```json
{
  "scripts": {
    "dev": "htb dev desktop",
    "build": "htb build desktop",
    "build:win": "htb build win",
    "build:mac": "htb build mac",
    "build:all": "htb build all",
    "ship": "htb ship desktop",
    "icon": "htb icon desktop",
    "clean": "htb-clean all"
  }
}
```

## CLI 命令

### 构建相关

```bash
# 完整构建（含图标生成），支持多平台 / 任务编排
# 构建成功后自动把产物收集到 release/<platform>/
htb build <platform...>
htb ship <platform...>     # 先跑测试，再构建（同样自动收集产物）

# 快速构建（跳过图标和依赖任务，不收集产物）
htb build-quick <platform...>

# 单独收集已构建的产物（会先构建对应平台）
htb build collect:win
htb build collect:all

# 开发模式（生成图标后启动 tauri dev）
htb dev <platform>
```

### 环境检查

```bash
htb doctor   # 全量环境体检：Node / Tauri CLI / Rust / cross / Docker / Xcode / Android SDK / JDK
             # 失败项给出分操作系统的安装、启动引导
```

`build` / `dev` 前也会自动做按目标平台的预检（preflight），缺依赖时直接给出修复指引并中止，不再等到编译器报错。

### 多任务编排

平台名和任务 ID 可以混用，任意顺序编排：

```bash
# 多平台
htb build win linux

# 任务 ID 直接编排（含依赖自动解析）
htb build:win linux:init test

# 平台 + 任务 ID 混用
htb build win linux:init

# 图标多平台
htb icon mac win
```

> 重复的任务会自动去重；依赖关系（如 `build:win` → `icon:win`）会自动解析。

### 辅助工具

```bash
# 图标生成
htb icon <platform>       # 单个平台
htb icon all              # 全部平台

# 清理
htb-clean <target>              # 清理指定目标
htb-clean all                   # 清理全部
htb-clean status                # 查看当前图标源状态

# 图标工具（独立使用）
htb-icon <platform>
htb-icon all

# iOS 模拟器安装（把 htb build ios --sim 的产物装到模拟器）
node bin/hound-tauri-sim-install.js --list
node bin/hound-tauri-sim-install.js [--project <dir>] [--launch] [--device <name|udid>]
```

### 支持的平台

| 平台 | 值 | 说明 |
|------|-----|------|
| 桌面端（聚合） | `desktop` | win + win-arm64 + mac + mac-arm64 + mac-universal + linux + linux-arm64 |
| Windows | `win` | x86_64 NSIS 安装包（cross + Docker 交叉编译） |
| Windows ARM | `win-arm64` | aarch64-pc-windows-msvc NSIS 安装包（cargo-xwin 交叉编译；需 `cargo install cargo-xwin` + `rustup target add aarch64-pc-windows-msvc` + clang） |
| Windows 绿色版 | `win-portable` | x86_64 单文件 exe（`--no-bundle`，不打安装包，双击即用；x86_64-pc-windows-msvc 经 cargo-xwin 交叉编译——MSVC 目标静态链接 WebView2Loader，无需附带 dll，工具链同 `win-arm64`） |
| Windows ARM 绿色版 | `win-arm64-portable` | aarch64 单文件 exe（`--no-bundle`；交叉编译链同 `win-arm64`） |
| macOS Intel | `mac` | x86_64-apple-darwin |
| macOS Apple Silicon | `mac-arm64` | aarch64-apple-darwin（universal 已包含，单独出包可省一半体积；需 `rustup target add aarch64-apple-darwin`） |
| macOS Universal | `mac-universal` | universal-apple-darwin |
| Linux | `linux` | x86_64 deb / AppImage / rpm（cross + Docker 交叉编译） |
| Linux ARM | `linux-arm64` | aarch64-unknown-linux-gnu（cross + Docker 交叉编译，镜像见 templates/Dockerfile.cross-linux-arm64） |
| Android | `android` | APK / AAB |
| iOS | `ios` | IPA |
| Web | `web` | 纯前端构建（无 Tauri 壳），产物为 `build.frontendDist` 目录；独立目标，不含在聚合中 |
| 移动端（聚合） | `mobile` | android + ios |
| 全平台 | `all` | desktop + mobile |

### 选项

| 选项 | 说明 |
|------|------|
| `--no-tui` | 禁用 TUI，直接用终端文本输出 |
| `--end-tui` | 构建完成后短暂展示结果，自动退出 TUI（适合脚本/CI） |
| `--retry <n>` | 覆盖失败任务的重试次数（默认 3，`--retry 0` 关闭重试） |
| `--set <path>=<value>` | 运行时覆盖配置项（如 `--set artifacts.output=out`），优先级最高 |

## 配置体系

htb 的配置由三层合并而成（**项目级 > 用户级 > 默认**）：

| 层级 | 位置 | 说明 |
|------|------|------|
| 默认 | `config/htb.default.json`（内置） | 任务、命令映射、图标、产物等默认值 |
| 项目级 | 项目根 `htb.config.json` | 覆盖默认值，随仓库分发 |
| 用户级 | `HTB_SET_OVERRIDES` 环境变量 | 覆盖项目级（机器级偏好） |
| 运行时 | `--set <path>=<value>` | 最高优先级，仅当次生效 |

```jsonc
// htb.config.json（项目根）
{
  "ios": { "target": "sim", "sign": true },
  "tui": { "logLimit": 20000 },
  "tasks": {
    "build:android": { "env": { "JAVA_HOME": "/Library/Java/..." } }
  }
}
```

任务定义的所有字段（`cmd` / `env` / `retry` / `dependsOn`）都可被覆盖，任务 ID 支持自定义（冒号分隔或任意命名，如 `build-win`）：

```bash
# 运行时覆盖任务命令
htb build win --set 'tasks.build-win.cmd=tauri build --bundles msi'

# 覆盖产物输出目录
htb build all --set artifacts.output=release
```

## 产物收集

构建完成后，产物自动统一拷贝到项目根 `release/<platform>/` 目录（独立于前端构建目录 `dist/`，避免被前端重建清空）：

```
release/
├── win/            app_setup.exe
├── linux/          app 二进制
├── mac/            App.app
├── mac-universal/  App.app
├── android/        app.apk + app.aab
└── ios/            App.app
```

产物路径与输出目录通过 `artifacts` 配置控制，可随项目覆盖：

```jsonc
{
  "artifacts": {
    "output": "release",
    "platforms": {
      "win": { "dir": "win", "patterns": ["src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/*.exe"] },
      "android": { "dir": "android", "patterns": ["src-tauri/gen/android/app/build/outputs/apk/**/*.apk"] }
    }
  }
}
```

> 注意：在 macOS 上交叉编译 Linux 时，tauri bundler 不支持生成 deb/rpm/AppImage，产物为裸二进制（tauri 硬限制）。

## 声明式任务系统

项目自带一套开箱即用的任务定义（位于 `tasks/` 目录），但你也可以**扩展自定义任务**。

- **平台级任务**（`icon:*` / `build:*` / `build-quick:*` / `collect:*` 与聚合元任务）统一声明在 `tasks/platforms.cjs` 数据表中，新增平台只需在对应数组加一行。
- **复杂任务**（`android:init` / `android:signing` / `ios:init` / `linux:init` / `test`）保留独立文件 `tasks/*.cjs`。

### 内置任务依赖图

```
ship:*     → test → build:*
build:win  → icon:win
build:mac  → icon:mac
build:linux → icon:linux → linux:init
build:android → icon:android → android:init
build:ios  → icon:ios → ios:init
build:*    → collect:*   （构建后自动收集产物到 release/）

冲突资源（读写锁）：
  resource:cross-build   — 写锁：防止多个 Rust 编译任务并行（写 src-tauri/target）
  resource:tauri-cli     — 写锁：防止多个 Tauri CLI 任务并行（改写项目文件）
  resource:gen-android   — 写锁：android:init / android:signing / icon:android 共享 gen/android
  resource:gen-ios       — 写锁：ios:init / icon:ios 共享 gen/apple
  只读任务在 conflicts 中声明 mode:'read'，同资源多任务可并发执行。
```

### Linux 交叉编译

Linux 构建使用 [`cross`](https://github.com/cross-rs/cross) 通过 Docker 容器交叉编译，解决了在 Windows/macOS 上编译 GTK/WebKit2GTK 依赖的问题。

`linux:init` 任务会自动将以下模板复制到目标项目的 `src-tauri/` 目录（已存在则跳过，不覆盖自定义配置）：

- `Cross.toml` — 告诉 `cross` 为 `x86_64-unknown-linux-gnu` / `x86_64-pc-windows-gnu` 目标使用自定义镜像
- `Dockerfile.cross-linux` — 基于 cross 官方 Linux 目标镜像，预装 `libwebkit2gtk-4.1-dev` 等 Tauri 依赖
- `Dockerfile.cross-windows` — 基于 cross 官方 Windows (GNU) 目标镜像，强制 `linux/amd64` 平台

> 在 Apple Silicon（arm64）主机上，cross 官方镜像只提供 amd64 manifest，Docker 默认请求 arm64 会拉取失败，因此自定义 Dockerfile 通过 `--platform=linux/amd64` 强制平台（经 Rosetta/qemu 模拟）。

首次构建时 Docker 会自动构建此镜像（之后缓存复用）。如需自定义 Linux 依赖，直接编辑 `src-tauri/Dockerfile.cross-linux` 即可。

### 编写自定义任务

在 `tasks/` 目录下新建 `my-task.cjs`：

```js
module.exports = {
  id: 'my-task',                   // 唯一标识
  description: '我的自定义任务',     // TUI 中显示的名称
  dependsOn: ['other-task'],       // 依赖的任务 ID 列表
  conflicts: [{                    // 共享资源读写锁声明
    resource: 'resource:my-lock',  //   资源名
    mode: 'write',                 //   'write' 写锁（独占，默认）| 'read' 读锁（可并发）
  }],
  retry: 3,                        // 失败重试次数（默认 3）
  run: {
    cmd: 'echo "Hello Hound!"',    // shell 命令
  },
};
```

也可使用 JavaScript 函数替代 shell 命令（支持 async）：

```js
run: {
  fn: async (ctx) => {
    ctx.log('开始处理...');          // 直接写入本任务的 TUI 日志
    // 你的逻辑（可 await）
    ctx.log('处理完成');
    return true; // 返回 false 视为失败（触发重试）
  },
}
```

> `ctx.log(text)` 写入当前任务日志；`ctx.abort` 是中止信号（`{ signaled }`），长任务应轮询响应。
> `console.log` / `console.warn` / `console.error` 的输出同样会自动转发到 TUI 日志面板。

## 跨平台与命令独立性

- **不依赖宿主项目的 package.json scripts**：所有内置任务直接调用 Tauri CLI 入口（`lib/tauri-cli.cjs` 解析 `@tauri-apps/cli` 的 bin），不经 yarn/npm、不经 `.bin` shim。
- **Windows 原生可用**：文件操作一律 Node `fs` API（`lib/sys/fsx.cjs`），进程调用一律参数数组 spawn（`lib/sys/run.cjs`，Windows 的 `.cmd/.bat` shim 自动特判），无任何 POSIX-only shell 语法。
- 内置任务失败时会对输出做已知错误模式匹配（Docker daemon 未运行、前端产物缺失、下载被拒等），在日志中附 `[hint]` 修复引导。

### tauri.conf.json 的 hook 语义（beforeBuildCommand / beforeDevCommand）

- **暂存构建（Windows 交叉编译）**：htb 会**先自行执行** `beforeBuildCommand`，再把前端产物复制到 `src-tauri/.htb-frontend-dist` 暂存，并将 tauri 侧的 hook 覆盖为 no-op。这样保证打包的永远是本次构建的新鲜产物，且 hook 不会在 tauri 内部二次执行。
- hook 必须是**简单命令**（空白分隔的 argv，不含 `&&`、`|`、`;`、`>`、`$`、引号等 shell 元字符），例如：
  ```json
  { "build": { "beforeBuildCommand": "node node_modules/vite/bin/vite.js build" } }
  ```
- **hook 不得（直接或间接）调用 htb 自身**。`"beforeBuildCommand": "yarn build"` 且 package.json 的 `"build": "htb build"` 会形成无限递归（进程爆炸、`.htb-frontend-dist` 反复创建删除）。htb 有两层防护：
  1. **静态检查**：构建/dev 启动前解析 hook → package.json scripts 调用链，发现回到 htb 立即报错并给出修复引导；
  2. **环境兜底**：htb 进程会设置 `HTB_BUILD_ACTIVE`，嵌套调用的 htb 检测到后直接拒绝执行。

## 可编程 API

作为 npm 包引入，在脚本中调用核心引擎：

```js
const { loadTaskRegistry, resolveTaskGraph, executeTasks, run } = require('hound-tauri-build');

// 快捷方式：加载 → 解析 → 执行
const ok = await run(['build:win'], 'inline', {
  onInit(tasks) { /* 任务列表 */ },
  onStatus(id, status, elapsed) { /* 状态变更 */ },
  onLog(text, taskId) { /* 构建日志 */ },
  onExit(ok) { /* 构建完成 */ },
});

// 分步调用
const registry = loadTaskRegistry();
const { ordered, errors } = resolveTaskGraph(['build:win'], registry);
if (errors.length === 0) {
  await executeTasks(ordered, 'inline', callbacks);
}
```

## 图标配置

图标源文件放在项目根目录的 `icons/` 文件夹。图标源与输出路径通过配置体系的 `icons.platforms` 段控制（默认值见 `config/htb.default.json`，可被 `htb.config.json` / `--set` 覆盖）：

```jsonc
{
  "icons": {
    "platforms": {
      "win": {
        "source": ["icon-win.png", "icon-desktop.png", "icon.png"],
        "output": "src-tauri/icons"
      },
      "android": {
        "source": ["icon-android.png", "icon.png"],
        "output": "src-tauri/gen/android/app/src/main/res"
      }
    }
  }
}
```

- `source`：按顺序查找，第一个存在的条目被使用。三种形式：
  - **文件名**（如 `"icon-mac.png"`）：在 `icons/` 目录内查找（旧行为）；
  - **路径**（含 `/` 或绝对路径，如 `"icons/parallel.png"`）：相对项目根解析；
  - **目录**：两种特殊目录源——
    - android 的**预构建 res 目录**（含 `mipmap-*`）：不经 `tauri icon`，直接拷贝 `mipmap-*` 到输出目录；
    - macOS 的 **Icon Composer `.icon` 包**：先经 `templates/icon-flatten.swift` 展平为 1024 PNG（需 macOS + Xcode CLT），再走 `tauri icon` 正常生成。
- `output`：生成图标的目标目录
- 支持缓存，重复生成时自动跳过（目录源按目录内最大 mtime 判定）

## License

MIT © Frank Steven
