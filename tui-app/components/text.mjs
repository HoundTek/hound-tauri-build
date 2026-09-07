// 文本组件：带样式的文本渲染

import { ansiWidth as textWidth, ansiTruncate } from '../utils/ansi.mjs';

const RST = '\x1b[39;22;24m';  // 只重置前景色+粗细+下划线，保留背景
const STYLES = {
  bold: '\x1b[1m',
  underline: '\x1b[4m',
  dim: '\x1b[2m',
};

const COLORS = {
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
  white: '\x1b[37m', gray: '\x1b[90m',
};

/**
 * @param {string} content
 * @param {{ width?: number, color?: string, bold?: boolean, underline?: boolean, dim?: boolean }} [opts]
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
