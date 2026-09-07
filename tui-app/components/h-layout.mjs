// 单行布局：将多个组件水平排列到一行，返回渲染行及每个 slot 的 x 位置

import { ansiWidth as textWidth, ansiTruncate } from '../utils/ansi.mjs';

/**
 * @param {Array<{ text: string, width: number }>} items
 * @param {number} totalWidth
 * @returns {{ line: string, slots: Array<{ x: number, width: number }> }}
 */
export function hLayout(items, totalWidth) {
  let line = '';
  const slots = [];
  for (const item of items) {
    const x = textWidth(line);
    if (x >= totalWidth) break; // 已满

    const avail = totalWidth - x;
    const fit = Math.min(item.width, avail);
    const clipped = fit < item.width ? ansiTruncate(item.text, fit) : item.text;

    line += clipped;
    const actualW = textWidth(clipped);
    const pad = fit - actualW;
    if (pad > 0) line += ' '.repeat(pad);

    slots.push({ x, width: fit });
  }
  const rest = totalWidth - textWidth(line);
  if (rest > 0) line += ' '.repeat(rest);
  return { line, slots };
}
