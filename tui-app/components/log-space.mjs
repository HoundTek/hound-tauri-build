/**
 * @file 日志空间组件
 * @description 渲染带圆角矩形边框的日志显示区域，支持溢出检测和居中提示。
 * @module log-space
 * @author hound-builder
 */

import { term } from '../utils/term.mjs';
import { theme } from '../utils/theme.mjs';

const TL = '\u256D'; const TR = '\u256E';
const BL = '\u2570'; const BR = '\u256F';
const HZ = '\u2500'; const VT = '\u2502';

/**
 * 给边框字符串添加灰色主题色
 * @param {string} s - 原始边框字符串
 * @returns {string} 带灰色样式的边框字符串
 */
function border(s) { return theme.info + s + theme.fgDefault; }

/**
 * 渲染带圆角矩形边框的日志空间
 * @param {number} width - 区域总宽度
 * @param {number} height - 区域总高度
 * @param {string[]} content - 要显示的文本行数组
 * @returns {string[]} 渲染后的行数组
 */
export function logSpace(width, height, content) {
  if (width < 2 || height < 2) {
    // 空间不足，返回空行
    const rows = [];
    for (let y = 0; y < Math.max(0, height); y++) rows.push(' '.repeat(Math.max(0, width)));
    return rows;
  }

  const innerW = width - 2;
  const innerH = height - 2;

  const overflow = innerW < 1
    || content.some((l) => term.width(l) > innerW)
    || content.length > innerH;
  if (overflow) {
    const rows = [];
    rows.push(border(TL + HZ.repeat(innerW) + TR));
    const msg = 'Overflow';
    const padL = Math.max(0, Math.floor((innerW - term.width(msg)) / 2));
    for (let y = 0; y < innerH; y++) {
      if (y === Math.floor(innerH / 2)) {
        rows.push(theme.info + VT + theme.fgDefault + theme.dangerBold + theme.rev + term.pad(' '.repeat(padL) + msg, innerW) + theme.revOff + theme.reset + theme.info + VT + theme.fgDefault);
      } else {
        rows.push(border(VT + ' '.repeat(innerW) + VT));
      }
    }
    rows.push(border(BL + HZ.repeat(innerW) + BR));
    return rows;
  }

  const rows = [];
  rows.push(border(TL + HZ.repeat(innerW) + TR));
  for (let y = 0; y < innerH; y++) {
    const line = y < content.length ? term.pad(content[y], innerW) : ' '.repeat(innerW);
    rows.push(theme.info + VT + theme.fgDefault + line + theme.info + VT + theme.fgDefault);
  }
  rows.push(border(BL + HZ.repeat(innerW) + BR));
  return rows;
}
