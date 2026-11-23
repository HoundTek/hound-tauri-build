/**
 * @file 页面主渲染与交互协调
 * @description 组装树面板、日志面板、筛选栏和 overlay 弹窗，协调滚动、焦点和键盘事件。
 * @module {demos}/pages/index
 * @author hound-builder
 */

import { useScroll } from '../components/scroll.mjs';
import configModule from '../../lib/config.cjs';
import { logSpace } from '../components/log-space.mjs';
import { drawTreeWithMap } from '../components/tree.mjs';
import { taskNode } from '../components/task-node.mjs';
import { buildStatusBar } from '../components/status-bar.mjs';
import { createFilterRow } from '../components/filter-row.mjs';
import { hLayout } from '../components/h-layout.mjs';
import { term } from '../utils/term.mjs';
import { flexTwo } from '../utils/flex2.mjs';
import { wrapUrls } from '../utils/wrap-urls.mjs';
import { getTerminalSize } from '../utils/terminal-size.mjs';
import { theme } from '../utils/theme.mjs';
import { initFocus, focusState, clampCursors, highlightLine, applyLogSelection, applyLogSearch, highlightSlot, getTreeSlots, logSel, logSearch, vimMode, cursorActualCol, lineWidth } from '../utils/focus.mjs';
import { on } from '../utils/events.mjs';
import { tree, filterState, running, exitPanel, helpPanel, logEntries, initFromTasks, onTaskStatus, onLogEntry, onBuildExit, toggleFinished, toggleLevel, getStats, getFilteredLogs, getExpandedTreeH } from './data.mjs';
import { renderExitPanel, renderHelpPanel } from './panels.mjs';

const tuiConfig = configModule.getConfig().tui;

// ── 从 data.mjs re-export 供 entry point 使用 ──────
export { initFromTasks, onTaskStatus, onLogEntry, onBuildExit, running, exitPanel, helpPanel, filterState, toggleLevel, toggleFinished };

// ── 对外接口 ────────────────────────────────────────

let _onUpdate = null;
/**
 * 设置滚动状态变化回调，用于通知外部请求重绘
 * @param {Function} fn - 回调函数
 * @returns {void}
 */
export function setScrollCallback(fn) { _onUpdate = fn; }
/**
 * 判断筛选行是否处于编辑模式
 * @returns {boolean}
 */
export function isFooterEditing() { return filterRow.isEditing(); }

// ── 滚动 ────────────────────────────────────────────

const treeScroll = useScroll({ matchKey: () => false, onUpdate: () => _onUpdate?.(), isDisabled: () => exitPanel.visible });
// 页键（PageUp/PageDown/Ctrl+f/b）由 focus.mjs 日志处理器统一移动光标+滚动，此处禁用键盘滚动避免双重处理
// 吸附条件 = 光标位于最后一行末端（isSticky 取代旧的滚动闩锁）
const logScroll  = useScroll({
  isSticky: () => {
    // 跟随模式：新内容到达时自动跟底
    if (vimMode.mode === 'follow') return true;
    // 默认吸附条件：光标位于上一帧最后一行末端
    if (prevLogTotal <= 0) return false;
    const oldLast = prevLogTotal - 1;
    const lines = _logCtx.logLines;
    if (!lines || oldLast >= lines.length) return false;
    return focusState.logCursor >= oldLast && focusState.logCol >= lineWidth(lines[oldLast]);
  },
  isPinned: () => logSel.active,
  matchKey: () => false,
  onUpdate: () => _onUpdate?.(),
  onScrollChange: (atBottom) => {
    // 滚动到底部 → 自动进入 follow 模式
    if (atBottom && vimMode.mode !== 'follow') {
      vimMode.mode = 'follow';
      _onUpdate?.();
    }
  },
  isDisabled: () => exitPanel.visible,
});

// ── 布局上下文（makePage 每帧更新，focus 通过 getter 访问）─

const _treeCtx   = { y: 0, height: 0, scrollState: null, lines: [], nodeAtLine: [], markers: [] };
const _logCtx    = { y: 0, height: 0, scrollState: null, lineToEntry: [], logLines: [] };
const _footerCtx = { y: 0 };
const _logSelRef = { val: -1 }; // 日志选中条目索引
let lastLogTextW = 0;           // 上一帧日志换行宽度（宽度变化时用于光标跟随内容）
let prevLogTotal = 0;           // 上一帧日志显示行总数（isSticky 旧帧判断用）

// ── 筛选行（自管理焦点）──────────────────────────────

const filterRow = createFilterRow(filterState, () => _onUpdate?.());

// ── 右键复制：从选中区域提取纯文本 ───────────────────

/**
 * 从视觉选择区域提取纯文本，按 entry 分组拼接折行片段并应用列裁剪
 * @param {{ startLine: number, endLine: number, startCol: number, endCol: number }} sel - 视觉选择范围
 * @param {string[]} logLines - 换行后的日志显示行数组
 * @param {number[]} lineToEntry - 每行对应的原始日志条目索引
 * @returns {string} 提取的纯文本
 */
function extractSelectedText(sel, logLines, lineToEntry) {
  const a = Math.min(sel.startLine, sel.endLine);
  const b = Math.max(sel.startLine, sel.endLine);
  const single = a === b;
  const PREFIX = 2; // 与 focus.mjs 中 PREFIX_W 一致

  // 按 entry 分组连续行
  const groups = []; // [{ entryIdx, firstLine, parts: string[] }]
  for (let i = a; i <= b && i < logLines.length; i++) {
    const eIdx = lineToEntry[i];
    const clean = term.plain(logLines[i]);
    const content = clean.length > PREFIX ? clean.slice(PREFIX) : '';

    let g = groups[groups.length - 1];
    if (!g || g.entryIdx !== eIdx) {
      g = { entryIdx: eIdx, firstLine: i, parts: [] };
      groups.push(g);
    }
    g.lastLine = i;
    g.parts.push(content);
  }

  // 每个 entry：拼接折行片段，首尾应用列选择
  const results = [];
  for (const g of groups) {
    let text = '';
    for (let j = 0; j < g.parts.length; j++) {
      let part = g.parts[j];
      const lineIdx = g.firstLine + j;

      if (lineIdx === a) {
        const cs = single
          ? Math.min(sel.startCol, sel.endCol)
          : (a === sel.startLine ? sel.startCol : sel.endCol);
        part = part.slice(Math.max(0, cs - PREFIX));
      }
      if (lineIdx === b) {
        const ce = single
          ? Math.max(sel.startCol, sel.endCol)
          : (b === sel.startLine ? sel.startCol : sel.endCol);
        part = part.slice(0, Math.max(0, ce - PREFIX));
      }

      text += part;
    }
    if (text) results.push(text);
  }

  return results.join('\n');
}

/**
 * 将当前视觉选择区域的文本通过 OSC 52 写入终端剪贴板
 * @param {{ startLine: number, endLine: number, startCol: number, endCol: number }} sel - 视觉选择范围
 * @returns {void}
 */
function copyToClipboard(sel) {
  const lines = _logCtx.logLines;
  if (!lines || lines.length === 0) return;
  const text = extractSelectedText(sel, lines, _logCtx.lineToEntry);
  if (!text) return;
  // OSC 52: 终端剪贴板写入
  const b64 = Buffer.from(text, 'utf-8').toString('base64');
  process.stdout.write(`\x1b]52;c;${b64}\x07`);
}

// ── 复制按钮：复制当前筛选视图下的全部日志 ──────────

let copyFlashAt = 0; // 复制按钮反白反馈时间戳

/**
 * 复制当前筛选视图下的全部日志到终端剪贴板（OSC 52）
 * @returns {void}
 */
function copyAllLogs() {
  const filtered = getFilteredLogs();
  const text = filtered.map((e) => term.plain(e.text)).join('\n');
  if (!text) return;
  const b64 = Buffer.from(text, 'utf-8').toString('base64');
  process.stdout.write(`\x1b]52;c;${b64}\x07`);
}

// ── 初始化焦点系统 ──────────────────────────────────

initFocus({
  getTreeCtx:   () => _treeCtx,
  getLogCtx:    () => _logCtx,
  getFooterCtx: () => _footerCtx,
  filterState,
  getTree: () => tree,
  filterRow,
  onUpdate: () => _onUpdate?.(),
  onCopy: copyToClipboard,
  onCopyAll: copyAllLogs,
  isExitPanelVisible: () => exitPanel.visible,
  isHelpVisible: () => helpPanel.visible,
});

// ── 状态栏按钮点击：[Vim/Follow] [Copy] ──

on('mouse', (e) => {
  if (e.type !== 'down' || e.btn !== 0) return;
  if (exitPanel.visible) return;
  const ctx = _logCtx;
  if (!ctx || !ctx.scrollState) return;
  const statusY = ctx.y + ctx.height - 1; // 状态栏在内容区最后一行
  if (e.y !== statusY) return;
  const { columns } = getTerminalSize();
  // 按钮文本（不含 ANSI），计算实际宽度
  const followLabel = vimMode.mode === 'follow' ? '[Vim]' : '[Follow]';
  const copyLabel = (Date.now() - copyFlashAt < 600) ? '[Copied]' : '[Copy]';
  const followW = term.width(followLabel);
  const copyW = term.width(copyLabel);
  const totalExtraW = followW + 1 + copyW;
  const extraX0 = columns - 2 - totalExtraW;
  const followX0 = extraX0;
  const followX1 = extraX0 + followW;
  const copyX0 = extraX0 + followW + 1;
  const copyX1 = copyX0 + copyW;
  if (e.x >= followX0 && e.x < followX1) {
    // 点击 [Follow/Vim]：切换模式 + 聚焦按钮
    focusState.focus = 'log-follow-btn';
    focusState.focusVisible = true;
    if (vimMode.mode === 'follow') {
      vimMode.mode = 'normal';
    } else {
      vimMode.mode = 'follow';
      vimMode.count = 0;
      logSel.active = false;
      if (wrappedLogLines.length > 0) {
        focusState.logCursor = wrappedLogLines.length - 1;
        focusState.logCol = Math.max(PREFIX_COL, lineWidth(wrappedLogLines[wrappedLogLines.length - 1]));
      }
    }
    _onUpdate?.();
  } else if (e.x >= copyX0 && e.x < copyX1) {
    // 点击 [Copy]：复制 + 聚焦按钮
    focusState.focus = 'log-copy-btn';
    focusState.focusVisible = true;
    copyAllLogs();
    copyFlashAt = Date.now();
    _onUpdate?.();
  }
});

// ── 按钮焦点 Enter/Space 触发 ──
on('key', (k) => {
  if (k.name !== 'return' && k.name !== 'space') return;
  if (focusState.focus === 'log-follow-btn') {
    // 切换模式；光标位置由 makePage 在下一帧根据 follow 状态同步
    if (vimMode.mode === 'follow') {
      vimMode.mode = 'normal';
    } else {
      vimMode.mode = 'follow';
      vimMode.count = 0;
      logSel.active = false;
    }
    _onUpdate?.();
  } else if (focusState.focus === 'log-copy-btn') {
    copyAllLogs();
    copyFlashAt = Date.now();
    _onUpdate?.();
  }
});

// ── 主渲染 ──────────────────────────────────────────

/**
 * 渲染一帧完整页面，返回每行字符串数组
 * @returns {string[]} 每行一个元素的输出数组，长度等于终端行数
 */
export function makePage() {
  const { rows, columns } = getTerminalSize();
  const W = Math.max(1, columns);
  const H = Math.max(3, rows);

  // ── 终端尺寸过小提示（阈值来自 tui.minCols / tui.minRows） ──
  const MIN_COL = tuiConfig.minCols;
  const MIN_ROW = tuiConfig.minRows;
  if (W < MIN_COL || H < MIN_ROW) {
    const out = Array(H).fill(' '.repeat(W));
    const msgW = 50;
    const msgH = 7;
    const mx = Math.max(0, Math.floor((W - msgW) / 2));
    const my = Math.max(0, Math.floor((H - msgH) / 2));
    const center = (s, w) => {
      const tw = term.width(s);
      const pl = Math.max(0, Math.floor((w - 2 - tw) / 2));
      const pr = w - 2 - tw - pl;
      return '\u2502' + ' '.repeat(pl) + s + ' '.repeat(pr) + '\u2502';
    };
    const sizeInfo = columns + '\u00d7' + rows + ' (need \u2265' + MIN_COL + '\u00d7' + MIN_ROW + ')';
    const lines = [
      theme.dim + '\u250c' + '\u2500'.repeat(msgW - 2) + '\u2510' + theme.reset,
      center(theme.warnBold + '\u26a0  Terminal Too Small' + theme.reset, msgW),
      center('', msgW),
      center('Current: ' + sizeInfo, msgW),
      center('Please resize your terminal', msgW),
      center('', msgW),
      theme.dim + '\u2514' + '\u2500'.repeat(msgW - 2) + '\u2518' + theme.reset,
    ];
    for (let r = 0; r < msgH && my + r < H; r++) {
      if (r < lines.length) {
        out[my + r] = ' '.repeat(mx) + lines[r] + ' '.repeat(Math.max(0, W - mx - msgW));
      }
    }
    return out;
  }

  // header
  const stats = getStats();
  const BG = '\x1b[48;5;24m';  // 深青蓝，白字对比度高
  const FG = '\x1b[37m';
  const title = FG + '\x1b[1m' + ' \u2699 Hound \x1b[22m' + FG;
  const statusLine = hLayout(buildStatusBar(stats, stats.totalElapsed), W - term.width(' \u2699 Hound ') - 1).line;
  const header = BG + title + statusLine + ' ' + '\x1b[0m';

  // filtered logs
  const filtered = getFilteredLogs();
  const logInnerW = Math.max(3, W - 2);
  const textW = logInnerW - 2;

  // 重建前捕获旧布局（日志区宽度变化时，光标需按旧布局计算内容偏移以跟随内容）
  const oldLogLines = _logCtx.logLines;
  const oldLineToEntry = _logCtx.lineToEntry;
  const prevTextW = lastLogTextW;

  const rawWrapped = filtered.map((e) => term.wrap(wrapUrls(e.text), textW).map((l) => term.pad(l, textW)));
  const lineToEntry = [];
  const wrappedEntries = filtered.map((e, eIdx) => {
    const lines = rawWrapped[eIdx];
    const dot = `${term.style.taskDot(e.taskId)} `;
    for (let i = 0; i < lines.length; i++) lineToEntry.push(eIdx);
    return lines.map((l, i) => {
      return i === 0 ? dot + l : '  ' + l;
    });
  });
  const wrappedLogLines = wrappedEntries.flat();

  // 每个日志条目在新布局中的起始显示行
  const entryStartOf = [];
  for (let i = 0; i < lineToEntry.length; i++) {
    const e = lineToEntry[i];
    if (entryStartOf[e] === undefined) entryStartOf[e] = i;
  }

  // flex2
  const { lines: treeLines, nodeAtLine, markers } = drawTreeWithMap(tree, { renderNode: taskNode });
  const bodyH = H - 2;
  const actLogH = logEntries.length + 3; // +2 borders +1 status bar
  const actTreeH = treeLines.length;
  const expandedTreeH = getExpandedTreeH();

  let treeH, logH;
  if (actTreeH + actLogH >= bodyH) {
    [treeH, logH] = flexTwo(bodyH, expandedTreeH, wrappedLogLines.length + 3);
  } else {
    treeH = Math.max(1, actTreeH);
    logH = Math.max(3, wrappedLogLines.length + 3); // content +2 borders +1 status bar
  }

  treeScroll.setRect(1, Math.max(1, treeH));
  logScroll.setRect(1 + treeH + 1, Math.max(1, logH - 3)); // -3: 上下边框 + 常驻状态栏

  // 更新上下文
  Object.assign(_treeCtx, { y: 1, height: Math.max(1, treeH), scrollState: treeScroll.state, lines: treeLines, nodeAtLine, markers });
  Object.assign(_logCtx,  { y: 1 + treeH + 1, height: Math.max(1, logH - 3), scrollState: logScroll.state, lineToEntry, logLines: wrappedLogLines });
  _footerCtx.y = 1 + treeH + logH;

  // ── 日志光标模型（逻辑列 / 实际列）────────────────
  // 实际列 = min(逻辑列, 行末)，由 cursorActualCol 渲染时计算。
  // 1) 日志区宽度变化：按旧布局计算光标内容偏移，映射到新布局（光标跟随内容，逻辑列与实际列同步）
  // 2) 尾部吸附：光标位于上一帧最后一行末端时，新内容到达 → 光标跟随到新最后一行（保持逻辑列），视口贴底
  const PREFIX_COL = 2; // 与 focus.mjs 的 PREFIX_W 一致：dot/缩进列不可选中
  if (prevTextW > 0 && prevTextW !== textW && oldLogLines.length > 0) {
    const curIdx = Math.min(focusState.logCursor, oldLogLines.length - 1);
    const eIdx = oldLineToEntry[curIdx];
    if (eIdx != null && wrappedEntries[eIdx] && wrappedEntries[eIdx].length > 0 && entryStartOf[eIdx] != null) {
      const start = oldLineToEntry.indexOf(eIdx);
      const lineInEntry = Math.max(0, curIdx - start);
      const oldActual = Math.min(focusState.logCol, lineWidth(oldLogLines[curIdx]));
      const off = Math.max(0, lineInEntry * prevTextW + (oldActual - PREFIX_COL));
      const newSegs = wrappedEntries[eIdx];
      const newLineInEntry = Math.min(Math.floor(off / textW), newSegs.length - 1);
      const newIdx = entryStartOf[eIdx] + newLineInEntry;
      if (newIdx >= 0 && newIdx < wrappedLogLines.length) {
        focusState.logCursor = newIdx;
        focusState.logCol = PREFIX_COL + Math.max(0, off - newLineInEntry * textW);
      }
    }
  } else if (wrappedLogLines.length > logScroll.state.contentLength && logScroll.state.contentLength > 0) {
    const oldLast = logScroll.state.contentLength - 1;
    if (focusState.logCursor >= oldLast && focusState.logCol >= lineWidth(wrappedLogLines[oldLast])) {
      // 光标在上一帧最后一行末端 → 跟随到新最后一行（保持逻辑列）
      focusState.logCursor = wrappedLogLines.length - 1;
      logScroll.state.maxIndex = wrappedLogLines.length - 1;
      if (logSel.active) logSel.endLine = focusState.logCursor;
    }
  }
  // 跟随模式：光标始终在最后一行末端
  if (vimMode.mode === 'follow' && wrappedLogLines.length > 0) {
    const last = wrappedLogLines.length - 1;
    focusState.logCursor = last;
    focusState.logCol = Math.max(PREFIX_COL, lineWidth(wrappedLogLines[last]));
    logScroll.state.maxIndex = last;
  }
  // 光标裁边
  clampCursors(_treeCtx, _logCtx);

  // 树面板 — 行内元素级高亮（仅键盘交互时显示）
  let treePanel = treeScroll.render(Math.max(1, treeH), W, treeLines, focusState.treeCursor);
  if (focusState.focus === 'tree' && focusState.focusVisible && !exitPanel.visible && treeLines.length > 0) {
    const tBodyH = treeLines.length > treeH ? treeH - 1 : treeLines.length;
    const tMinIdx = Math.max(0, treeScroll.state.maxIndex - tBodyH + 1);
    const screenPos = focusState.treeCursor - tMinIdx;
    if (screenPos >= 0 && screenPos < tBodyH && screenPos < treePanel.length) {
      const slots = getTreeSlots(focusState.treeCursor, markers, treeLines);
      const slot = slots[focusState.treeSlot];
      if (slot) {
        treePanel[screenPos] = highlightSlot(treePanel[screenPos], slot.col, slot.col + slot.width);
      } else {
        treePanel[screenPos] = highlightLine(treePanel[screenPos]);
      }
    }
  }

  // 日志面板 — 先叠加搜索匹配下划线 + 拖拽/visual 选择高亮，渲染；焦点行在框线内部换底色
  let logRenderLines = applyLogSelection(applyLogSearch(wrappedLogLines, logSearch), logSel);
  // 复制按钮 + Vim/Follow 按钮：常驻显示
  const copyBtnText = Date.now() - copyFlashAt < 1000 ? '\x1b[7m[Copied]\x1b[27m' : '[Copy]';
  // Vim/Follow 按钮：follow 模式显示 [Vim]，其他模式显示 [Follow]
  const followBtnText = vimMode.mode === 'follow' ? '[Vim]' : '[Follow]';
  // 焦点高亮：按钮获得焦点时反白
  const followFocused = focusState.focus === 'log-follow-btn' && focusState.focusVisible;
  const copyFocused = focusState.focus === 'log-copy-btn' && focusState.focusVisible;
  const followDisplay = followFocused ? '\x1b[7m' + followBtnText + '\x1b[27m' : followBtnText;
  const copyDisplay = copyFocused ? '\x1b[7m' + copyBtnText + '\x1b[27m' : copyBtnText;
  const statusExtra = followDisplay + ' ' + copyDisplay;
  // vim 模式提示：仅 normal/visual 模式显示，follow 模式隐藏
  const modeLabel = vimMode.mode === 'visual' ? ' VISUAL' : ' NORMAL';
  const countLabel = vimMode.count > 0 ? ' ' + vimMode.count : '';
  const vimPrefix = (focusState.focus === 'log' && focusState.focusVisible && vimMode.mode !== 'follow')
    ? '\x1b[7m' + modeLabel + countLabel + ' \x1b[27m' : '';
  const scrolledLog = logScroll.render(Math.max(1, logH - 3), logInnerW, logRenderLines, focusState.logCursor, statusExtra, vimPrefix, cursorActualCol(_logCtx));

  // 日志焦点行：框线内部整行换底色 + vim 光标块（仅 normal/visual 模式 + 键盘交互时显示）
  if (focusState.focus === 'log' && focusState.focusVisible && !exitPanel.visible && wrappedLogLines.length > 0 && vimMode.mode !== 'follow') {
    const logBodyH = wrappedLogLines.length > (logH - 3) ? (logH - 4) : wrappedLogLines.length;
    const logMinIdx = Math.max(0, logScroll.state.maxIndex - logBodyH + 1);
    const logScreenPos = focusState.logCursor - logMinIdx;
    if (logScreenPos >= 0 && logScreenPos < logBodyH && logScreenPos < scrolledLog.length) {
      // 先画 vim 光标块（反白，落在实际列），再整行换底色，避免光标处底色被重置
      const aCol = cursorActualCol(_logCtx);
      let line = highlightSlot(scrolledLog[logScreenPos], aCol, aCol + 1);
      scrolledLog[logScreenPos] = theme.focusBg + line.replace(/\x1b\[0m/g, '\x1b[0m' + theme.focusBg) + '\x1b[0m';
    }
  }

  const logPanel = logSpace(W, Math.max(2, logH), scrolledLog);

  // footer — 搜索输入时显示查询行；否则为筛选行（焦点高亮内建于 filterRow）。
  // 任务结束后在底部最右侧附加 exit 提示
  let footerLine;
  if (logSearch.active) {
    const q = logSearch.query;
    const total = logSearch.matches.length;
    const pos = logSearch.pos >= 0 ? logSearch.pos + 1 : 0;
    const hint = total
      ? '[' + pos + '/' + total + '] \u21b5 跳转 / Esc 取消'
      : '无匹配 / Esc 取消';
    const base = theme.rev + ' / ' + theme.revOff + ' ' + (q || '') + theme.rev + ' ' + theme.revOff;
    const bw = term.width(base);
    const hw = term.width(hint);
    if (bw + hw + 1 <= W) {
      footerLine = base + ' '.repeat(W - bw - hw - 1) + ' ' + theme.faint + hint + theme.reset;
    } else {
      footerLine = base + ' '.repeat(Math.max(0, W - bw));
    }
  } else {
    const footerHint = running.val ? '' : '\x1b[90mpress ESC or Ctrl+C to exit\x1b[0m';
    const footerLayout = filterRow.render(W, focusState.focus === 'footer' && focusState.focusVisible && !exitPanel.visible, footerHint);
    footerLine = footerLayout.line;
  }

  // 组装输出
  const output = [header, ...treePanel, ...logPanel, footerLine];
  while (output.length < H) output.push(' '.repeat(W));

  renderExitPanel(output, exitPanel, W, H);
  renderHelpPanel(output, helpPanel, W, H);

  // 帧末更新：记录本帧状态，供下一帧 isSticky/宽度变化判断用
  lastLogTextW = textW;
  prevLogTotal = wrappedLogLines.length;

  return output.slice(0, H);
}
