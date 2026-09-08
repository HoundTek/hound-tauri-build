/**
 * @file 文本换行工具
 * @description 对含 ANSI 转义序列和全角字符的文本进行按宽度换行，支持超链接状态追踪。
 * @module wrap-line
 * @author hound-builder
 */

import { charWidth } from './char-width.mjs';
import { skipAnsi } from './ansi.mjs';

/**
 * 文本换行函数，支持 ANSI/CSI/OSC/BEL/ST/DCS/PM/APC 控制符、全角字符和中文字符
 * @param {string} text - 待换行的文本
 * @param {number} width - 换行宽度
 * @returns {string[]} 换行后的文本数组
 */
export function wrapLine(text, width) {

  const lines = [];
  let cur = '';
  let curW = 0;
  let i = 0;
  let sgr = '';
  let oscUrl = null;  // 当前活跃的 OSC 8 超链接 URL，null 表示不在超链接内

  function pad() {
    const need = width - curW;
    if (need > 0) cur += ' '.repeat(need);
    curW = width;
  }

  function breakLine() {
    if (oscUrl) cur += '\x1b]8;;\x07';  // 行尾关闭超链接
    if (sgr) cur += '\x1b[0m';
    pad();
    lines.push(cur);
    cur = sgr;
    if (oscUrl) cur += '\x1b]8;;' + oscUrl + '\x07';  // 下行开头重新打开超链接
    curW = 0;
  }

  while (i < text.length) {
    // BEL
    if (text[i] === '\x07') { cur += '\x07'; i++; continue; }

    // ESC 序列
    if (text[i] === '\x1b') {
      const start = i;
      i = skipAnsi(text, i);
      const seq = text.slice(start, i);

      // OSC 序列解析：追踪 OSC 8 超链接状态
      if (seq.startsWith('\x1b]')) {
        const m = seq.match(/^\x1b\]8;[^;\x07]*;([^\x07]*)\x07$/);
        if (m) oscUrl = m[1] || null;  // 空 URL 表示关闭超链接
        cur += seq;
        continue;
      }

      // SGR 序列追踪活跃样式
      if (/^\x1b\[\d*(;\d+)*m$/.test(seq)) {
        sgr = (seq === '\x1b[0m' || seq === '\x1b[m') ? '' : seq;
      }
      cur += seq;
      continue;
    }

    const c = text[i];
    const w = charWidth(c);

    if (curW + w > width) {
      if (curW > 0) breakLine();
      // 单个字符宽度超过行长，强制放置
    }

    cur += c;
    curW += w;
    i++;
  }

  if (cur.length > 0) {
    if (oscUrl) cur += '\x1b]8;;\x07';  // 收尾关闭未闭合的超链接
    pad();
    lines.push(cur);
  }

  return lines;
}
