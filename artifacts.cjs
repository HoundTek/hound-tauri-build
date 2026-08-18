/**
 * @file 构建产物收集
 * @description 将各平台构建产物统一拷贝到 artifacts.output（默认 dist/）下、按平台分目录。
 *              产物路径 / 输出目录来自统一配置（htb.default.json → htb.config.json → --set），
 *              可用 --set artifacts.output=xxx --set artifacts.platforms.win.patterns=[...] 覆盖。
 */

const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config.cjs');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '..');

/**
 * 简单 glob 匹配：支持 `**`（跨任意层级）与 `*`（单段内通配）。
 * @param {string} dir - 起始绝对目录
 * @param {string[]} parts - 模式按 '/' 分段后的数组
 * @returns {string[]} 匹配到的绝对路径
 */
function matchParts(dir, parts) {
  if (parts.length === 0) return [dir];
  const [head, ...rest] = parts;
  const results = [];

  if (head === '**') {
    // 不消费任何目录
    results.push(...matchParts(dir, rest));
    // 逐层消费目录
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        results.push(...matchParts(path.join(dir, entry.name), parts));
      }
    }
    return results;
  }

  const re = new RegExp('^' + head.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!re.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (rest.length === 0) {
      results.push(full);
    } else if (entry.isDirectory()) {
      results.push(...matchParts(full, rest));
    }
  }
  return results;
}

/**
 * 收集指定平台的构建产物到输出目录（artifacts.output/<platform.dir>）。
 * 每次先清空该平台目录，避免残留陈旧文件。
 * @param {string} platform - win / linux / mac / mac-universal / android / ios
 * @returns {boolean} 是否成功拷贝到至少 1 个产物
 */
function collectPlatform(platform) {
  const cfg = getConfig().artifacts;
  const plat = cfg && cfg.platforms && cfg.platforms[platform];
  if (!plat || !Array.isArray(plat.patterns) || plat.patterns.length === 0) {
    console.warn(`No artifacts config for platform: ${platform}`);
    return false;
  }

  const output = cfg.output || 'dist';
  const outRoot = path.resolve(ROOT_DIR, output);
  // 防御：拒绝把输出指到项目根或文件系统根
  if (outRoot === ROOT_DIR || path.dirname(outRoot) === outRoot) {
    console.warn(`Refusing unsafe artifacts.output: ${output}`);
    return false;
  }

  const outDir = path.join(outRoot, plat.dir || platform);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  let count = 0;
  for (const pattern of plat.patterns) {
    let matches;
    try {
      matches = pattern.startsWith('/')
        ? matchParts(path.parse(pattern).root, pattern.replace(/^\/+/, '').split('/'))
        : matchParts(ROOT_DIR, pattern.split('/'));
    } catch (_) {
      continue; // 目录不存在等，跳过该模式
    }

    for (const m of matches) {
      const dest = path.join(outDir, path.basename(m));
      fs.cpSync(m, dest, { recursive: true, force: true });
      console.log(`  ${path.relative(ROOT_DIR, m)} -> ${path.relative(ROOT_DIR, dest)}`);
      count++;
    }
  }

  if (count === 0) {
    console.warn(`No artifacts found for ${platform} (patterns: ${plat.patterns.join(', ')})`);
    return false;
  }

  console.log(`Collected ${count} artifact(s) -> ${path.relative(ROOT_DIR, outDir)}/`);
  return true;
}

module.exports = { collectPlatform };
