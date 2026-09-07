// 日志空间组件（圆角矩形边框的区域）

import { textWidth } from '../utils/text-width.mjs';
import { padLine } from '../utils/ansi.mjs';
import { theme } from '../utils/theme.mjs';

const TL = '\u256D'; const TR = '\u256E';
const BL = '\u2570'; const BR = '\u256F';
const HZ = '\u2500'; const VT = '\u2502';

/** 给边框行加灰色 */
function border(s) { return theme.info + s + theme.fgDefault; }

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
    || content.some((l) => textWidth(l) > innerW)
    || content.length > innerH;
  if (overflow) {
    const rows = [];
    rows.push(border(TL + HZ.repeat(innerW) + TR));
    const msg = 'Overflow';
    const padL = Math.max(0, Math.floor((innerW - textWidth(msg)) / 2));
    for (let y = 0; y < innerH; y++) {
      if (y === Math.floor(innerH / 2)) {
        rows.push(theme.info + VT + theme.fgDefault + theme.dangerBold + theme.rev + padLine(' '.repeat(padL) + msg, innerW) + theme.revOff + theme.reset + theme.info + VT + theme.fgDefault);
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
    const line = y < content.length ? padLine(content[y], innerW) : ' '.repeat(innerW);
    rows.push(theme.info + VT + theme.fgDefault + line + theme.info + VT + theme.fgDefault);
  }
  rows.push(border(BL + HZ.repeat(innerW) + BR));
  return rows;
}
