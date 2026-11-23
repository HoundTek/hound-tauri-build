/**
 * @file 水平布局组件
 * @description 将多个组件水平排列到一行，返回渲染行及每个 slot 的 x 位置。
 * @module h-layout
 * @author hound-builder
 */

import { term } from '../utils/term.mjs';

/**
 * 将多个子项水平排列到指定宽度的一行中
 * @param {Array<{ text: string, width: number }>} items
 * @param {number} totalWidth
 * @returns {{ line: string, slots: Array<{ x: number, width: number }> }}
 */
export function hLayout(items, totalWidth) {
  let line = '';
  const slots = [];
  for (const item of items) {
    const x = term.width(line);
    if (x >= totalWidth) break; // 已满

    const avail = totalWidth - x;
    const fit = Math.min(item.width, avail);
    const clipped = fit < item.width ? term.truncate(item.text, fit) : item.text;

    line += clipped;
    const actualW = term.width(clipped);
    const pad = fit - actualW;
    if (pad > 0) line += ' '.repeat(pad);

    slots.push({ x, width: fit });
  }
  const rest = totalWidth - term.width(line);
  if (rest > 0) line += ' '.repeat(rest);
  return { line, slots };
}
