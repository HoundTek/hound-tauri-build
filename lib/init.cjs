/**
 * @file htb init 命令
 * @description 生成 htb.config.json 项目配置文件，扫描项目结构自动填充默认值。
 * @module hound-tauri-build/init
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '..');

/**
 * 扫描项目结构，推断合理默认值
 * @returns {object} 推断出的配置片段
 */
function detectProject() {
  const hints = {};

  // 检测 tauriDir
  for (const candidate of ['src-tauri', 'tauri', 'src/tauri']) {
    const confPath = path.join(ROOT_DIR, candidate, 'tauri.conf.json');
    if (fs.existsSync(confPath)) {
      hints.tauriDir = candidate;
      try {
        const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
        if (conf.package?.productName) hints.productName = conf.package.productName;
        if (conf.identifier) hints.identifier = conf.identifier;
      } catch (_) { /* ignore parse errors */ }
      break;
    }
  }

  // 检测 frontendDir（前端产物目录，含 index.html 的构建输出）
  for (const candidate of ['dist', 'build', 'out']) {
    const idxPath = path.join(ROOT_DIR, candidate, 'index.html');
    if (fs.existsSync(idxPath)) {
      hints.frontendDir = candidate;
      break;
    }
  }

  // 检测 keysDir
  if (fs.existsSync(path.join(ROOT_DIR, 'keys'))) {
    hints.keysDir = 'keys';
  }

  // 检测 iconsDir
  if (fs.existsSync(path.join(ROOT_DIR, 'icons'))) {
    hints.iconsDir = 'icons';
  }

  return hints;
}

/**
 * 生成 htb.config.json 内容
 * @param {object} overrides - 用户指定的覆盖值
 * @returns {object} 配置对象
 */
function generateConfig(overrides = {}) {
  const hints = detectProject();

  const config = {
    project: {
      tauriDir: overrides.tauriDir || hints.tauriDir || 'src-tauri',
      frontendDir: overrides.frontendDir || hints.frontendDir || '',
      keysDir: overrides.keysDir || hints.keysDir || 'keys',
      iconsDir: overrides.iconsDir || hints.iconsDir || 'icons',
      productName: overrides.productName || hints.productName || '',
    },
  };

  // 仅保留非默认值（用户显式指定或自动检测到的）
  return config;
}

/**
 * 执行 htb init 命令
 * @param {string[]} args - CLI 参数（支持 --tauri-dir, --frontend-dir, --keys-dir, --icons-dir, --product-name, --force）
 * @returns {boolean} 是否成功
 */
function runInit(args) {
  const overrides = {};
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--tauri-dir') { overrides.tauriDir = args[++i]; continue; }
    if (a.startsWith('--tauri-dir=')) { overrides.tauriDir = a.slice('--tauri-dir='.length); continue; }
    if (a === '--frontend-dir') { overrides.frontendDir = args[++i]; continue; }
    if (a.startsWith('--frontend-dir=')) { overrides.frontendDir = a.slice('--frontend-dir='.length); continue; }
    if (a === '--keys-dir') { overrides.keysDir = args[++i]; continue; }
    if (a.startsWith('--keys-dir=')) { overrides.keysDir = a.slice('--keys-dir='.length); continue; }
    if (a === '--icons-dir') { overrides.iconsDir = args[++i]; continue; }
    if (a.startsWith('--icons-dir=')) { overrides.iconsDir = a.slice('--icons-dir='.length); continue; }
    if (a === '--product-name') { overrides.productName = args[++i]; continue; }
    if (a.startsWith('--product-name=')) { overrides.productName = a.slice('--product-name='.length); continue; }
    if (a === '--force' || a === '-f') { force = true; continue; }
  }

  const configPath = path.join(ROOT_DIR, 'htb.config.json');

  if (fs.existsSync(configPath) && !force) {
    console.error(`htb.config.json already exists. Use --force to overwrite.`);
    return false;
  }

  const config = generateConfig(overrides);

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  console.log(`Created ${path.relative(ROOT_DIR, configPath) || 'htb.config.json'}`);

  // 报告检测结果
  const p = config.project;
  const detected = [];
  if (p.tauriDir !== 'src-tauri') detected.push(`tauriDir: ${p.tauriDir}`);
  if (p.frontendDir) detected.push(`frontendDir: ${p.frontendDir}`);
  if (p.productName) detected.push(`productName: ${p.productName}`);
  if (detected.length > 0) {
    console.log('Auto-detected:', detected.join(', '));
  }

  return true;
}

module.exports = { runInit, detectProject, generateConfig };
