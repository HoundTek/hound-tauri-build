import { getTerminalSize } from '../utils/terminal-size.mjs';

const TOP_L = '\u256D';  const TOP_R = '\u256E';
const BOT_L = '\u2570';  const BOT_R = '\u256F';
const HORIZ = '\u2500';  const VERT  = '\u2502';

/** 返回包含当前终端大小的页面 */
export function makePage() {
  const { rows, columns } = getTerminalSize();
  const w = columns - 2;
  const h = rows - 2;

  const top    = TOP_L + HORIZ.repeat(w - 2) + TOP_R;
  const bottom = BOT_L + HORIZ.repeat(w - 2) + BOT_R;
  const text   = `width: ${columns}, height: ${rows}`;
  const padL   = Math.floor((w - 2 - text.length) / 2);
  const midRow = Math.floor((h - 2) / 2);

  const content = [''];
  content.push(top);
  for (let y = 1; y < h - 1; y++) {
    if (y === midRow) {
      const spaceR = w - 2 - padL - text.length;
      content.push(VERT + ' '.repeat(padL) + text + ' '.repeat(spaceR) + VERT);
    } else {
      content.push(VERT + ' '.repeat(w - 2) + VERT);
    }
  }
  content.push(bottom);

  return content;
}
