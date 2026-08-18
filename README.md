# Hound Tauri Build

> 面向 Tauri v2 的声明式构建辅助工具 —— 任务编排、并行调度、TUI 可视化，一套搞定。

[![npm version](https://img.shields.io/npm/v/hound-tauri-build)](https://www.npmjs.com/package/hound-tauri-build)
[![license](https://img.shields.io/npm/l/hound-tauri-build)](https://github.com/HoundTek/hound-tauri-build/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/hound-tauri-build)](https://nodejs.org/)

---

## 特性

- **声明式任务系统** —— 每个任务一个 `.cjs` 文件，声明依赖、冲突资源、执行命令，零模板代码
- **统一配置体系** —— 默认配置 + 项目 `htb.config.json` + 命令行 `--set <path>=<value>` 三级合并覆盖，任务/命令/图标/产物全部可配置
- **产物统一收集** —— 构建完成后自动把各平台产物拷贝到 `dist/<platform>/`，一条命令交付所有安装包
- **DAG 并行调度** —— 自动解析依赖图，拓扑排序，最多 4 任务并行，冲突资源自动串行化
- **自定义 TUI 界面** —— 零依赖终端 UI，实时展示任务树、构建日志、进度统计，支持键盘/鼠标交互
- **日志过滤与搜索** —— 按日志级别（success/warning/error/info/log）、任务、关键词实时过滤
- **跨平台构建** —— 支持 Windows / macOS (x86_64 + Universal) / Linux / Android / iOS
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
- [`cross`](https://github.com/cross-rs/cross) + Docker（桌面端构建通过 `--runner cross` 交叉编译，同平台时 cross 自动回退到原生 cargo）
- `makensis`（macOS/Linux 上打包 Windows NSIS 安装包时需要，`brew install makensis`）

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
# 构建成功后自动把产物收集到 dist/<platform>/
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
| 桌面端（聚合） | `desktop` | win + mac + mac-universal + linux |
| Windows | `win` | NSIS / MSI 安装包 |
| macOS Intel | `mac` | x86_64-apple-darwin |
| macOS Universal | `mac-universal` | universal-apple-darwin |
| Linux | `linux` | deb / AppImage / rpm |
| Android | `android` | APK / AAB |
| iOS | `ios` | IPA |
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

构建完成后，产物自动统一拷贝到项目根 `dist/<platform>/` 目录：

```
dist/
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
    "output": "dist",
    "platforms": {
      "win": { "dir": "win", "patterns": ["src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/*.exe", "src-tauri/target/x86_64-pc-windows-gnu/release/bundle/msi/*.msi"] },
      "android": { "dir": "android", "patterns": ["src-tauri/gen/android/app/build/outputs/apk/**/*.apk"] }
    }
  }
}
```

> 注意：在 macOS 上交叉编译 Linux 时，tauri bundler 不支持生成 deb/rpm/AppImage，产物为裸二进制（tauri 硬限制）。

## 声明式任务系统

项目自带一套开箱即用的任务定义（位于 `tasks/` 目录），但你也可以**扩展自定义任务**。

### 内置任务依赖图

```
ship:*     → test → build:*
build:win  → icon:win
build:mac  → icon:mac
build:linux → icon:linux → linux:init
build:android → icon:android → android:init
build:ios  → icon:ios → ios:init
build:*    → collect:*   （构建后自动收集产物到 dist/）

冲突资源：
  resource:cross-build   — 防止多个 Rust 编译任务并行
  resource:tauri-cli     — 防止多个 Tauri CLI 任务并行
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
  conflicts: ['resource:my-lock'], // 冲突资源名（与同资源任务串行）
  retry: 3,                        // 失败重试次数（默认 3）
  run: {
    cmd: 'echo "Hello Hound!"',    // shell 命令
  },
};
```

也可使用 JavaScript 函数替代 shell 命令：

```js
run: {
  fn: () => {
    console.log('开始处理...');
    // 你的逻辑
    console.log('处理完成');
    return true; // 返回 false 视为失败（触发重试）
  },
}
```

> `console.log` / `console.warn` / `console.error` 的输出会自动转发到 TUI 日志面板。

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

- `source`：按顺序查找，第一个存在的文件被使用
- `output`：生成图标的目标目录
- 支持缓存，重复生成时自动跳过

## License

MIT © Frank Steven
