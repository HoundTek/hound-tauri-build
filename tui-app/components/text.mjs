/**
 * @file 文本样式组件
 * @description 提供带 ANSI 样式的文本渲染能力，支持颜色、粗体、下划线等效果。
 * @module text
 * @author hound-builder
 */

import { ansiWidth as textWidth, ansiTruncate } from '../utils/ansi.mjs';

/**
 * ANSI 重置序列，仅重置前景色、粗细和下划线，保留背景色
 * @type {string}
 */
const RST = '\x1b[39;22;24m';

/**
 * 文本样式 ANSI 转义码映射
 * @type {Record<string, string>}
 */
const STYLES = {
  bold: '\x1b[1m',
  underline: '\x1b[4m',
  dim: '\x1b[2m',
};

/**
 * 前景色 ANSI 转义码映射
 * @type {Record<string, string>}
 */
const COLORS = {
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
  white: '\x1b[37m', gray: '\x1b[90m',
};

/**
 * 渲染带样式的文本，可选颜色、粗体、下划线、宽度填充
 * @param {string} content - 原始文本内容
 * @param {{ width?: number, color?: string, bold?: boolean, underline?: boolean, dim?: boolean }} [opts] - 样式选项
 * @returns {string}
 */
export function text(content, opts = {}) {
  let s = '';

  if (opts.color && COLORS[opts.color]) s += COLORS[opts.color];
  if (opts.bold) s += STYLES.bold;
  if (opts.underline) s += STYLES.underline;
  if (opts.dim) s += STYLES.dim;

  s += content;

  if (s !== content) s += RST;

  if (opts.width != null) {
    const need = opts.width - textWidth(content);
    if (need > 0) s += ' '.repeat(need);
    else if (need < 0) s = ansiTruncate(s, opts.width);
  }

  return s;
}
