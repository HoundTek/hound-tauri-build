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

// 图标生成器入口（lib/ 下的 gen-icons.cjs）
const GEN_CMD = `node "${path.join(__dirname, '..', 'lib', 'gen-icons.cjs')}"`;

// iOS 构建配置（来自统一配置，HTB_* 环境变量由 config.cjs 扁平化产生）：
//   ios.target: "sim" —— 构建模拟器（tauri ios build --target aarch64-sim）
//   ios.sign:   false —— 跳过代码签名（tauri ios build --no-sign）
const IOS_TARGET = process.env.HTB_IOS_TARGET === 'sim' ? ' --target aarch64-sim' : '';
const IOS_NO_SIGN = process.env.HTB_IOS_SIGN === 'false' ? ' --no-sign' : '';

// 交叉编译通用命令：临时前端产物目录 + tauri build（--runner cross）+ 事后清理
const CROSS_CMD = (target, extra = '') =>
  `rm -rf src-tauri/.htb-frontend-dist && cp -r src src-tauri/.htb-frontend-dist && tauri build --runner cross --target ${target}${extra ? ' ' + extra : ''} --config '{"build":{"frontendDist":"./.htb-frontend-dist"}}'; code=$?; rm -rf src-tauri/.htb-frontend-dist; exit $code`;

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
const BUILD_CMD = {
  win: CROSS_CMD('x86_64-pc-windows-gnu', '--bundles nsis'),
  mac: 'tauri build --target x86_64-apple-darwin --bundles app',
  'mac-universal': 'tauri build --target universal-apple-darwin --bundles app',
  linux: CROSS_CMD('x86_64-unknown-linux-gnu'),
  android: 'tauri android build',
  ios: `tauri ios build${IOS_TARGET}${IOS_NO_SIGN}`,
};
// 构建前置：平台专属初始化（在 icon 之后执行）
const BUILD_EXTRA_INIT = {
  linux: ['linux:init'],
  android: ['android:signing'],
  ios: ['ios:init'],
};
// 图标依赖：mac-universal 复用 mac 图标（无独立 icon:mac-universal）
const BUILD_ICON_DEP = { 'mac-universal': 'icon:mac' };
const BUILD_PLATFORMS = ['win', 'mac', 'mac-universal', 'linux', 'android', 'ios'];
const BUILD_TASKS = BUILD_PLATFORMS.map((p) => ({
  id: `build:${p}`,
  description: `build ${p}`,
  dependsOn: [BUILD_ICON_DEP[p] || `icon:${p}`, ...(BUILD_EXTRA_INIT[p] || [])],
  conflicts: [CROSS_BUILD],
  run: { cmd: BUILD_CMD[p] },
}));

// ---- build-quick:* 快速构建（跳过图标/初始化） ----
const QUICK_CMD = {
  desktop: 'tauri build',
  mac: 'tauri build --bundles app',
  'mac-universal': 'tauri build --target universal-apple-darwin --bundles app',
  win: CROSS_CMD('x86_64-pc-windows-gnu', '--bundles nsis'),
  linux: CROSS_CMD('x86_64-unknown-linux-gnu', '--bundles deb appimage rpm'),
  android: 'tauri android build',
  ios: `tauri ios build${IOS_TARGET}${IOS_NO_SIGN}`,
};
const QUICK_INIT = { linux: ['linux:init'] };
const QUICK_PLATFORMS = ['desktop', 'mac', 'mac-universal', 'win', 'linux', 'android', 'ios'];
const QUICK_TASKS = QUICK_PLATFORMS.map((p) => ({
  id: `build-quick:${p}`,
  description: `build-quick ${p}`,
  dependsOn: QUICK_INIT[p] || [],
  conflicts: [CROSS_BUILD],
  run: { cmd: QUICK_CMD[p] },
}));

// ---- collect:* 产物收集 ----
const COLLECT_PLATFORMS = ['win', 'mac', 'mac-universal', 'linux', 'android', 'ios'];
const COLLECT_TASKS = COLLECT_PLATFORMS.map((p) => ({
  id: `collect:${p}`,
  description: `collect ${p} artifacts`,
  dependsOn: [`build:${p}`],
  run: { fn: () => collectPlatform(p) },
}));

// ---- 聚合元任务 ----
const DESKTOP = ['win', 'mac', 'mac-universal', 'linux'];
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
