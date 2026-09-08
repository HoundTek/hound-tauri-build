/**
 * @file 字符显示宽度计算
 * @description 提供字符显示宽度计算函数，供 textWidth 和 wrapLine 使用。
 * @module char-width
 * @author hound-builder
 */

/**
 * 计算单个字符的显示宽度
 * @param {string} c - 需要计算宽度的字符
 * @returns {number} 字符显示宽度，半角字符返回 1，全角字符返回 2，控制字符返回 0
 */
export function charWidth(c) {
  const code = c.codePointAt(0);
  // 控制字符 (0x00-0x1F, 0x7F) 不占显示宽度
  if (code < 0x20 || code === 0x7F) return 0;
  if (code >= 0x1100 && code <= 0x115F) return 2;
  if (code >= 0x2E80 && code <= 0xA4CF) return 2;
  if (code >= 0xAC00 && code <= 0xD7AF) return 2;
  if (code >= 0xF900 && code <= 0xFAFF) return 2;
  if (code >= 0xFE10 && code <= 0xFE19) return 2;
  if (code >= 0xFE30 && code <= 0xFE6F) return 2;
  if (code >= 0xFF01 && code <= 0xFF60) return 2;
  if (code >= 0xFFE0 && code <= 0xFFE6) return 2;
  if (code >= 0x1F300 && code <= 0x1F9FF) return 2;
  return 1;
}
