// 滚动组件
/*
参数：
高度number
宽度number
内容[string]
显示的最大索引number
逻辑：
如果内容宽度大于宽度，返回[
// 宽*高 的完整矩形，中间内容居中："Width overflow"
]
如果内容高度等于高度，返回[
// 宽*高 的完整矩形，原始内容，后面补充空格
]
如果内容高度大于高度，返回[
// 宽*(高-1) 的完整矩形，原始内容的显示范围（显示的最小索引到显示的最大索引），后面补充空格
// `- ${显示的最小索引 + 1}-${显示的最大索引 + 1} / ${内容高度}` + 后面补充空格
]（显示的最小索引用（高-1）和显示的最大索引算出）
如果内容高度小于高度，返回[
// 宽*高 的完整矩形，原始内容，后面补充空格
// 下面补充空格
]
*/

import { on, off } from '../utils/events.mjs';
import { textWidth } from '../utils/text-width.mjs';
import { charWidth } from '../utils/char-width.mjs';
import { statusBar } from './status-bar.mjs';

function padLine(text, width) {
  const need = width - textWidth(text);
  if (need >= 0) return text + ' '.repeat(need);
  // 按显示宽度安全截断（不切 ANSI 码），截断后补 RST
  let w = 0;
  let i = 0;
  let hasSGR = false;
  while (i < text.length) {
    if (text[i] === '\x07') { i++; continue; }
    if (text[i] === '\x1b') {
      const escStart = i;
      i++;
      // OSC 序列: ESC ] ... (BEL 或 ST 终止)
      if (text[i] === ']') {
        i++;
        while (i < text.length && text[i] !== '\x07') {
          if (text[i] === '\x1b' && i + 1 < text.length && text[i + 1] === '\\') { i += 2; break; }
          i++;
        }
        if (i < text.length && text[i] === '\x07') i++;
        continue;
      }
      if ('[P_^'.includes(text[i])) i++;
      while (i < text.length && (text[i] < '\x40' || text[i] > '\x7e')) i++;
      if (i < text.length) i++;
      if (text.slice(escStart, i).match(/\x1b\[[\d;]*m/)) hasSGR = true;
      continue;
    }
    const cw = charWidth(text[i]);
    if (w + cw > width) break;
    w += cw;
    i++;
  }
  const truncated = text.slice(0, i);
  if (i < text.length && hasSGR) return truncated + '\x1b[0m';
  return truncated;
}

export function scroll(height, width, content, maxIndex, cursorLine, statusExtra, statusPrefix) {
  if (height <= 0 || width <= 0) return [];
  const total = content.length;
  if (total === 0) { const rows = []; while (rows.length < height) rows.push(' '.repeat(width)); return rows; }

  // clamp upper bound
  if (maxIndex > total - 1) maxIndex = total - 1;
  if (maxIndex < height - 2) maxIndex = height - 2;

  // 检查是否有行宽度溢出
  const overflow = content.some((l) => textWidth(l) > width);
  if (overflow) {
    const msg = 'Width overflow';
    const padL = Math.max(0, Math.floor((width - textWidth(msg)) / 2));
    const mid = Math.floor(height / 2);
    const rows = [];
    for (let y = 0; y < height; y++) {
      const line = y === mid ? ' '.repeat(padL) + msg : ' '.repeat(Math.max(0, width));
      rows.push('\x1b[41m' + padLine(line, Math.max(0, width)) + '\x1b[0m');
    }
    return rows;
  }

  // 内容高度小于等于高度：直接显示，下面补空行
  if (total <= height) {
    const rows = content.map((l) => padLine(l, width));
    while (rows.length < height) rows.push(' '.repeat(width));
    return rows.slice(0, height);
  }

  // 内容高度大于高度：显示范围 + 状态行（高度<=1 时无状态行）

  const bodyH = height - 1;
  if (bodyH <= 0) {
    // 只有一行，直接显示 maxIndex 对应的那行
    return [padLine(content[maxIndex] || '', width)];
  }

  const minIndex = Math.max(0, maxIndex - bodyH + 1);
  const visible = content.slice(minIndex, maxIndex + 1);

  const rows = visible.map((l) => padLine(l, width));
  while (rows.length < bodyH) rows.push(' '.repeat(width));

  const status = statusBar({ minIndex, maxIndex, total, cursorLine });
  // 状态行左端可加模式前缀（如 vim VISUAL），右端可附加按钮文本（右对齐）
  const prefixW = statusPrefix ? textWidth(statusPrefix) + 1 : 0;
  const extraW = statusExtra ? textWidth(statusExtra) + 1 : 0;
  const mid = padLine(status, width - prefixW - extraW);
  rows.push((statusPrefix ? statusPrefix + ' ' : '') + mid + (statusExtra ? ' ' + statusExtra : ''));

  return rows;
}

/**
 * @param {object} opts
 * @param {number} [opts.maxIndex=0]
 * @param {boolean} [opts.sticky=false] - 吸附滚动：内容增长时自动跟底，用户上滚后取消
 * @param {() => boolean} [opts.isPinned] - 为 true 时冻结滚动位置，不跟随新内容（用于选择文本等场景）
 * @param {(k: object) => boolean} [opts.matchKey]
 * @param {() => void} [opts.onUpdate] — 状态变化后立即调用（如触发重绘）
 * @param {() => boolean} [opts.isDisabled] — 为 true 时屏蔽滚轮/键盘滚动
 * @returns {{ state: { maxIndex: number, sticky: boolean }, render: (h,w,content) => string[], destroy: () => void, setRect: (y,height) => void }}
 */
export function useScroll(opts = {}) {
  const { maxIndex = 0, sticky: enableSticky = false, isPinned, matchKey, onUpdate, isDisabled } = opts;
  const state = { maxIndex, contentLength: 0, viewHeight: 0, sticky: enableSticky };
  let rect = null;

  function mkUp()    { if (state.maxIndex > 0) { state.maxIndex--; state.sticky = false; onUpdate?.(); } }
  function mkDown()  { if (state.maxIndex < state.contentLength - 1) { state.maxIndex++; if (state.maxIndex === state.contentLength - 1) state.sticky = true; onUpdate?.(); } }
  function mkPageUp()  { state.maxIndex = Math.max(0, state.maxIndex - Math.max(1, state.viewHeight - 1)); state.sticky = false; onUpdate?.(); }
  function mkPageDown(){ state.maxIndex = Math.min(state.contentLength - 1, state.maxIndex + Math.max(1, state.viewHeight - 1)); if (state.maxIndex === state.contentLength - 1) state.sticky = true; onUpdate?.(); }
  function mkHome()    { state.maxIndex = 0; state.sticky = false; onUpdate?.(); }
  function mkEnd()     { state.maxIndex = state.contentLength - 1; state.sticky = true; onUpdate?.(); }

  const onKey = (k) => {
    if (isDisabled && isDisabled()) return;
    if (matchKey && !matchKey(k)) return;
    switch (k.name) {
      case 'up':       mkUp(); break;
      case 'down':     mkDown(); break;
      case 'pageup':   mkPageUp(); break;
      case 'pagedown': mkPageDown(); break;
      case 'home':     mkHome(); break;
      case 'end':      mkEnd(); break;
    }
  };

  const onWheel = (e) => {
    if (isDisabled && isDisabled()) return;
    if (rect && (e.y < rect.y || e.y >= rect.y + rect.height)) return;
    if (e.dir === 'up') mkUp();
    else mkDown();
  };

  on('key', onKey);
  on('scroll', onWheel);

  function render(height, width, content, cursorLine, statusExtra, statusPrefix) {
    state.contentLength = content.length;
    state.viewHeight = height;
    // 吸附滚动：用户未主动上滚时，新内容到达自动跟底（pinned 时禁止）
    if (state.sticky && content.length > 0 && !(isPinned && isPinned())) state.maxIndex = content.length - 1;
    // clamp
    if (state.maxIndex > content.length - 1) state.maxIndex = content.length - 1;
    if (state.maxIndex < 0) state.maxIndex = 0;
    return scroll(height, width, content, state.maxIndex, cursorLine, statusExtra, statusPrefix);
  }

  function setRect(y, height) { rect = { y, height }; }

  function destroy() {
    off('key', onKey);
    off('scroll', onWheel);
  }

  return { state, render, destroy, setRect };
}
