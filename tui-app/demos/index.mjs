import { useScroll } from '../components/scroll.mjs';
import configModule from '../../config.cjs';
import { logSpace } from '../components/log-space.mjs';
import { drawTreeWithMap } from '../components/tree.mjs';
import { taskNode } from '../components/task-node.mjs';
import { buildStatusBar } from '../components/status-bar.mjs';
import { toggleLevel } from '../components/filter-bar.mjs';
import { createFilterRow } from '../components/filter-row.mjs';
import { text } from '../components/text.mjs';
import { hLayout } from '../components/h-layout.mjs';
import { applyFilter } from '../utils/filter.mjs';
import { taskDot } from '../utils/colors.mjs';
import { flexTwo } from '../utils/flex2.mjs';
import { wrapLine } from '../utils/wrap-line.mjs';
import { wrapUrls } from '../utils/wrap-urls.mjs';
import { textWidth, visSlice } from '../utils/text-width.mjs';
import { getTerminalSize } from '../utils/terminal-size.mjs';
import { initFocus, focusState, clampCursors, highlightLine, applyLogSelection, highlightSlot, getTreeSlots, logSel, vimMode } from '../utils/focus.mjs';
import { on } from '../utils/events.mjs';

const tuiConfig = configModule.getConfig().tui;

// ── 数据 ────────────────────────────────────────────

/** 从后端 flat 任务定义构建嵌套树 */
function buildTreeFromDefs(taskDefs) {
  const map = new Map();
  for (const t of taskDefs) {
    map.set(t.id, { id: t.id, description: t.description, status: 'pending', elapsed: 0, logFilter: 1, children: [] });
  }
  const hasParent = new Set();
  for (const t of taskDefs) {
    for (const depId of t.dependsOn) {
      hasParent.add(depId);
    }
  }
  const roots = [];
  for (const t of taskDefs) {
    const node = map.get(t.id);
    for (const depId of t.dependsOn) {
      const child = map.get(depId);
      if (child && !node.children.includes(child)) node.children.push(child);
    }
    if (!hasParent.has(t.id)) roots.push(node);
  }
  return roots.length === 1 ? roots[0] : { id: '_root', description: 'build', status: 'pending', elapsed: 0, logFilter: 1, children: roots };
}

/** 递归查找并更新节点状态 */
function updateNodeStatus(node, taskId, status, elapsed) {
  if (node.id === taskId) {
    node.status = status;
    if (elapsed != null) node.elapsed = elapsed;
    return true;
  }
  if (node.children) {
    for (const c of node.children) {
      if (updateNodeStatus(c, taskId, status, elapsed)) return true;
    }
  }
  return false;
}

/** 检测日志等级 */
function detectLevel(text) {
  const t = text.toLowerCase();
  if (/error|fail|exception/i.test(t)) return 'error';
  if (/warn/i.test(t)) return 'warning';
  if (/success|done|complete|finished/i.test(t)) return 'success';
  if (/info/i.test(t)) return 'info';
  return 'log';
}

// 可变状态（通过 initFromTasks 初始化）
let tree = { id: '_root', description: 'build', status: 'pending', elapsed: 0, logFilter: 1, children: [] };
const logEntries = [];
const startTimes = new Map();   // taskId → 启动时刻的时间戳 (Date.now() 基准)
let buildStartTime = 0;         // 全局构建启动时间

export const filterState = { levels: ['success', 'warning', 'info', 'error', 'log'], query: '', queryActive: false };
export const running = { val: true };
export const exitPanel = { visible: false, selected: 'n' };
export { tree, toggleLevel };

/** 从后端任务定义初始化树 */
export function initFromTasks(taskDefs) {
  tree = buildTreeFromDefs(taskDefs);
  logEntries.length = 0;
  startTimes.clear();
  buildStartTime = Date.now();
  running.val = true;
}

/** 更新任务状态 */
export function onTaskStatus(taskId, status, elapsed) {
  if (status === 'running' && !startTimes.has(taskId)) {
    startTimes.set(taskId, Date.now() - (elapsed || 0));
  }
  if (status !== 'running') {
    startTimes.delete(taskId);
  }
  updateNodeStatus(tree, taskId, status, elapsed);
}

/** 添加日志条目（超出 tui.logLimit 时裁剪头部，防止长构建内存无限增长） */
export function onLogEntry(text, taskId) {
  logEntries.push({ text, level: detectLevel(text), taskId: taskId || '' });
  if (logEntries.length > tuiConfig.logLimit) {
    logEntries.splice(0, logEntries.length - tuiConfig.logLimit);
  }
}

/** 构建结束 */
export function onBuildExit(ok) {
  running.val = false;
}

// ── 对外接口 ────────────────────────────────────────

let _onUpdate = null;
export function setScrollCallback(fn) { _onUpdate = fn; }
export function isFooterEditing() { return filterRow.isEditing(); }
export function toggleFinished() { running.val = !running.val; }

// ── 滚动 ────────────────────────────────────────────

const treeScroll = useScroll({ matchKey: () => false, onUpdate: () => _onUpdate?.(), isDisabled: () => exitPanel.visible });
const logScroll  = useScroll({ sticky: true, isPinned: () => logSel.active, matchKey: k => focusState.focus === 'log' && ['pageup','pagedown'].includes(k.name), onUpdate: () => _onUpdate?.(), isDisabled: () => exitPanel.visible });

// ── 布局上下文（makePage 每帧更新，focus 通过 getter 访问）─

const _treeCtx   = { y: 0, height: 0, scrollState: null, lines: [], nodeAtLine: [], markers: [] };
const _logCtx    = { y: 0, height: 0, scrollState: null, lineToEntry: [], logLines: [] };
const _footerCtx = { y: 0 };
const _logSelRef = { val: -1 }; // 日志选中条目索引

// ── 筛选行（自管理焦点）──────────────────────────────

const filterRow = createFilterRow(filterState, () => _onUpdate?.());

// ── 右键复制：从选中区域提取纯文本 ───────────────────

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\].*?\x1b\\/g, '');
}

function extractSelectedText(sel, logLines, lineToEntry) {
  const a = Math.min(sel.startLine, sel.endLine);
  const b = Math.max(sel.startLine, sel.endLine);
  const single = a === b;
  const PREFIX = 2; // 与 focus.mjs 中 PREFIX_W 一致

  // 按 entry 分组连续行
  const groups = []; // [{ entryIdx, firstLine, parts: string[] }]
  for (let i = a; i <= b && i < logLines.length; i++) {
    const eIdx = lineToEntry[i];
    const clean = stripAnsi(logLines[i]);
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

function copyAllLogs() {
  const taskFilters = buildTaskFilters(tree);
  const filtered = applyFilter(logEntries, { ...filterState, taskFilters });
  const text = filtered.map((e) => stripAnsi(e.text)).join('\n');
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
  tree,
  filterRow,
  onUpdate: () => _onUpdate?.(),
  onCopy: copyToClipboard,
  onCopyAll: copyAllLogs,
  isExitPanelVisible: () => exitPanel.visible,
});

// ── 复制按钮：点击日志状态栏右端的 [Copy] 复制全部日志 ──

const COPY_BTN_W = 6; // '[Copy]' 可见宽度

on('mouse', (e) => {
  if (e.type !== 'down' || e.btn !== 0) return;
  if (exitPanel.visible) return;
  const ctx = _logCtx;
  if (!ctx || !ctx.scrollState) return;
  // 状态行仅在内容溢出时存在（scrolledLog 满高），位于日志框内最后一行
  if (ctx.lineToEntry.length <= ctx.height) return;
  const statusY = ctx.y + ctx.height - 1;
  if (e.y !== statusY) return;
  const { columns } = getTerminalSize();
  const btnX0 = columns - 2 - COPY_BTN_W; // 右对齐，距右边框 1 列
  if (e.x < btnX0 || e.x >= columns - 2) return;
  copyAllLogs();
  copyFlashAt = Date.now();
  _onUpdate?.();
});

// ── 统计辅助 ────────────────────────────────────────

function buildTaskFilters(root) {
  const hidden = new Set();
  (function walk(n) { if (n.logFilter === 0) hidden.add(n.id); n.children?.forEach(walk); })(root);
  return { hidden };
}

/** 计算完全展开的树行数（无折叠、无链压缩） */
function countAllNodes(node) {
  let n = 1;
  if (node.children) for (const c of node.children) n += countAllNodes(c);
  return n;
}

// ── 主渲染 ──────────────────────────────────────────

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
    const BG = '\x1b[48;5;237m';
    const WARN = '\x1b[38;5;214m';
    const WARN_OFF = '\x1b[39m';
    const RS = '\x1b[0m';
    const center = (s, w) => {
      const tw = textWidth(s);
      const pl = Math.max(0, Math.floor((w - 2 - tw) / 2));
      const pr = w - 2 - tw - pl;
      return '│' + ' '.repeat(pl) + s + ' '.repeat(pr) + '│';
    };
    const sizeInfo = columns + '\u00d7' + rows + ' (need \u2265' + MIN_COL + '\u00d7' + MIN_ROW + ')';
    const lines = [
      '\u250c' + '\u2500'.repeat(msgW - 2) + '\u2510',
      center(WARN + '\u26a0  Terminal Too Small' + WARN_OFF, msgW),
      center('', msgW),
      center('Current: ' + sizeInfo, msgW),
      center('Please resize your terminal', msgW),
      center('', msgW),
      '\u2514' + '\u2500'.repeat(msgW - 2) + '\u2518',
    ];
    for (let r = 0; r < msgH && my + r < H; r++) {
      if (r < lines.length) {
        out[my + r] = ' '.repeat(mx) + BG + lines[r] + RS + ' '.repeat(Math.max(0, W - mx - msgW));
      }
    }
    return out;
  }

  // header
  const counts = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0 };
  (function walk(n) { counts[n.status] = (counts[n.status] || 0) + 1; n.children?.forEach(walk); })(tree);

  // 实时更新运行中任务的 elapsed，以及统计 running 计数
  const now = Date.now();
  const totalElapsed = buildStartTime ? now - buildStartTime : 0;
  (function updateLiveElapsed(n) {
    if (n.status === 'running' && startTimes.has(n.id)) {
      n.elapsed = now - startTimes.get(n.id);
    }
    n.children?.forEach(updateLiveElapsed);
  })(tree);

  const stats = { finished: !running.val, ...counts };
  const BG = '\x1b[48;5;24m';  // 深青蓝，白字对比度高
  const FG = '\x1b[37m';
  const title = FG + '\x1b[1m' + ' \u2699 Hound \x1b[22m' + FG;
  const statusLine = hLayout(buildStatusBar(stats, totalElapsed), W - textWidth(' \u2699 Hound ') - 1).line;
  const header = BG + title + statusLine + ' ' + '\x1b[0m';

  // filtered logs
  const taskFilters = buildTaskFilters(tree);
  const filtered = applyFilter(logEntries, { ...filterState, taskFilters });
  const logInnerW = Math.max(3, W - 2);
  const textW = logInnerW - 2;

  const rawWrapped = filtered.map((e) => wrapLine(wrapUrls(e.text), textW));
  const lineToEntry = [];
  const wrappedEntries = filtered.map((e, eIdx) => {
    const lines = rawWrapped[eIdx];
    const dot = `${taskDot(e.taskId)} `;
    for (let i = 0; i < lines.length; i++) lineToEntry.push(eIdx);
    return lines.map((l, i) => {
      return i === 0 ? dot + l : '  ' + l;
    });
  });
  const wrappedLogLines = wrappedEntries.flat();

  // flex2
  const { lines: treeLines, nodeAtLine, markers } = drawTreeWithMap(tree, { renderNode: taskNode });
  const bodyH = H - 2;
  const actLogH = wrappedLogLines.length + 2;
  const actTreeH = treeLines.length;
  const expandedTreeH = countAllNodes(tree);

  let treeH, logH;
  if (actTreeH + actLogH >= bodyH) {
    [treeH, logH] = flexTwo(bodyH, expandedTreeH, logEntries.length + 2);
  } else {
    treeH = Math.max(1, actTreeH);
    logH = Math.max(3, actLogH);
  }

  treeScroll.setRect(1, Math.max(1, treeH));
  logScroll.setRect(1 + treeH + 1, Math.max(1, logH - 2));

  // 更新上下文
  Object.assign(_treeCtx, { y: 1, height: Math.max(1, treeH), scrollState: treeScroll.state, lines: treeLines, nodeAtLine, markers });
  Object.assign(_logCtx,  { y: 1 + treeH + 1, height: Math.max(1, logH - 2), scrollState: logScroll.state, lineToEntry, logLines: wrappedLogLines });
  _footerCtx.y = 1 + treeH + logH;

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

  // 日志面板 — 先叠加拖拽选择高亮，渲染；焦点行在框线内部换底色
  let logRenderLines = applyLogSelection(wrappedLogLines);
  // 复制按钮：复制后 600ms 内反白反馈；仅在内容溢出（存在状态行）时显示
  const copyBtnText = Date.now() - copyFlashAt < 600 ? '\x1b[7m[Copy]\x1b[27m' : '[Copy]';
  // vim visual 模式提示（状态行左端）
  const vimPrefix = vimMode.visual ? '\x1b[7m VISUAL \x1b[27m' : '';
  const scrolledLog = logScroll.render(Math.max(1, logH - 2), logInnerW, logRenderLines, focusState.logCursor, copyBtnText, vimPrefix);

  // 日志焦点行：框线内部整行换底色（仅键盘交互时显示）
  if (focusState.focus === 'log' && focusState.focusVisible && !exitPanel.visible && wrappedLogLines.length > 0) {
    const logBodyH = wrappedLogLines.length > (logH - 2) ? (logH - 3) : wrappedLogLines.length;
    const logMinIdx = Math.max(0, logScroll.state.maxIndex - logBodyH + 1);
    const logScreenPos = focusState.logCursor - logMinIdx;
    if (logScreenPos >= 0 && logScreenPos < logBodyH && logScreenPos < scrolledLog.length) {
      const line = scrolledLog[logScreenPos];
      scrolledLog[logScreenPos] = '\x1b[48;5;237m' + line.replace(/\x1b\[0m/g, '\x1b[0m\x1b[48;5;237m') + '\x1b[0m';
    }
  }

  const logPanel = logSpace(W, Math.max(2, logH), scrolledLog);

  // footer — 筛选行（焦点高亮内建于 filterRow，仅键盘交互时显示）
  const footerLayout = filterRow.render(W, focusState.focus === 'footer' && focusState.focusVisible && !exitPanel.visible);
  const footerLine = footerLayout.line;

  // 组装输出
  const output = [header, ...treePanel, ...logPanel, footerLine];
  while (output.length < H) output.push(' '.repeat(W));

  // 退出确认面板
  if (exitPanel.visible) {
    const modalW = 28;
    const modalH = 4;
    const mx = Math.max(0, Math.floor((W - modalW) / 2));
    const my = Math.max(0, Math.floor((H - modalH) / 2));
    const HL = '\x1b[48;5;237m\x1b[37;1m';
    const RS = '\x1b[0m';
    const SEL = '\x1b[7m';   // 选中反白
    const SOF = '\x1b[27m';
    const sel = exitPanel.selected || 'n';

    const padStr = (s, w) => s + ' '.repeat(Math.max(0, w - textWidth(s)));

    const lines = [
      ' ┌────────────────────────┐ ',
      ' │ Exit Hound Builder?    │ ',
    ];

    // [Y] Yes / [N] No 行：选中项反白
    const yLabel = (sel === 'y' ? SEL + '[Y]' + SOF : '[Y]') + ' Yes';
    const nLabel = (sel === 'n' ? SEL + '[N]' + SOF : '[N]') + ' No';
    const btnLine = ' │ ' + padStr(yLabel, 11) + '  ' + padStr(nLabel, 9) + ' │ ';
    lines.push(btnLine);

    lines.push(
      ' └────────────────────────┘ ',
    );

    for (let r = 0; r < modalH && my + r < H; r++) {
      const orig = output[my + r];
      const left = visSlice(orig, 0, mx);
      const right = visSlice(orig, mx + modalW, textWidth(orig));
      const line = lines[r];
      output[my + r] = left + HL + line + RS + right;
    }
  }

  return output.slice(0, H);
}
