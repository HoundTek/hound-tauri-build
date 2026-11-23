/**
 * @file 滚动容器渲染器
 * @description 提供终端滚动区域的视口计算、状态栏绘制与键盘/滚轮交互。
 * @module scroll
 * @author hound-builder
 */

import { on, off } from '../utils/events.mjs';
import { term } from '../utils/term.mjs';
import { statusBar } from './status-bar.mjs';
import { theme } from '../utils/theme.mjs';

/**
 * 根据视口高度与内容量计算滚动渲染行数组
 * @description 根据视口尺寸、内容行数组与滚动位置，返回固定高度的渲染行数组，包含溢出提示、空行填充和状态栏。
 * @param {number} height - 视口高度（行数）
 * @param {number} width - 视口宽度（列数）
 * @param {string[]} content - 待渲染的内容行数组
 * @param {number} maxIndex - 当前可见区域的最大行索引（决定滚动位置）
 * @param {number} cursorLine - 逻辑光标所在行号（用于状态栏显示）
 * @param {string} [statusExtra] - 状态栏右侧附加文本
 * @param {string} [statusPrefix] - 状态栏左侧前缀文本（如 vim 模式标识）
 * @param {number} [cursorCol] - 逻辑光标所在列号（用于状态栏显示）
 * @returns {string[]} 固定长度为 height（无状态栏）或 height+1（有状态栏）的渲染行数组
 */
export function scroll(height, width, content, maxIndex, cursorLine, statusExtra, statusPrefix, cursorCol) {
  if (height <= 0 || width <= 0) return [];
  const total = content.length;
  if (total === 0) { const rows = []; while (rows.length < height) rows.push(' '.repeat(width)); return rows; }

  // clamp upper bound
  if (maxIndex > total - 1) maxIndex = total - 1;
  if (maxIndex < height - 2) maxIndex = height - 2;

  // 检查是否有行宽度溢出
  const overflow = content.some((l) => term.width(l) > width);
  if (overflow) {
    const msg = 'Width overflow';
    const padL = Math.max(0, Math.floor((width - term.width(msg)) / 2));
    const mid = Math.floor(height / 2);
    const rows = [];
    for (let y = 0; y < height; y++) {
      const line = y === mid ? ' '.repeat(padL) + msg : ' '.repeat(Math.max(0, width));
      // 主题适配：加粗红字 + 反白强调，不写死背景色
      rows.push(theme.dangerBold + theme.rev + term.pad(line, Math.max(0, width)) + theme.revOff + theme.reset);
    }
    return rows;
  }

  // 内容高度小于等于高度：直接显示，下面补空行
  if (total <= height) {
    const rows = content.map((l) => term.pad(l, width));
    // 有状态栏时：额外加1行给状态栏，无空行
    const targetH = (statusExtra || statusPrefix) ? height + 1 : height;
    while (rows.length < targetH) rows.push(' '.repeat(width));
    // 有状态栏时：最后1行改为状态栏
    if (statusExtra || statusPrefix) {
      const contentRows = rows.slice(0, targetH - 1);
      const status = statusBar({ minIndex: 0, maxIndex: total - 1, total, cursorLine, cursorCol });
      const prefixW = statusPrefix ? term.width(statusPrefix) + 1 : 0;
      const extraW = statusExtra ? term.width(statusExtra) + 1 : 0;
      const mid = term.pad(status, width - prefixW - extraW);
      contentRows.push((statusPrefix ? statusPrefix + ' ' : '') + mid + (statusExtra ? ' ' + statusExtra : ''));
      return contentRows;
    }
    return rows.slice(0, height);
  }

  // 内容高度大于高度：显示范围 + 状态行
  // 总输出行数须 = height + 1（logSpace 内区 = borderedH - 2 = height + 1）
  // 有状态栏时：bodyH 内容行 + 1 状态栏 = height + 1 → bodyH = height
  // 无状态栏时：bodyH 全部为内容 = height + 1 → bodyH = height + 1
  const hasStatus = !!(statusExtra || statusPrefix);
  const bodyH = hasStatus ? height : height + 1;
  if (bodyH <= 0) {
    // 只有一行，直接显示 maxIndex 对应的那行
    return [term.pad(content[maxIndex] || '', width)];
  }

  const minIndex = Math.max(0, maxIndex - bodyH + 1);
  const visible = content.slice(minIndex, maxIndex + 1);

  const rows = visible.map((l) => term.pad(l, width));
  while (rows.length < bodyH) rows.push(' '.repeat(width));

  const status = statusBar({ minIndex, maxIndex, total, cursorLine, cursorCol });
  // 状态行左端可加模式前缀（如 vim VISUAL），右端可附加按钮文本（右对齐）
  const prefixW = statusPrefix ? term.width(statusPrefix) + 1 : 0;
  const extraW = statusExtra ? term.width(statusExtra) + 1 : 0;
  const mid = term.pad(status, width - prefixW - extraW);
  rows.push((statusPrefix ? statusPrefix + ' ' : '') + mid + (statusExtra ? ' ' + statusExtra : ''));

  return rows;
}

/**
 * @param {object} opts
 * @param {number} [opts.maxIndex=0]
 * @param {boolean} [opts.sticky=false] - 吸附滚动：内容增长时自动跟底，用户上滚后取消
 * @param {() => boolean} [opts.isSticky] - 吸附条件回调：提供时取代内部 sticky 闩锁（如“光标位于最后一行末端”）
 * @param {() => boolean} [opts.isPinned] - 为 true 时冻结滚动位置，不跟随新内容（用于选择文本等场景）
 * @param {(k: object) => boolean} [opts.matchKey]
 * @param {() => void} [opts.onUpdate] — 状态变化后立即调用（如触发重绘）
 * @param {(atBottom: boolean) => void} [opts.onScrollChange] — 滚动位置变化回调（atBottom = 是否在底部）
 * @param {() => boolean} [opts.isDisabled] — 为 true 时屏蔽滚轮/键盘滚动
 * @returns {{ state: { maxIndex: number, sticky: boolean }, render: (h,w,content) => string[], destroy: () => void, setRect: (y,height,x?,width?) => void }}
 */
export function useScroll(opts = {}) {
  const { maxIndex = 0, sticky: enableSticky = false, isSticky, isPinned, matchKey, onUpdate, onScrollChange, isDisabled } = opts;
  const state = { maxIndex, contentLength: 0, viewHeight: 0, sticky: enableSticky };
  let rect = null;

  function notifyScroll() {
    onUpdate?.();
    if (onScrollChange) {
      const atBottom = state.maxIndex >= state.contentLength - 1 && state.contentLength > 0;
      onScrollChange(atBottom);
    }
  }

  function mkUp()    { if (state.maxIndex > 0) { state.maxIndex--; state.sticky = false; notifyScroll(); } }
  function mkDown()  { if (state.maxIndex < state.contentLength - 1) { state.maxIndex++; if (state.maxIndex === state.contentLength - 1) state.sticky = true; notifyScroll(); } }
  function mkPageUp()  { state.maxIndex = Math.max(0, state.maxIndex - Math.max(1, state.viewHeight - 1)); state.sticky = false; notifyScroll(); }
  function mkPageDown(){ state.maxIndex = Math.min(state.contentLength - 1, state.maxIndex + Math.max(1, state.viewHeight - 1)); if (state.maxIndex === state.contentLength - 1) state.sticky = true; notifyScroll(); }
  function mkHome()    { state.maxIndex = 0; state.sticky = false; notifyScroll(); }
  function mkEnd()     { state.maxIndex = state.contentLength - 1; state.sticky = true; notifyScroll(); }

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
    if (e.shift) return; // shift+滚轮留给横向滚动处理
    if (rect && (e.y < rect.y || e.y >= rect.y + rect.height)) return;
    if (rect && rect.width != null && (e.x < rect.x || e.x >= rect.x + rect.width)) return;
    if (e.dir === 'up') mkUp();
    else mkDown();
  };

  on('key', onKey);
  on('scroll', onWheel);

  function render(height, width, content, cursorLine, statusExtra, statusPrefix, cursorCol) {
    state.contentLength = content.length;
    state.viewHeight = height;
    // 吸附滚动：提供 isSticky 时以回调为条件（如“光标位于最后一行末端”），否则用内部 sticky 闩锁；
    // 用户未主动上滚时，新内容到达自动跟底（pinned 时禁止）
    const follow = isSticky ? isSticky() : state.sticky;
    if (follow && content.length > 0 && !(isPinned && isPinned())) state.maxIndex = content.length - 1;
    // clamp
    if (state.maxIndex > content.length - 1) state.maxIndex = content.length - 1;
    if (state.maxIndex < 0) state.maxIndex = 0;
    return scroll(height, width, content, state.maxIndex, cursorLine, statusExtra, statusPrefix, cursorCol);
  }

  function setRect(y, height, x, width) { rect = { y, height, x: x || 0, width }; }

  function destroy() {
    off('key', onKey);
    off('scroll', onWheel);
  }

  return { state, render, destroy, setRect };
}
