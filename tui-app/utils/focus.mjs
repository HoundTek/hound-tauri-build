/**
 * @file 焦点系统：状态管理 + 键盘/点击事件 + 渲染辅助
 * @description 管理 TUI 焦点切换、键盘导航、鼠标交互与选区，与 makePage 渲染逻辑完全解耦。
 * @module focus
 * @author hound-builder
 */

import { on } from './events.mjs';
import { treeClick, collectChain } from '../components/tree.mjs';
import { term, core } from './term.mjs';

// ── 只读状态 ───────────────────────────────────────

/** 焦点系统全局状态（只读，由事件处理器内部修改） */
export const focusState = {
  focus: 'tree',      // 'tree' | 'log' | 'footer'
  treeCursor: 0,      // 树区域光标（绝对内容行索引）
  treeSlot: 0,        // 行内元素索引（0=首个箭头/复选框）
  logCursor: 0,       // 日志光标（绝对内容行索引）
  logCol: 0,          // 日志光标（视觉列）
  focusVisible: false, // 键盘交互 → true；鼠标交互/初始 → false
};

/** log 文本拖拽选择状态 */
export const logSel = {
  active: false,     // 选中区域存在
  selecting: false,  // 正在拖拽中
  startLine: -1,
  endLine: -1,
  startCol: -1,
  endCol: -1,
};

/** 日志区 vim 模式状态（follow / normal / visual） */
export const vimMode = {
  mode: 'follow',     // 'follow' | 'normal' | 'visual'
  count: 0,           // 待执行的数字前缀（如 3j 的 3），0 表示无
};

/** 日志搜索状态（/ 查找跳转） */
export const logSearch = {
  active: false,      // 正在输入查询
  query: '',
  lastQuery: '',      // 最近一次提交的查询（n/N 复用）
  matches: [],        // [{ line, col, len }] 匹配位置（logLines 显示行索引）
  pos: -1,            // 当前命中的 matches 下标
};

// 连续溢出检测（模块级，供测试重置）
/** @type {number} 连续到达日志边界的计数（用于 follow 模式自动切换） */
export let _consecBoundary = 0;
/** 重置连续边界计数器为 0（测试用） */
export function resetConsecBoundary() { _consecBoundary = 0; }

// ── 渲染辅助 ───────────────────────────────────────

// highlightRange / highlightSlot / highlightLine / underlineRange / applyLogSelection / applyLogSearch
// 已提取到 highlight.mjs，此处 re-export 保持向后兼容
/**
 * 从 highlight.mjs re-export 的渲染辅助函数（保持向后兼容）
 * @see module:highlight
 */
export { highlightLine, highlightSlot, applyLogSelection, applyLogSearch } from './highlight.mjs';

/**
 * 计算树行内所有可交互元素（箭头、复选框），按列排序。
 * @param {number} lineIdx - 行索引
 * @param {object[]} markers - 各行箭头标记数组
 * @param {string[]} lines - 树区所有行文本
 * @returns {{ col: number, width: number, type: 'toggle'|'checkbox', node?: object, cbIdx?: number }[]}
 */
export function getTreeSlots(lineIdx, markers, lines) {
  const slots = [];
  // 箭头 toggles → 占 3 列（左侧空格 + 图标 + 右侧空格）
  const lineMarkers = markers[lineIdx];
  if (lineMarkers) {
    for (const m of lineMarkers) {
      slots.push({ col: Math.max(0, m.col - 1), width: 3, type: 'toggle', node: m.node });
    }
  }
  // 复选框 → 占 3 列（左侧空格 + 图标 + 右侧空格）
  if (lineIdx >= 0 && lineIdx < lines.length) {
    const cbs = findCheckboxes(lines[lineIdx]);
    for (const cb of cbs) {
      slots.push({ col: Math.max(0, cb.col - 1), width: 3, type: 'checkbox', cbIdx: cb.idx });
    }
  }
  slots.sort((a, b) => a.col - b.col);
  return slots;
}

/**
 * 每帧渲染后调用，确保光标不越界（基于内容绝对索引）。
 * @param {object} [treeCtx] - 树区上下文，包含 lines 等
 * @param {object} [logCtx] - 日志区上下文，包含 lineToEntry 等
 * @returns {void}
 */
export function clampCursors(treeCtx, logCtx) {
  const s = focusState;
  if (treeCtx && treeCtx.lines.length > 0) {
    if (s.treeCursor >= treeCtx.lines.length) s.treeCursor = Math.max(0, treeCtx.lines.length - 1);
  }
  if (logCtx && logCtx.lineToEntry.length > 0) {
    if (s.logCursor >= logCtx.lineToEntry.length) s.logCursor = Math.max(0, logCtx.lineToEntry.length - 1);
    // 逻辑列不随行宽截断：实际位置在渲染时取 min(逻辑列, 行末)
  }
}

/**
 * 日志光标的实际列（状态栏/光标块使用）：逻辑列超过行末时退到行末。
 * @param {object} logCtx - 日志区上下文，包含 logLines 等
 * @returns {number} 实际列位置
 */
export function cursorActualCol(logCtx) {
  const lines = logCtx && logCtx.logLines;
  if (!lines || lines.length === 0 || focusState.logCursor < 0 || focusState.logCursor >= lines.length) {
    return Math.max(0, focusState.logCol);
  }
  return Math.min(focusState.logCol, lineWidth(lines[focusState.logCursor]));
}

// ── 内部工具 ───────────────────────────────────────

/**
 * 行内容宽度：去除 ANSI 与尾部补齐空白。
 * wrapLine 会把每行补齐到满宽，vim 的 $ 应落在内容末尾而非补齐空白处。
 * @param {string} line - 原始行文本（含 ANSI 转义）
 * @returns {number} 可见内容宽度
 */
export function lineWidth(line) {
  return term.width((line || '').replace(/[ \t]+$/, ''));
}

/**
 * 重置 vim 状态到 normal 模式。
 * @returns {void}
 */
function resetVimToNormal() {
  vimMode.mode = 'normal';
  vimMode.count = 0;
  logSel.active = false;
}

/**
 * 计算可见区域的行范围（供鼠标点击定位）。
 * @param {object} scrollState - 滚动状态，包含 maxIndex
 * @param {number} height - 可用高度（行数）
 * @param {number} totalLines - 内容总行数
 * @returns {{ bodyH: number, minIdx: number }} 可见区域高度和最小可见行索引
 */
function getVisibleRange(scrollState, height, totalLines) {
  const bodyH = totalLines > height ? height - 1 : totalLines;
  const minIdx = Math.max(0, scrollState.maxIndex - bodyH + 1);
  return { bodyH, minIdx };
}

/**
 * 下一个词首（从 col 之后开始，空格分隔的简化 vim 词）。
 * @param {string} text - 纯文本行内容
 * @param {number} col - 当前列位置
 * @returns {number} 下一个词首的列位置
 */
function nextWordStart(text, col) {
  const n = text.length;
  let i = Math.min(col, n);
  while (i < n && text[i] === ' ') i++;
  while (i < n && text[i] !== ' ') i++;
  while (i < n && text[i] === ' ') i++;
  return i;
}

/**
 * 上一个词首（光标在词中时先回到当前词首）。
 * @param {string} text - 纯文本行内容
 * @param {number} col - 当前列位置
 * @returns {number} 上一个词首的列位置
 */
function prevWordStart(text, col) {
  const n = text.length;
  let i = Math.min(col, n);
  if (i < n && text[i] !== ' ' && (i === 0 || text[i - 1] !== ' ')) {
    while (i > 0 && text[i - 1] !== ' ') i--;
    return i;
  }
  while (i > 0 && text[i - 1] === ' ') i--;
  while (i > 0 && text[i - 1] !== ' ') i--;
  return i;
}

/**
 * 当前/下一个词尾。
 * @param {string} text - 纯文本行内容
 * @param {number} col - 当前列位置
 * @returns {number} 词尾的列位置
 */
function wordEnd(text, col) {
  const n = text.length;
  let i = Math.min(col, n);
  while (i < n && text[i] === ' ') i++;
  while (i < n && text[i] !== ' ') i++;
  return Math.max(col, Math.min(i, n) - 1);
}

/**
 * 确保光标在可见区域内，否则最小位移滚屏。
 * @param {object} scrollState - 滚动状态，包含 maxIndex
 * @param {number} height - 可用高度（行数）
 * @param {number} totalLines - 内容总行数
 * @param {number} cursor - 当前光标行索引
 * @returns {void}
 */
function ensureCursorVisible(scrollState, height, totalLines, cursor) {
  const bodyH = totalLines > height ? height - 1 : totalLines;
  const minIdx = Math.max(0, scrollState.maxIndex - bodyH + 1);
  if (cursor < minIdx) {
    scrollState.maxIndex = cursor + bodyH - 1;
    if (totalLines > height && scrollState.maxIndex < height - 2) {
      scrollState.maxIndex = height - 2;
    }
  } else if (cursor > scrollState.maxIndex) {
    scrollState.maxIndex = Math.min(totalLines - 1, cursor);
  }
}

/**
 * 在行文本中查找所有复选框符号（☐/☑），跳过 ANSI 转义。
 * @param {string} line - 原始行文本（含 ANSI 转义）
 * @returns {{ col: number, idx: number }[]} 复选框位置列表，col 为可见列，idx 为同行列内索引
 */
function findCheckboxes(line) {
  const results = [];
  let i = 0;
  const chars = new Set(['\u2610', '\u2611']);
  while (i < line.length) {
    if (line[i] === '\x07' || line[i] === '\x1b') {
      i = core.skipAnsi(line, i);
      continue;
    }
    if (chars.has(line[i])) {
      results.push({ col: term.width(line.slice(0, i)), idx: results.length });
    }
    i++;
  }
  return results;
}

// ── 初始化：注册全局事件 ────────────────────────────

/**
 * @param {object} opts
 * @param {() => object} opts.getTreeCtx  — 返回 { y, height, scrollState, lines, nodeAtLine, markers }
 * @param {() => object} opts.getLogCtx   — 返回 { y, height, scrollState, lineToEntry }
 * @param {() => object} opts.getFooterCtx — 返回 { y }
 * @param {object} opts.filterState
 * @param {() => object} opts.getTree      — 返回当前树根节点（惰性获取，避免 reassign 后引用失效）
 * @param {number} [opts.logSelEntryIdx]  — 返回选中条目索引的 getter
 * @param {object} opts.filterRow         — createFilterRow 返回的 { handleKey, handleClick }
 * @param {() => void} opts.onUpdate      — 状态变化后触发重绘
 * @param {(sel: object) => void} [opts.onCopy] — 右键复制回调，传入当前 logSel
 * @param {() => boolean} [opts.isExitPanelVisible] — 退出面板是否可见
 * @param {() => boolean} [opts.isHelpVisible] — 帮助页是否可见
 * @returns {void}
 */
export function initFocus(opts) {
  const {
    getTreeCtx, getLogCtx, getFooterCtx,
    filterState, getTree,
    logSelEntryIdxRef,
    filterRow,
    onUpdate,
    onCopy,
    onCopyAll,
    isExitPanelVisible,
    isHelpVisible,
  } = opts;

  const locked = () => (isExitPanelVisible && isExitPanelVisible()) || (isHelpVisible && isHelpVisible());

  // ── 键盘交互恢复焦点可见性 ──────────────────────

  on('key', () => {
    if (locked()) return;
    focusState.focusVisible = true;
  });

  // ── Tab 切换焦点 ─────────────────────────────────

  on('key', (k) => {
    if (locked()) return;
    if (k.name !== 'tab') return;
    const prev = focusState.focus;
    // 焦点顺序：tree → log（Vim模式）→ Follow/Vim按钮 → footer
    // （Copy 按钮仅通过 h/l 从 Follow 按钮切换到达，不参与 Tab 循环）
    const order = vimMode.mode === 'follow'
      ? ['tree', 'log-follow-btn', 'footer']
      : ['tree', 'log', 'log-follow-btn', 'footer'];
    let idx = order.indexOf(focusState.focus);
    if (idx < 0) idx = 0;
    if (k.shift) {
      idx = (idx - 1 + order.length) % order.length;
    } else {
      idx = (idx + 1) % order.length;
    }
    focusState.focus = order[idx];
    if (prev === 'footer' && focusState.focus !== 'footer' && filterRow) {
      filterRow.exitEditing();
    }
    if (prev === 'log' && focusState.focus !== 'log') {
      vimMode.mode = 'normal';
      vimMode.count = 0;
      logSel.active = false;
      logSearch.active = false;
      logSearch.query = '';
      logSearch.matches = [];
      logSearch.pos = -1;
    }
    onUpdate();
  });

  // ── 树 ───────────────────────────────────────────

  on('key', (k) => {
    if (locked()) return;
    if (focusState.focus !== 'tree') return;
    const ctx = getTreeCtx();
    if (!ctx || !ctx.scrollState) return;
    const s = focusState;

    // ↑/k → 光标上移（重置行内位置）
    if (k.name === 'up' || k.name === 'k') {
      if (ctx.lines.length === 0) return;
      s.treeCursor = Math.max(0, s.treeCursor - 1);
      s.treeSlot = 0;
      ensureCursorVisible(ctx.scrollState, ctx.height, ctx.lines.length, s.treeCursor);
      onUpdate(); return;
    }
    if (k.name === 'down' || k.name === 'j') {
      if (ctx.lines.length === 0) return;
      s.treeCursor = Math.min(ctx.lines.length - 1, s.treeCursor + 1);
      s.treeSlot = 0;
      ensureCursorVisible(ctx.scrollState, ctx.height, ctx.lines.length, s.treeCursor);
      onUpdate(); return;
    }

    if (k.name === 'home') {
      s.treeCursor = 0; s.treeSlot = 0;
      ctx.scrollState.maxIndex = Math.max(0, Math.min(ctx.height, ctx.lines.length) - 1);
      onUpdate(); return;
    }
    if (k.name === 'end') {
      s.treeCursor = ctx.lines.length - 1; s.treeSlot = 0;
      ctx.scrollState.maxIndex = ctx.lines.length - 1;
      onUpdate(); return;
    }

    // shift+←/→ → 横向滚动树视图（treeX，步进 4 列）
    if (k.shift && (k.name === 'left' || k.name === 'right')) {
      const maxOff = Math.max(0, (ctx.contentW || 0) - (ctx.viewW || 0));
      const delta = k.name === 'left' ? -4 : 4;
      ctx.treeX = Math.max(0, Math.min(maxOff, (ctx.treeX || 0) + delta));
      onUpdate(); return;
    }

    // ←/→/h/l → 行内元素导航（同时确保光标在视图内）
    if (k.name === 'left' || k.name === 'right' || k.name === 'h' || k.name === 'l') {
      const lineIdx = s.treeCursor;
      const slots = getTreeSlots(lineIdx, ctx.markers, ctx.lines);
      if (k.name === 'left' || k.name === 'h') {
        s.treeSlot = Math.max(0, s.treeSlot - 1);
      } else {
        s.treeSlot = Math.min(slots.length - 1, Math.max(0, s.treeSlot + 1));
      }
      ensureCursorVisible(ctx.scrollState, ctx.height, ctx.lines.length, s.treeCursor);
      onUpdate(); return;
    }

    // enter / space → 统一操作当前行内聚焦元素
    if (k.name === 'return' || k.name === 'space') {
      const lineIdx = s.treeCursor;
      const slots = getTreeSlots(lineIdx, ctx.markers, ctx.lines);
      const slot = slots[s.treeSlot];

      if (!slot) return;

      if (slot.type === 'toggle') {
        const toggled = treeClick(lineIdx, slot.col + 1, ctx.nodeAtLine, ctx.markers);
        if (toggled) { onUpdate(); return; }
      }

      if (slot.type === 'checkbox') {
        const base = ctx.nodeAtLine[lineIdx];
        if (!base) return;
        const chain = collectChain(base);
        if (slot.cbIdx > 0 && chain.length > 1) {
          const t = chain[slot.cbIdx];
          if (t) { t.logFilter = ((t.logFilter ?? 1) + 1) % 2; onUpdate(); }
        } else {
          base.logFilter = ((base.logFilter ?? 1) + 1) % 2; onUpdate();
        }
      }
    }
  });

  // ── 日志（vim 只读模式：follow / normal / visual） ──

  let _lastGTime = 0; // gg 双击判定
  let _lastYTime = 0; // yy 双击判定
  let _searchRestore = null; // / 搜索激活时的光标恢复点

  on('key', (k) => {
    if (locked()) return;
    if (focusState.focus !== 'log') return;
    const ctx = getLogCtx();
    if (!ctx || !ctx.scrollState) return;
    const s = focusState;
    const total = ctx.lineToEntry.length;

    // Follow → Normal/Visual：任意 vim 键触发模式切换
    if (vimMode.mode === 'follow' && !k.consumed) {
      vimMode.mode = 'normal';
    }

    // visual 激活时，选区终点跟随光标移动
    function syncVisual() {
      if (vimMode.mode === 'normal' || vimMode.mode === 'follow') return;
      logSel.endLine = s.logCursor;
      logSel.endCol = actualCol();
      logSel.active = true;
    }

    /** 当前行内容宽度 */
    function curLineWidth() {
      return lineWidth(ctx.logLines[s.logCursor]);
    }

    /** 实际列：逻辑列超过行末时退到行末（渲染/状态栏/选区使用） */
    function actualCol() {
      return Math.min(s.logCol, curLineWidth());
    }

    /**
     * 移动到指定行/列（纵向移动保留逻辑列，不随行宽截断；滚屏可见 + visual 同步）。
     * 横向移动由调用方保证 col 在当前行范围内，逻辑列与实际列同步。
     */
    function moveTo(line, col) {
      if (total === 0) return;
      s.logCursor = Math.min(total - 1, Math.max(0, line));
      if (typeof col === 'number' && col >= 0) s.logCol = col;
      ensureCursorVisible(ctx.scrollState, ctx.height, total, s.logCursor);
      syncVisual();
      onUpdate();
    }

    /** 当前行纯文本（用于词移动） */
    function curText() {
      return term.plain(ctx.logLines[s.logCursor] || '');
    }

    /** 消费 pending count（无则 1），并清零 */
    function takeCount() {
      const n = vimMode.count || 1;
      vimMode.count = 0;
      return n;
    }

    /** 按当前 query 重算匹配列表和当前位置（不跳转光标） */
    function recomputeSearch() {
      const q = logSearch.query.toLowerCase();
      logSearch.matches = [];
      logSearch.pos = -1;
      if (q) {
        for (let li = 0; li < ctx.logLines.length; li++) {
          const text = term.plain(ctx.logLines[li]).toLowerCase();
          let idx = text.indexOf(q);
          while (idx >= 0) {
            logSearch.matches.push({ line: li, col: idx, len: q.length });
            idx = text.indexOf(q, idx + q.length);
          }
        }
      }
      findCurrentPos();
      onUpdate();
    }

    /** 计算当前匹配位置（光标之后最近的匹配，回绕） */
    function findCurrentPos() {
      const m = logSearch.matches;
      if (!m.length) { logSearch.pos = -1; return; }
      const cur = s.logCursor;
      for (let i = 0; i < m.length; i++) {
        if (m[i].line > cur || (m[i].line === cur && m[i].col >= s.logCol)) { logSearch.pos = i; return; }
      }
      logSearch.pos = 0; // 回绕到第一个匹配
    }

    /** 从当前位置向后(dir>0)/向前(dir<0)跳转匹配（回绕） */
    function jumpSearch(dir) {
      const m = logSearch.matches;
      if (!m.length) return;
      const cur = s.logCursor;
      let next = -1;
      if (dir > 0) {
        for (let i = 0; i < m.length; i++) {
          if (m[i].line > cur || (m[i].line === cur && m[i].col > s.logCol)) { next = i; break; }
        }
        if (next < 0) next = 0;
      } else {
        for (let i = m.length - 1; i >= 0; i--) {
          if (m[i].line < cur || (m[i].line === cur && m[i].col < s.logCol)) { next = i; break; }
        }
        if (next < 0) next = m.length - 1;
      }
      logSearch.pos = next;
      moveTo(m[next].line, m[next].col);
    }

    /** 取消搜索并恢复光标 */
    function cancelSearch() {
      logSearch.active = false;
      logSearch.query = '';
      logSearch.matches = [];
      logSearch.pos = -1;
      if (_searchRestore) {
        moveTo(_searchRestore.line, _searchRestore.col);
        _searchRestore = null;
      } else {
        onUpdate();
      }
    }

    // ── 数字前缀（vim count）：0 在有 pending count 时为数字，否则为行首 ──
    if (!k.ctrl && !k.meta && /^[1-9]$/.test(k.name)) {
      vimMode.count = vimMode.count * 10 + parseInt(k.name, 10);
      onUpdate();
      return;
    }
    if (!k.ctrl && !k.meta && k.name === '0') {
      if (vimMode.count > 0) {
        // 有 pending count 时 0 是数字（如 10j）
        vimMode.count = vimMode.count * 10;
        onUpdate();
      } else {
        // 无 pending count 时 0 = 行首
        moveTo(s.logCursor, term.PREFIX_W);
      }
      return;
    }

    // ── ESC：退出跟随 / 搜索 / 清除 count（其余交给 bindExitPanel） ──
    if (k.name === 'escape') {
      if (vimMode.mode === 'follow') {
        vimMode.mode = 'normal'; k.consumed = true; onUpdate(); return;
      }
      if (logSearch.active) {
        k.consumed = true;
        cancelSearch();
        return;
      }
      if (vimMode.count > 0) {
        vimMode.count = 0;
        k.consumed = true; // 只吞掉“清除数字前缀”这次 ESC，避免误弹退出面板
        onUpdate();
      }
      return;
    }

    // ── / 搜索：激活输入（normal 模式） ──
    if (!k.ctrl && !k.meta && k.name === '/' && vimMode.mode === 'normal') {
      logSearch.active = true;
      logSearch.query = '';
      _searchRestore = { line: s.logCursor, col: s.logCol };
      logSearch.matches = [];
      logSearch.pos = -1;
      onUpdate();
      return;
    }

    // ── 搜索输入中：只处理查询编辑 ──
    if (logSearch.active) {
      if (k.name === 'escape' || (k.ctrl && k.name === 'c')) {
        k.consumed = true;
        cancelSearch();
        return;
      }
      if (k.name === 'backspace') {
        logSearch.query = logSearch.query.slice(0, -1);
        recomputeSearch();
        return;
      }
      if (k.name === 'return' || k.name === 'enter') {
        logSearch.active = false;
        logSearch.lastQuery = logSearch.query;
        logSearch.query = '';
        if (!logSearch.lastQuery) { logSearch.matches = []; logSearch.pos = -1; _searchRestore = null; onUpdate(); }
        else if (logSearch.matches.length) { jumpSearch(1); }
        else { onUpdate(); }
        return;
      }
      if (k.name.length === 1 && !k.ctrl && !k.meta) {
        logSearch.query += k.name;
        recomputeSearch();
        return;
      }
      return; // 搜索输入中忽略其他按键
    }

    // ── n / N：下一个 / 上一个匹配 ──
    if (!k.ctrl && !k.meta && (k.name === 'n' || k.name === 'N') && logSearch.lastQuery) {
      logSearch.query = logSearch.lastQuery;
      recomputeSearch();
      if (logSearch.matches.length) jumpSearch(k.name === 'n' ? 1 : -1);
      return;
    }

    // ── 上下移动（normal + visual 共用，支持数字前缀） ──
    if (k.name === 'up' || k.name === 'k') {
      const n = takeCount(); moveTo(s.logCursor - n);
      _consecBoundary = 0;
      return;
    }
    if (k.name === 'down' || k.name === 'j') {
      const n = takeCount();
      moveTo(s.logCursor + n);
      // moveTo 后检测：光标在末行且视觉位置在行末
      if (s.logCursor >= total - 1 && actualCol() >= curLineWidth()) {
        _consecBoundary++;
        if (_consecBoundary >= 2 && vimMode.mode !== 'follow') {
          vimMode.mode = 'follow'; vimMode.count = 0;
          logSel.active = false;
          const lastW = lineWidth(ctx.logLines[total - 1] || '');
          moveTo(total - 1, Math.max(term.PREFIX_W, lastW));
        }
      } else {
        _consecBoundary = 0;
        if (vimMode.mode === 'follow') vimMode.mode = 'normal';
      }
      return;
    }

    // ── 左右移动（基于实际列，钳制在 [term.PREFIX_W, lineWidth]） ──
    if (k.name === 'left' || k.name === 'h') {
      const n = takeCount(); moveTo(s.logCursor, Math.max(term.PREFIX_W, actualCol() - n));
      _consecBoundary = 0;
      if (vimMode.mode === 'follow') vimMode.mode = 'normal';
      return;
    }
    if (k.name === 'right' || k.name === 'l') {
      const n = takeCount();
      moveTo(s.logCursor, Math.min(curLineWidth(), actualCol() + n));
      if (s.logCursor >= total - 1 && actualCol() >= curLineWidth()) {
        _consecBoundary++;
        if (_consecBoundary >= 2 && vimMode.mode !== 'follow') {
          vimMode.mode = 'follow'; vimMode.count = 0;
          logSel.active = false;
          const lastW = lineWidth(ctx.logLines[total - 1] || '');
          moveTo(total - 1, Math.max(term.PREFIX_W, lastW));
        }
      } else {
        _consecBoundary = 0;
        if (vimMode.mode === 'follow') vimMode.mode = 'normal';
      }
      return;
    }

    // ── 行内定位：^ / $ ──
    if (k.name === '^') {
      takeCount();
      const t = curText();
      const first = t.search(/\S/);
      moveTo(s.logCursor, first < 0 ? term.PREFIX_W : Math.max(term.PREFIX_W, first));
      return;
    }
    if (k.name === '$') {
      takeCount();
      moveTo(s.logCursor, curLineWidth());
      return;
    }

    // ── 词移动：w / b / e（支持数字前缀） ──
    if (k.name === 'w') {
      const n = takeCount();
      let col = s.logCol;
      for (let t = 0; t < n; t++) col = nextWordStart(curText(), col);
      moveTo(s.logCursor, col);
      return;
    }
    if (k.name === 'b') {
      const n = takeCount();
      let col = s.logCol;
      for (let t = 0; t < n; t++) col = prevWordStart(curText(), col);
      moveTo(s.logCursor, col);
      return;
    }
    if (k.name === 'e') {
      const n = takeCount();
      let col = s.logCol;
      for (let t = 0; t < n; t++) col = wordEnd(curText(), col);
      moveTo(s.logCursor, col);
      return;
    }

    // ── home / end / gg / G：跳到顶部 / 底部 ──
    if (k.name === 'home') { takeCount(); moveTo(0, s.logCol); return; }
    if (k.name === 'end') { takeCount(); moveTo(total - 1, s.logCol); return; }
    if (!k.ctrl && !k.meta && k.name === 'g') {
      const n = vimMode.count;
      if (n > 0) { vimMode.count = 0; moveTo(Math.min(total - 1, n - 1), 0); return; }
      const now = Date.now();
      if (_lastGTime && now - _lastGTime < 500) {
        _lastGTime = 0;
        moveTo(0, s.logCol);
        return;
      }
      _lastGTime = now;
      return;
    }
    if (!k.ctrl && !k.meta && k.name === 'G') {
      const n = vimMode.count;
      vimMode.count = 0;
      moveTo(n > 0 ? Math.min(total - 1, n - 1) : total - 1, s.logCol);
      return;
    }

    // ── 整页/半页滚动：Ctrl+f / Ctrl+b / PageDown / PageUp / Ctrl+d / Ctrl+u ──
    if (k.ctrl && (k.name === 'f' || k.name === 'b')) {
      const step = takeCount() * Math.max(1, (ctx.height || 10) - 1);
      const dir = k.name === 'f' ? 1 : -1;
      if (total === 0) return;
      if (total <= ctx.height) {
        moveTo(dir > 0 ? total - 1 : 0, s.logCol);
      } else {
        const bodyH = ctx.height - 1;
        if (dir > 0) {
          const newMax = Math.min(total - 1, ctx.scrollState.maxIndex + step);
          ctx.scrollState.maxIndex = newMax;
          moveTo(newMax, s.logCol);
        } else {
          const newMax = Math.max(ctx.height - 2, ctx.scrollState.maxIndex - step);
          ctx.scrollState.maxIndex = newMax;
          moveTo(Math.max(0, newMax - bodyH + 1), s.logCol);
        }
      }
      return;
    }
    if (k.name === 'pagedown' || k.name === 'pageup') {
      const step = takeCount() * Math.max(1, (ctx.height || 10) - 1);
      const dir = k.name === 'pagedown' ? 1 : -1;
      if (total === 0) return;
      if (total <= ctx.height) {
        moveTo(dir > 0 ? total - 1 : 0, s.logCol);
      } else {
        const bodyH = ctx.height - 1;
        if (dir > 0) {
          const newMax = Math.min(total - 1, ctx.scrollState.maxIndex + step);
          ctx.scrollState.maxIndex = newMax;
          moveTo(newMax, s.logCol);
        } else {
          const newMax = Math.max(ctx.height - 2, ctx.scrollState.maxIndex - step);
          ctx.scrollState.maxIndex = newMax;
          moveTo(Math.max(0, newMax - bodyH + 1), s.logCol);
        }
      }
      return;
    }
    if (k.ctrl && (k.name === 'd' || k.name === 'u')) {
      const step = takeCount() * Math.max(1, Math.floor((ctx.height || 10) / 2));
      const dir = k.name === 'd' ? 1 : -1;
      moveTo(s.logCursor + dir * step, s.logCol);
      return;
    }

    // ── v：进入 / 退出 visual 模式 ──
    if (!k.ctrl && !k.meta && k.name === 'v') {
      if (total === 0) return;
      vimMode.count = 0;
      if (vimMode.mode === 'visual') {
        vimMode.mode = 'normal';
        logSel.active = false;
      } else {
        vimMode.mode = 'visual';
        logSel.active = true;
        logSel.startLine = s.logCursor;
        logSel.startCol = actualCol();
        logSel.endLine = s.logCursor;
        logSel.endCol = actualCol();
      }
      onUpdate(); return;
    }

    if (k.name === 'return' || k.name === 'space') {
      // log 区域 Enter/Space 暂无操作（只读）
    }

    // ── q：退出 visual 模式 ──
    if (!k.ctrl && !k.meta && k.name === 'q' && vimMode.mode !== 'normal') {
      vimMode.mode = 'normal';
      logSel.active = false;
      onUpdate();
      return;
    }

    // ── y / yy：yank 复制 ──
    if (!k.ctrl && !k.meta && k.name === 'y') {
      vimMode.count = 0;
      if (vimMode.mode !== 'normal') {
        // visual 中 y → 复制选区
        if (logSel.active && onCopy) {
          k.consumed = true;
          onCopy({ ...logSel });
          logSel.active = false;
          vimMode.mode = 'normal';
          onUpdate();
        }
        return;
      }
      // normal 中 yy → 复制当前行
      const now = Date.now();
      if (_lastYTime && now - _lastYTime < 500) {
        _lastYTime = 0;
        if (onCopy) {
          k.consumed = true;
          onCopy({ active: true, startLine: s.logCursor, endLine: s.logCursor, startCol: term.PREFIX_W, endCol: Infinity });
          onUpdate();
        }
        return;
      }
      _lastYTime = now;
      return;
    }

    // ── Ctrl+C / Ctrl+Shift+C：复制选中文本 ──
    const isCopyKey = k.ctrl && (k.name === 'c' || (k.name === 'right' && k.shift));
    if (isCopyKey && logSel.active && onCopy) {
      k.consumed = true;
      onCopy({ ...logSel });
      logSel.active = false;
      vimMode.mode = 'normal';
      onUpdate();
      return;
    }
    // ── c：复制当前筛选视图下的全部日志（normal 模式、无选中时） ──
    if (!k.ctrl && !k.meta && k.name === 'c' && vimMode.mode === 'normal' && onCopyAll) {
      vimMode.count = 0;
      onCopyAll();
      onUpdate();
      return;
    }
  });

  // ── 日志状态栏按钮焦点：左右箭头切换 ──
  on('key', (k) => {
    if (locked()) return;
    if (focusState.focus === 'log-follow-btn' || focusState.focus === 'log-copy-btn') {
      if (k.name === 'left' || k.name === 'h') {
        focusState.focus = 'log-follow-btn';
        onUpdate(); return;
      }
      if (k.name === 'right' || k.name === 'l') {
        focusState.focus = 'log-copy-btn';
        onUpdate(); return;
      }
      if (k.name === 'return' || k.name === 'space') {
        // Enter/Space 触发按钮动作（由 demos 处理）
        onUpdate(); return;
      }
    }
  });

  // ── footer ───────────────────────────────────────

  on('key', (k) => {
    if (locked()) return;
    if (focusState.focus !== 'footer') return;
    if (filterRow && filterRow.handleKey(k)) return;
  });

  // ── 鼠标点击（树 & footer） ──────────────────────

  on('click', (e) => {
    if (locked()) return;
    focusState.focusVisible = false;
    const treeCtx = getTreeCtx();
    const footerCtx = getFooterCtx();

    // 树
    if (treeCtx && treeCtx.scrollState) {
      const bodyH = treeCtx.lines.length > treeCtx.height ? treeCtx.height - 1 : treeCtx.height;
      if (e.y >= treeCtx.y && e.y < treeCtx.y + bodyH) {
        const wasFooter = focusState.focus === 'footer';
        focusState.focus = 'tree';
        if (wasFooter && filterRow) filterRow.exitEditing();
        const minIdx = Math.max(0, treeCtx.scrollState.maxIndex - bodyH + 1);
        const lineIdx = minIdx + (e.y - treeCtx.y);
        focusState.treeCursor = lineIdx;

        // 根据点击位置设定 treeSlot
        const slots = getTreeSlots(lineIdx, treeCtx.markers, treeCtx.lines);
        let hitSlot = -1;
        for (let si = 0; si < slots.length; si++) {
          if (e.x >= slots[si].col && e.x < slots[si].col + slots[si].width) {
            hitSlot = si; break;
          }
        }
        focusState.treeSlot = Math.max(0, hitSlot);

        const toggled = treeClick(lineIdx, e.x, treeCtx.nodeAtLine, treeCtx.markers);
        if (toggled) { onUpdate(); return; }

        if (lineIdx >= 0 && lineIdx < treeCtx.lines.length) {
          const cbs = findCheckboxes(treeCtx.lines[lineIdx]);
          const hit = cbs.find((cb) => e.x >= cb.col && e.x < cb.col + 1);
          if (hit) {
            const base = treeCtx.nodeAtLine[lineIdx];
            if (base) {
              const chain = collectChain(base);
              if (cbs.length > 1 && chain.length > 1) {
                const t = chain[hit.idx]; if (t) { t.logFilter = ((t.logFilter ?? 1) + 1) % 2; }
              } else { base.logFilter = ((base.logFilter ?? 1) + 1) % 2; }
            }
            onUpdate();
          }
        }
        return;
      }
    }

    // 日志区点击 → normal 模式
    const logCtx = getLogCtx();
    if (logCtx && logCtx.scrollState && e.y >= logCtx.y && e.y < logCtx.y + logCtx.height) {
      if (vimMode.mode !== 'normal') {
        vimMode.mode = 'normal';
        onUpdate();
      }
      return;
    }

    // footer
    if (footerCtx && e.y === footerCtx.y) {
      focusState.focus = 'footer';
      if (filterRow && filterRow.handleClick(e, e.y)) return;
    }
  });

  // ── log 拖拽选择 ────────────────────────────────

  let _dragStart = null; // { line, col }

  on('mouse', (e) => {
    if (locked()) return;
    if (e.type !== 'down') return;
    if (e.btn !== 0) return; // 仅左键拖拽
    focusState.focusVisible = false;
    const ctx = getLogCtx();
    if (!ctx || !ctx.scrollState) return;
    if (e.y < ctx.y || e.y >= ctx.y + ctx.height) return;

    const wasFooter = focusState.focus === 'footer';
    focusState.focus = 'log';
    if (wasFooter && filterRow) filterRow.exitEditing();
    // 拖拽 → visual 模式
    if (vimMode.mode !== 'visual') {
      vimMode.mode = 'visual';
      vimMode.count = 0;
    }
    const bodyH = ctx.lineToEntry.length > ctx.height ? ctx.height - 1 : ctx.lineToEntry.length;
    const minIdx = Math.max(0, ctx.scrollState.maxIndex - bodyH + 1);
    const lineIdx = minIdx + (e.y - ctx.y);
    if (lineIdx < 0 || lineIdx >= ctx.lineToEntry.length) return;

    focusState.logCursor = lineIdx;
    const col = Math.max(term.PREFIX_W, e.x - 1); // 减去边框 1 列，跳过前缀
    focusState.logCol = col;
    _dragStart = { line: lineIdx, col };
    logSel.selecting = true;
    logSel.active = false;
    logSel.startLine = lineIdx;
    logSel.endLine = lineIdx;
    logSel.startCol = col;
    logSel.endCol = col;
    vimMode.mode = 'normal'; // 鼠标拖拽选区会覆盖 vim visual 选区
    onUpdate();
  });

  on('mouse', (e) => {
    if (locked()) return;
    if (e.type !== 'move') return;
    if (!logSel.selecting || !_dragStart) return;
    const ctx = getLogCtx();
    if (!ctx || !ctx.scrollState || ctx.lineToEntry.length === 0) return;

    const bodyH = ctx.lineToEntry.length > ctx.height ? ctx.height - 1 : ctx.lineToEntry.length;
    const minIdx = Math.max(0, ctx.scrollState.maxIndex - bodyH + 1);

    // 鼠标在日志面板内 → 正常跟踪行/列
    if (e.y >= ctx.y && e.y < ctx.y + ctx.height) {
      const lineIdx = minIdx + (e.y - ctx.y);
      if (lineIdx < 0 || lineIdx >= ctx.lineToEntry.length) return;
      logSel.endLine = lineIdx;
      logSel.endCol = Math.max(term.PREFIX_W, e.x - 1);
      logSel.active = true;
      onUpdate();
      return;
    }

    // 鼠标拖出面板上方 → 向上滚动扩展选区
    if (e.y < ctx.y && ctx.scrollState.maxIndex > 0) {
      ctx.scrollState.maxIndex--;
      logSel.endLine = minIdx - 1;
      logSel.endCol = term.PREFIX_W;
      logSel.active = true;
      onUpdate();
      return;
    }

    // 鼠标拖出面板下方 → 向下滚动扩展选区
    if (e.y >= ctx.y + ctx.height && ctx.scrollState.maxIndex < ctx.lineToEntry.length - 1) {
      ctx.scrollState.maxIndex++;
      logSel.endLine = ctx.scrollState.maxIndex;
      logSel.endCol = Infinity;
      logSel.active = true;
      onUpdate();
      return;
    }
  });

  on('mouse', (e) => {
    if (locked()) return;
    if (e.type !== 'up') return;
    if (!logSel.selecting) return;
    logSel.selecting = false;

    // 若起止相同 → 视为单击（无操作）
    if (logSel.startLine === logSel.endLine && logSel.startCol === logSel.endCol) {
      logSel.active = false;
    }
    _dragStart = null;
    onUpdate();
  });

  // ── 右键复制选中文本 ──────────────────────────

  on('mouse', (e) => {
    if (locked()) return;
    if (e.type !== 'down' || e.btn !== 2) return;
    if (!logSel.active) return;

    if (onCopy) onCopy({ ...logSel });
    logSel.active = false;
    onUpdate();
  });
}
