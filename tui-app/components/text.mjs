/**
 * @file 文本样式组件
 * @description 提供带 ANSI 样式的文本渲染能力，支持颜色、粗体、下划线等效果。
 *   薄封装：样式与宽度操作全部委托 term（lib/term）。
 * @module text
 */

import { term } from '../utils/term.mjs';

/**
 * 渲染带样式的文本，可选颜色、粗体、下划线、宽度填充
 * @param {string} content - 原始文本内容
 * @param {{ width?: number, color?: string, bold?: boolean, underline?: boolean, dim?: boolean }} [opts] - 样式选项
 * @returns {string}
 */
export function text(content, opts = {}) {
  let s = term.style;

  if (opts.color && typeof s[opts.color] === 'function') s = s[opts.color];
  if (opts.bold) s = s.bold;
  if (opts.underline) s = s.underline;
  if (opts.dim) s = s.dim;

  const styled = s(content);

  if (opts.width != null) return term.pad(styled, opts.width);
  return styled;
}
