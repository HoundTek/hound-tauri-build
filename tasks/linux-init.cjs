/**
 * @file linux:init 任务
 * @description 初始化 Linux 交叉编译环境（复制 Cross.toml 和 Dockerfile 到 src-tauri/）。
 *              cross 工具需要 Cross.toml 来指定包含 GTK/WebKit 依赖的自定义 Docker 镜像。
 * @module scripts/build/tasks/linux-init
 */

const path = require('path');
const fs = require('fs');
const { getConfig } = require('../lib/config.cjs');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '../../..');
const PKG_DIR = path.resolve(__dirname, '..');

/**
 * 复制模板文件到 src-tauri/（已存在则跳过，不覆盖用户自定义配置）
 * @returns {boolean} 是否成功
 */
function initLinuxCross() {
  const tauriDir = getConfig().project.tauriDir || 'src-tauri';
  const srcTauriDir = path.join(ROOT_DIR, tauriDir);
  if (!fs.existsSync(srcTauriDir)) {
    console.warn('Warning: src-tauri/ not found — is this a Tauri project?');
    return false;
  }

  const templates = [
    { src: 'Cross.toml', dest: 'Cross.toml' },
    { src: 'Dockerfile.cross-linux', dest: 'Dockerfile.cross-linux' },
    { src: 'Dockerfile.cross-linux-arm64', dest: 'Dockerfile.cross-linux-arm64' },
    { src: 'Dockerfile.cross-windows', dest: 'Dockerfile.cross-windows' },
  ];

  for (const { src, dest } of templates) {
    const srcPath = path.join(PKG_DIR, 'templates', src);
    const destPath = path.join(srcTauriDir, dest);

    if (!fs.existsSync(srcPath)) {
      console.warn('Warning: template not found: ' + srcPath);
      return false;
    }

    if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
      console.log(`Created ${tauriDir}/${dest}`);
      continue;
    }

    // Cross.toml 已存在：合并模板中缺失的 [target.*] 段落（不覆盖用户配置）
    if (dest === 'Cross.toml') {
      const existing = fs.readFileSync(destPath, 'utf8');
      const tpl = fs.readFileSync(srcPath, 'utf8');
      const blocks = tpl.split(/(?=^\[target\.)/m).filter((b) => b.startsWith('[target.'));
      let appended = false;
      for (const block of blocks) {
        const header = block.split('\n', 1)[0].trim();
        if (!existing.includes(header)) {
          fs.appendFileSync(destPath, (existing.endsWith('\n') ? '\n' : '\n\n') + block.trimEnd() + '\n');
          console.log(`Appended ${header} to ${tauriDir}/${dest}`);
          appended = true;
        }
      }
      if (!appended) console.log(`${tauriDir}/${dest} already exists, skipping`);
      continue;
    }

    console.log(`${tauriDir}/${dest} already exists, skipping`);
  }

  return true;
}

module.exports = {
  id: 'linux:init',
  description: 'linux init',
  dependsOn: [],
  run: { fn: initLinuxCross },
};
