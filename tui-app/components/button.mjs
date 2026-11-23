/**
 * @file 按钮渲染组件
 * @description 提供 [Label] 格式的按钮渲染，支持 active/inactive 样式与自定义颜色。
 * @module components/button
 * @author hound-builder
 */

import { term } from '../utils/term.mjs';
import { theme } from '../utils/theme.mjs';

/**
 * 渲染带方括号的按钮文本
 * @param {string} label 按钮标签文字
 * @param {{ active?: boolean, width?: number, color?: string }} [opts] 可选配置项
 * @returns {string} 带 ANSI 样式的按钮文本
 */
export function button(label, opts = {}) {
  const active = opts.active !== false;
  const inner = `[${label}]`;
  let s = '';

  if (opts.color && !active) {
    s += theme.dim;
  } else if (opts.color) {
    s += opts.color;
  } else if (!active) {
    s += theme.dim;
  }

  s += inner;
  if (!active || opts.color) s += theme.reset;

  if (opts.width != null) {
    const need = opts.width - term.width(inner);
    if (need > 0) s += ' '.repeat(need);
  }

  return s;
}
