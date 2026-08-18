#!/usr/bin/env node
/**
 * @file hound-tauri-clean CLI
 * @description 清理构建产物：target / gen / icons / temp。
 *              设置 HOUND_BUILD_ROOT 为当前工作目录后委托 clean.cjs。
 * @module hound-tauri-build/bin/hound-tauri-clean
 */

const path = require('path');

// 将 HOUND_BUILD_ROOT 指向调用方项目根（当前工作目录）
if (!process.env.HOUND_BUILD_ROOT) {
  process.env.HOUND_BUILD_ROOT = process.cwd();
}

// 自动检测：优先本地副本，回退 monorepo 路径
let cleanPath;
try {
  cleanPath = require.resolve(path.join(__dirname, '..', 'clean.cjs'));
} catch {
  cleanPath = require.resolve(path.join(__dirname, '..', '..', 'build', 'clean.cjs'));
}

require(cleanPath);
