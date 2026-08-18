#!/usr/bin/env node
/**
 * @file hound-tauri-icon CLI
 * @description 图标生成工具，支持两阶段（generate + copy）和平台选择。
 *              设置 HOUND_BUILD_ROOT 为当前工作目录后委托 gen-icons.cjs。
 * @module hound-tauri-build/bin/hound-tauri-icon
 */

const path = require('path');

// 将 HOUND_BUILD_ROOT 指向调用方项目根（当前工作目录）
if (!process.env.HOUND_BUILD_ROOT) {
  process.env.HOUND_BUILD_ROOT = process.cwd();
}

// 自动检测：优先本地副本，回退 monorepo 路径
let iconPath;
try {
  iconPath = require.resolve(path.join(__dirname, '..', 'gen-icons.cjs'));
} catch {
  iconPath = require.resolve(path.join(__dirname, '..', '..', 'build', 'gen-icons.cjs'));
}

require(iconPath);
