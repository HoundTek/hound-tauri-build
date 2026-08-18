#!/usr/bin/env node
/**
 * @file hound-tauri-build CLI
 * @description 构建命令入口：dev / build / build-quick / ship / icon。
 *              设置 HOUND_BUILD_ROOT 为当前工作目录后委托 build-entry.cjs。
 * @module hound-tauri-build/bin/hound-tauri-build
 */

const path = require('path');

// 将 HOUND_BUILD_ROOT 指向调用方项目根（当前工作目录）
if (!process.env.HOUND_BUILD_ROOT) {
  process.env.HOUND_BUILD_ROOT = process.cwd();
}

// 自动检测：优先本地副本，回退 monorepo 路径
let entryPath;
try {
  entryPath = require.resolve(path.join(__dirname, '..', 'build-entry.cjs'));
} catch {
  entryPath = require.resolve(path.join(__dirname, '..', '..', 'build', 'build-entry.cjs'));
}

require(entryPath);
