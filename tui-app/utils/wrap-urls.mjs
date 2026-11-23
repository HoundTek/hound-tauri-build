/**
 * @file URL 检测与可点击链接包裹
 * @description 将 http/https/file 链接及文件路径用 OSC 8 序列包裹，使其在终端中可点击.
 * @module wrap-urls
 * @author hound-builder
 */

import fs from 'fs';
import path from 'path';

// 匹配 URL 及文件路径（全平台：Windows / macOS / Linux）
const URL_PATTERN = /(https?:\/\/[^\s\x07\x1b]+|file:\/{3}[^\s\x07\x1b]+|[A-Za-z]:[\\/][^\s\x07\x1b]*\.[a-zA-Z]{1,10}(?::\d+)?(?::\d+)?(?:[^\s\x07\x1b]*)?|\/[^\s\x07\x1b]*\.[a-zA-Z]{1,10}(?::\d+)?(?::\d+)?|\.\.[\\/][^\s\x07\x1b]*\.[a-zA-Z]{1,10}(?::\d+)?(?::\d+)?|\.[\\/][^\s\x07\x1b]*\.[a-zA-Z]{1,10}(?::\d+)?(?::\d+)?)/gi;

/** 路径解析缓存（wrapUrls 每帧对可见日志调用，避免重复 stat） */
const resolveCache = new Map();

/**
 * 将以 / 开头的匹配解析为绝对路径。
 * 构建日志中的相对路径（如 icons/icon.png）会从中间的 / 开始匹配（匹配为 /icon.png），
 * 若按字面解析会丢失目录前缀；不存在时回退到项目根（TUI 进程 cwd）拼接。
 * @param {string} p - 匹配到的路径（已统一为正斜杠）
 * @returns {string} 解析后的绝对路径
 */
function resolveAbsPath(p) {
  let cached = resolveCache.get(p);
  if (cached === undefined) {
    cached = fs.existsSync(p) ? p : path.resolve(process.cwd(), p.slice(1));
    resolveCache.set(p, cached);
    if (resolveCache.size > 512) resolveCache.clear();
  }
  return cached;
}

/**
 * 将文本中的 URL 及文件路径用 OSC 8 序列包裹，使其可点击
 * @description 先剥离已有的 OSC 8 序列，再用统一格式重新包裹.
 * @param {string} text - 待处理的原始文本
 * @returns {string} 包含 OSC 8 超链接序列的文本
 */
export function wrapUrls(text) {
  // 去除已有的 OSC 8 序列（BEL 或 ST 终止）
  const cleaned = text.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\].*?\x1b\\/g, '');
  // 用 OSC 8 包裹检测到的 URL / 文件路径
  return cleaned.replace(URL_PATTERN, function(match) {
    if (/^https?:\/\//i.test(match) || /^file:\/{3}/i.test(match)) {
      // 已有协议前缀，直接使用
      return '\x1b]8;;' + match + '\x07' + match + '\x1b]8;;\x07';
    }
    // 文件路径 → 转为 file:/// URL，反斜杠转正斜杠
    const normalized = match.replace(/\\/g, '/');
    if (normalized.startsWith('/')) {
      // 绝对路径 / 日志相对路径（从中间 / 开始匹配）→ 解析到磁盘真实路径
      return '\x1b]8;;file://' + resolveAbsPath(normalized) + '\x07' + match + '\x1b]8;;\x07';
    }
    // ./ ../ 相对路径 → 相对项目根解析
    return '\x1b]8;;file://' + path.resolve(process.cwd(), normalized) + '\x07' + match + '\x1b]8;;\x07';
  });
}
