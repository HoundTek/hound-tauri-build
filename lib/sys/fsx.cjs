/**
 * @file 跨平台文件系统操作
 * @description 薄封装 Node fs API，替代 rm -rf / cp -r / rmdir 等 shell 命令，
 *   统一中文错误消息。所有内置任务的文件操作必须走这里，禁止拼接 shell。
 * @module lib/sys/fsx
 */

const fs = require('fs');

/**
 * 递归删除（等价 rm -rf）：不存在时不报错。
 * Windows 上文件可能被占用（杀毒/索引），带重试。
 * @param {string} p
 */
function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

/**
 * 递归复制（等价 cp -r）：src 为目录时复制整个目录内容到 dst。
 * @param {string} src
 * @param {string} dst
 */
function cp(src, dst) {
  fs.cpSync(src, dst, { recursive: true, force: true });
}

/**
 * 递归创建目录（等价 mkdir -p）：已存在时不报错。
 * @param {string} p
 * @returns {string} 返回 p（便于链式）
 */
function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/**
 * 路径是否存在。
 * @param {string} p
 * @returns {boolean}
 */
function exists(p) {
  return fs.existsSync(p);
}

/**
 * 目录是否为空（不存在视为空）。
 * @param {string} p
 * @returns {boolean}
 */
function isEmptyDir(p) {
  try {
    return fs.readdirSync(p).length === 0;
  } catch (_) {
    return true;
  }
}

module.exports = { rmrf, cp, mkdirp, exists, isEmptyDir };
