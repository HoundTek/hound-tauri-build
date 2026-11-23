/**
 * @file ios:init 任务
 * @description 初始化 iOS 项目。
 * @module scripts/build/tasks/ios-init
 */

const fs = require('fs');
const path = require('path');
const { getConfig } = require('../lib/config.cjs');
const { runTauri } = require('../lib/tauri-cli.cjs');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '../../..');

/**
 * 清理旧的 iOS 生成目录并重新初始化。
 * 直接调用 Tauri CLI（lib/tauri-cli.cjs），不依赖 PATH 中的裸 tauri 命令。
 * @param {{ log?: (text: string) => void }} [ctx]
 * @returns {Promise<boolean>}
 */
async function initIos(ctx) {
  const tauriDir = getConfig().project.tauriDir || 'src-tauri';
  const genDir = path.join(ROOT_DIR, tauriDir, 'gen', 'apple');
  if (fs.existsSync(genDir)) {
    fs.rmSync(genDir, { recursive: true, force: true });
  }
  const r = await runTauri(['ios', 'init'], { onLine: ctx && ctx.log });
  for (const g of r.guides) if (ctx && ctx.log) ctx.log(`[hint] ${g}`);
  return r.ok;
}

module.exports = {
  id: 'ios:init',
  description: 'ios init',
  dependsOn: [],
  conflicts: [
    { resource: 'resource:tauri-cli', mode: 'write' },
    { resource: 'resource:gen-ios', mode: 'write' },
  ],
  run: { fn: initIos },
};
