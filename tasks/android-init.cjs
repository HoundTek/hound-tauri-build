/**
 * @file android:init 任务
 * @description 初始化 Android 项目。
 * @module scripts/build/tasks/android-init
 */

const fs = require('fs');
const path = require('path');
const { getConfig } = require('../lib/config.cjs');
const { runTauri } = require('../lib/tauri-cli.cjs');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '../../..');

/**
 * 清理旧的 Android 生成目录并重新初始化。
 * 直接调用 Tauri CLI（lib/tauri-cli.cjs），不依赖宿主项目的 package.json scripts。
 * @param {{ log?: (text: string) => void }} [ctx]
 * @returns {Promise<boolean>}
 */
async function initAndroid(ctx) {
  const tauriDir = getConfig().project.tauriDir || 'src-tauri';
  const genDir = path.join(ROOT_DIR, tauriDir, 'gen', 'android');
  if (fs.existsSync(genDir)) {
    fs.rmSync(genDir, { recursive: true, force: true });
  }
  const r = await runTauri(['android', 'init'], { onLine: ctx && ctx.log });
  for (const g of r.guides) if (ctx && ctx.log) ctx.log(`[hint] ${g}`);
  return r.ok;
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
