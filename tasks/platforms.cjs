/**
 * @file 平台级任务统一数据表
 * @description 所有平台模式化任务（icon / build / build-quick / collect）与聚合元任务
 *              集中在此声明，导出任务定义数组（加载器已支持数组导出）。
 *              新增平台只需在对应数据数组中加一行。
 *              复杂任务（android:init / android:signing / ios:init / linux:init / test）保留独立文件。
 * @module scripts/build/tasks/platforms
 */

const path = require('path');
const { collectPlatform } = require('../lib/artifacts.cjs');
const { getConfig } = require('../lib/config.cjs');
const { stagedBuild, plainBuild, webBuild, frontendDistDir } = require('../lib/cross-build.cjs');
const { runTauri } = require('../lib/tauri-cli.cjs');

// 图标生成器入口（lib/ 下的 gen-icons.cjs）
const GEN_CMD = `node "${path.join(__dirname, '..', 'lib', 'gen-icons.cjs')}"`;

const config = getConfig();
const TAURI_DIR = config.project.tauriDir || 'src-tauri';
// 前端产物目录：htb.config.json 显式覆盖 > tauri.conf.json build.frontendDist > 'dist'
const FRONTEND_DIR = config.project.frontendDir || frontendDistDir(TAURI_DIR) || 'dist';

// iOS 构建 flag（来自统一配置，HTB_* 环境变量由 config.cjs 扁平化产生）
const IOS_SIM_TARGET = 'aarch64-sim';
const IOS_TARGET_ARGS = process.env.HTB_IOS_TARGET === 'sim' ? ['--target', IOS_SIM_TARGET] : [];
const IOS_NO_SIGN_ARGS = process.env.HTB_IOS_SIGN === 'false' ? ['--no-sign'] : [];
const IOS_BUILD_ARGS = ['ios', 'build', ...IOS_TARGET_ARGS, ...IOS_NO_SIGN_ARGS];

// 交叉编译目标三元组
const TARGET_WIN = 'x86_64-pc-windows-gnu';
const TARGET_WIN_ARM64 = 'aarch64-pc-windows-msvc';
const TARGET_LINUX = 'x86_64-unknown-linux-gnu';
const TARGET_LINUX_ARM64 = 'aarch64-unknown-linux-gnu';
const TARGET_MAC = 'x86_64-apple-darwin';
const TARGET_MAC_ARM64 = 'aarch64-apple-darwin';
const TARGET_MAC_UNIVERSAL = 'universal-apple-darwin';

/**
 * 交叉编译（win/linux）：暂存前端产物 → tauri build --runner cross → finally 清理。
 * 纯 Node 实现（lib/cross-build.cjs），替代原 POSIX shell 拼接。
 */
const cross = (tauriArgs) => (ctx) =>
  stagedBuild({ tauriArgs, tauriDir: TAURI_DIR, frontendDir: FRONTEND_DIR, onLine: ctx && ctx.log, abort: ctx && ctx.abort });

/** 原生构建（mac/android/ios/desktop）：tauri 透传，无暂存 */
const plain = (tauriArgs) => (ctx) =>
  plainBuild({ tauriArgs, onLine: ctx && ctx.log, abort: ctx && ctx.abort });

/** 移动端构建（tauri android/ios build） */
const mobile = (args) => async (ctx) => {
  const r = await runTauri(args, { onLine: ctx && ctx.log, abort: ctx && ctx.abort });
  for (const g of r.guides) if (ctx && ctx.log) ctx.log(`[hint] ${g}`);
  return r.ok;
};

/** web 构建：纯前端（无 tauri 壳），产物为 frontendDir 目录本身 */
const web = () => (ctx) =>
  webBuild({ tauriDir: TAURI_DIR, frontendDir: FRONTEND_DIR, onLine: ctx && ctx.log, abort: ctx && ctx.abort });

const CROSS_BUILD = { resource: 'resource:cross-build', mode: 'write' };
const TAU_CLI = { resource: 'resource:tauri-cli', mode: 'write' };

// ---- icon:* 图标任务 ----
const ICON_INIT = { android: ['android:init'], ios: ['ios:init'] };
const ICON_CONFLICTS = (p) => {
  const c = [TAU_CLI];
  if (p === 'android') c.push({ resource: 'resource:gen-android', mode: 'write' });
  if (p === 'ios') c.push({ resource: 'resource:gen-ios', mode: 'write' });
  return c;
};
const ICON_PLATFORMS = ['desktop', 'mac', 'win', 'linux', 'android', 'ios'];
const ICON_TASKS = ICON_PLATFORMS.map((p) => ({
  id: `icon:${p}`,
  description: `icon ${p}`,
  dependsOn: ICON_INIT[p] || [],
  conflicts: ICON_CONFLICTS(p),
  run: { cmd: `${GEN_CMD} ${p}` },
}));

// ---- build:* 构建任务 ----

// 共享构建（build 和 build-quick 复用）
const BUILD_RUN = {
  win: cross(['--runner', 'cross', '--target', TARGET_WIN, '--bundles', 'nsis']),
  // Windows on ARM：MSVC 目标经 cargo-xwin 交叉编译（官方推荐路径，stagedBuild 与 runner 无关，直接复用）
  'win-arm64': cross(['--runner', 'cargo-xwin', '--target', TARGET_WIN_ARM64, '--bundles', 'nsis']),
  // 绿色单文件 exe（--no-bundle 跳过安装包打包，产物为 target/<triple>/release/<productName>.exe）
  'win-portable': cross(['--runner', 'cross', '--target', TARGET_WIN, '--no-bundle']),
  'win-arm64-portable': cross(['--runner', 'cargo-xwin', '--target', TARGET_WIN_ARM64, '--no-bundle']),
  mac: plain(['--target', TARGET_MAC, '--bundles', 'app']),
  'mac-arm64': plain(['--target', TARGET_MAC_ARM64, '--bundles', 'app']),
  'mac-universal': plain(['--target', TARGET_MAC_UNIVERSAL, '--bundles', 'app']),
  linux: cross(['--runner', 'cross', '--target', TARGET_LINUX]),
  'linux-arm64': cross(['--runner', 'cross', '--target', TARGET_LINUX_ARM64]),
  android: mobile(['android', 'build']),
  ios: mobile(IOS_BUILD_ARGS),
  web: web(),
};
// 构建前置：平台专属初始化（在 icon 之后执行）
const BUILD_EXTRA_INIT = {
  linux: ['linux:init'],
  'linux-arm64': ['linux:init'],
  android: ['android:signing'],
  ios: ['ios:init'],
};
// 图标依赖：mac-universal/mac-arm64 复用 mac 图标、win-arm64 复用 win 图标、
// linux-arm64 复用 linux 图标（无独立 icon 任务）；web 无图标（null）
const BUILD_ICON_DEP = { 'mac-universal': 'icon:mac', 'mac-arm64': 'icon:mac', 'win-arm64': 'icon:win', 'win-portable': 'icon:win', 'win-arm64-portable': 'icon:win', 'linux-arm64': 'icon:linux', web: null };
const iconDeps = (p) => (p in BUILD_ICON_DEP ? (BUILD_ICON_DEP[p] ? [BUILD_ICON_DEP[p]] : []) : [`icon:${p}`]);
const BUILD_PLATFORMS = ['win', 'win-arm64', 'win-portable', 'win-arm64-portable', 'mac', 'mac-arm64', 'mac-universal', 'linux', 'linux-arm64', 'android', 'ios', 'web'];
const BUILD_TASKS = BUILD_PLATFORMS.map((p) => ({
  id: `build:${p}`,
  description: `build ${p}`,
  dependsOn: [...iconDeps(p), ...(BUILD_EXTRA_INIT[p] || [])],
  conflicts: [CROSS_BUILD],
  run: { fn: BUILD_RUN[p] },
}));

// ---- build-quick:* 快速构建（跳过图标/初始化） ----
const QUICK_RUN = {
  desktop: plain([]),
  mac: plain(['--bundles', 'app']),
  'mac-arm64': plain(['--target', TARGET_MAC_ARM64, '--bundles', 'app']),
  'mac-universal': plain(['--target', TARGET_MAC_UNIVERSAL, '--bundles', 'app']),
  win: cross(['--runner', 'cross', '--target', TARGET_WIN, '--bundles', 'nsis']),
  'win-arm64': cross(['--runner', 'cargo-xwin', '--target', TARGET_WIN_ARM64, '--bundles', 'nsis']),
  'win-portable': cross(['--runner', 'cross', '--target', TARGET_WIN, '--no-bundle']),
  'win-arm64-portable': cross(['--runner', 'cargo-xwin', '--target', TARGET_WIN_ARM64, '--no-bundle']),
  linux: cross(['--runner', 'cross', '--target', TARGET_LINUX, '--bundles', 'deb', 'appimage', 'rpm']),
  'linux-arm64': cross(['--runner', 'cross', '--target', TARGET_LINUX_ARM64, '--bundles', 'deb', 'appimage', 'rpm']),
  android: mobile(['android', 'build']),
  ios: mobile(IOS_BUILD_ARGS),
  web: web(),
};
const QUICK_INIT = { linux: ['linux:init'], 'linux-arm64': ['linux:init'] };
const QUICK_PLATFORMS = ['desktop', 'mac', 'mac-arm64', 'mac-universal', 'win', 'win-arm64', 'win-portable', 'win-arm64-portable', 'linux', 'linux-arm64', 'android', 'ios', 'web'];
const QUICK_TASKS = QUICK_PLATFORMS.map((p) => ({
  id: `build-quick:${p}`,
  description: `build-quick ${p}`,
  dependsOn: QUICK_INIT[p] || [],
  conflicts: [CROSS_BUILD],
  run: { fn: QUICK_RUN[p] },
}));

// ---- collect:* 产物收集 ----
const COLLECT_PLATFORMS = ['win', 'win-arm64', 'win-portable', 'win-arm64-portable', 'mac', 'mac-arm64', 'mac-universal', 'linux', 'linux-arm64', 'android', 'ios', 'web'];
const COLLECT_TASKS = COLLECT_PLATFORMS.map((p) => ({
  id: `collect:${p}`,
  description: `collect ${p} artifacts`,
  dependsOn: [`build:${p}`],
  run: { fn: () => collectPlatform(p) },
}));

// ---- 聚合元任务 ----
const DESKTOP = ['win', 'win-arm64', 'mac', 'mac-arm64', 'mac-universal', 'linux', 'linux-arm64'];
const MOBILE = ['android', 'ios'];
const AGG_TASKS = [
  { id: 'build:desktop', description: 'build desktop all', dependsOn: DESKTOP.map((p) => `build:${p}`) },
  { id: 'build:mobile', description: 'build mobile', dependsOn: MOBILE.map((p) => `build:${p}`) },
  { id: 'build:all', description: 'build all', dependsOn: ['build:desktop', 'build:mobile'] },
  { id: 'collect:desktop', description: 'collect desktop artifacts', dependsOn: DESKTOP.map((p) => `collect:${p}`) },
  { id: 'collect:mobile', description: 'collect mobile artifacts', dependsOn: MOBILE.map((p) => `collect:${p}`) },
  { id: 'collect:all', description: 'collect all artifacts', dependsOn: ['collect:desktop', 'collect:mobile'] },
];

module.exports = [...ICON_TASKS, ...BUILD_TASKS, ...QUICK_TASKS, ...COLLECT_TASKS, ...AGG_TASKS];
