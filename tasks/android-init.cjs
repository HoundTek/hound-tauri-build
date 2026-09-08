/**
 * @file android:init 任务
 * @description 初始化 Android 项目。
 * @module scripts/build/tasks/android-init
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getConfig } = require('../lib/config.cjs');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '../../..');

/**
 * 清理旧的 Android 生成目录并重新初始化
 * @returns {boolean}
 */
function initAndroid() {
  const tauriDir = getConfig().project.tauriDir || 'src-tauri';
  const genDir = path.join(ROOT_DIR, tauriDir, 'gen', 'android');
  if (fs.existsSync(genDir)) {
    fs.rmSync(genDir, { recursive: true, force: true });
  }
  execSync('yarn init:android', { cwd: ROOT_DIR, stdio: 'inherit' });
  return true;
}

module.exports = {
  id: 'android:init',
  description: 'android init',
  dependsOn: [],
  conflicts: [
    { resource: 'resource:tauri-cli', mode: 'write' },
    { resource: 'resource:gen-android', mode: 'write' },
  ],
  run: { fn: initAndroid },
};
