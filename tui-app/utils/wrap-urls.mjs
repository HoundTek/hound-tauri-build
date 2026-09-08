/**
 * @file URL 检测与可点击链接包裹
 * @description 将 http/https/file 链接及文件路径用 OSC 8 序列包裹，使其在终端中可点击.
 * @module wrap-urls
 * @author hound-builder
 */

// 匹配 URL 及文件路径（全平台：Windows / macOS / Linux）
const URL_PATTERN = /(https?:\/\/[^\s\x07\x1b]+|file:\/{3}[^\s\x07\x1b]+|[A-Za-z]:[\\/][^\s\x07\x1b]*\.[a-zA-Z]{1,10}(?::\d+)?(?::\d+)?(?:[^\s\x07\x1b]*)?|\/[^\s\x07\x1b]*\.[a-zA-Z]{1,10}(?::\d+)?(?::\d+)?|\.\.[\\/][^\s\x07\x1b]*\.[a-zA-Z]{1,10}(?::\d+)?(?::\d+)?|\.[\\/][^\s\x07\x1b]*\.[a-zA-Z]{1,10}(?::\d+)?(?::\d+)?)/gi;

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
    // Unix 绝对路径已自带 /，避免 file://// 双斜杠
    const url = normalized.startsWith('/') ? 'file://' + normalized : 'file:///' + normalized;
    return '\x1b]8;;' + url + '\x07' + match + '\x1b]8;;\x07';
  });
}
