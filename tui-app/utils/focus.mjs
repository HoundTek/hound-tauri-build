// 焦点系统：状态管理 + 键盘/点击事件 + 渲染辅助
// 与 makePage 渲染逻辑完全解耦

import { on } from './events.mjs';
import { treeClick, collectChain } from '../components/tree.mjs';
import { textWidth } from './text-width.mjs';
import { charWidth } from './char-width.mjs';

// ── 只读状态 ───────────────────────────────────────

export const focusState = {
  focus: 'tree',      // 'tree' | 'log' | 'footer'
  treeCursor: 0,      // 树区域光标（绝对内容行索引）
  treeSlot: 0,        // 行内元素索引（0=首个箭头/复选框）
  logCursor: 0,       // 日志光标（绝对内容行索引）
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

/** 日志区 vim 模式状态 */
export const vimMode = {
  visual: false,     // visual 模式激活（v 进入，Esc/v 退出）
};

// ── 渲染辅助 ───────────────────────────────────────

const REV    = '\x1b[7m';  // 反白
const REV_OFF = '\x1b[27m';

/** 行高亮：反白效果贯穿整行 */
export function highlightLine(line) {
  return REV + line + REV_OFF;
}

/** log 内容前缀宽度：dot/缩进 2 列（▶ 或两个空格），不可选中 */
const PREFIX_W = 2;

/** 公开：对单行文本的视觉列范围 [colStart, colEnd) 叠加反白效果 */
export function highlightSlot(line, colStart, colEnd) {
  return highlightRange(line, colStart, colEnd);
}

/**
 * 计算树行内所有可交互元素（箭头、复选框），按列排序。
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
 * 在单行文本的视觉列范围 [colStart, colEnd) 上叠加反白效果。
 * 范围内部的 ANSI 码被剥离，确保反白效果一致。
 * colEnd 可传 Infinity 表示行尾。
 */
function highlightRange(line, colStart, colEnd) {
  if (colStart >= colEnd) return line;

  let result = '';
  let visCol = 0;
  let i = 0;
  let started = false;

  while (i < line.length && visCol < colEnd) {
    // ── ANSI 转义序列 ──
    if (line[i] === '\x1b') {
      const start = i;
      i++;
      // OSC 序列: ESC ] ... (BEL 或 ST 终止), 零宽度
      if (i < line.length && line[i] === ']') {
        i++;
        while (i < line.length && line[i] !== '\x07') {
          if (line[i] === '\x1b' && i + 1 < line.length && line[i + 1] === '\\') { i += 2; break; }
          i++;
        }
        if (i < line.length && line[i] === '\x07') i++;
        if (!started) result += line.slice(start, i);
        continue;
      }
      if (i < line.length && '[P_^'.includes(line[i])) i++;
      while (i < line.length && (line[i] < '\x40' || line[i] > '\x7e')) i++;
      if (i < line.length) i++;
      // 范围外保留，范围内剥离
      if (!started) result += line.slice(start, i);
      continue;
    }
    if (line[i] === '\x07') { if (!started) result += line[i]; i++; continue; }

    // ── 普通字符 ──
    const cw = charWidth(line[i]);
    if (!started && visCol >= colStart) {
      result += '\x1b[0m' + REV;
      started = true;
    }
    visCol += cw;
    result += line[i];
    i++;
  }

  if (started) result += REV_OFF;
  if (i < line.length) result += line.slice(i);

  return result;
}

/** 在给定的 lines 数组上应用 logSel 选择高亮（仅选中列范围，跳过前缀） */
export function applyLogSelection(lines) {
  const sel = logSel;
  if (!sel.active || sel.startLine < 0 || sel.endLine < 0) return lines;

  const a = Math.min(sel.startLine, sel.endLine);
  const b = Math.max(sel.startLine, sel.endLine);
  const single = a === b;
  const out = lines.slice();

  for (let i = a; i <= b && i < out.length; i++) {
    let cs = PREFIX_W;
    let ce = Infinity;

    if (single) {
      cs = Math.min(sel.startCol, sel.endCol);
      ce = Math.max(sel.startCol, sel.endCol);
    } else if (i === a) {
      // 首行：从该行的起始列到行尾
      cs = a === sel.startLine ? sel.startCol : sel.endCol;
    } else if (i === b) {
      // 末行：从 PREFIX_W 到该行的结束列
      ce = b === sel.startLine ? sel.startCol : sel.endCol;
    }
    // 中间行：cs=PREFIX_W, ce=Infinity → 跳过前缀整行高亮

    out[i] = highlightRange(out[i], cs, ce);
  }
  return out;
}

/** 每帧渲染后调用，确保光标不越界（基于内容绝对索引） */
export function clampCursors(treeCtx, logCtx) {
  const s = focusState;
  if (treeCtx && treeCtx.lines.length > 0) {
    if (s.treeCursor >= treeCtx.lines.length) s.treeCursor = Math.max(0, treeCtx.lines.length - 1);
  }
  if (logCtx && logCtx.lineToEntry.length > 0) {
    if (s.logCursor >= logCtx.lineToEntry.length) s.logCursor = Math.max(0, logCtx.lineToEntry.length - 1);
  }
}

// ── 内部工具 ───────────────────────────────────────

/** 确保光标在可见区域内，否则最小位移滚屏 */
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

function findCheckboxes(line) {
  const results = [];
  let i = 0;
  const chars = new Set(['\u2610', '\u2611']);
  while (i < line.length) {
    const ch = line[i];
    if (chars.has(ch)) {
      results.push({ col: textWidth(line.slice(0, i)), idx: results.length });
    }
    if (line[i] === '\x1b') {
      i++;
      // OSC 序列: ESC ] ... (BEL 或 ST 终止)
      if (line[i] === ']') {
        i++;
        while (i < line.length && line[i] !== '\x07') {
          if (line[i] === '\x1b' && i + 1 < line.length && line[i + 1] === '\\') { i += 2; break; }
          i++;
        }
        if (i < line.length && line[i] === '\x07') i++;
        continue;
      }
      if ('[P_^'.includes(line[i])) i++;
      while (i < line.length && (line[i] < '\x40' || line[i] > '\x7e')) i++;
      if (i < line.length) i++;
      continue;
    }
    if (line[i] === '\x07') { i++; continue; }
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
 * @param {object} opts.tree              — 树数据（直接修改 logFilter / children）
 * @param {number} [opts.logSelEntryIdx]  — 返回选中条目索引的 getter
 * @param {object} opts.filterRow         — createFilterRow 返回的 { handleKey, handleClick }
 * @param {() => void} opts.onUpdate      — 状态变化后触发重绘
 * @param {(sel: object) => void} [opts.onCopy] — 右键复制回调，传入当前 logSel
 * @param {() => boolean} [opts.isExitPanelVisible] — 退出面板是否可见
 */
export function initFocus(opts) {
  const {
    getTreeCtx, getLogCtx, getFooterCtx,
    filterState, tree,
    logSelEntryIdxRef,
    filterRow,
    onUpdate,
    onCopy,
    onCopyAll,
    isExitPanelVisible,
  } = opts;

  const locked = () => isExitPanelVisible && isExitPanelVisible();

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
    const order = ['tree', 'log', 'footer'];
    const idx = order.indexOf(focusState.focus);
    focusState.focus = k.shift
      ? order[(idx + 2) % 3]
      : order[(idx + 1) % 3];
    if (prev === 'footer' && focusState.focus !== 'footer' && filterRow) {
      filterRow.exitEditing();
    }
    if (prev === 'log' && focusState.focus !== 'log') {
      // 离开日志区时退出 vim visual 选区
      vimMode.visual = false;
      logSel.active = false;
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

    // ←/→ → 行内元素导航（同时确保光标在视图内）
    if (k.name === 'left' || k.name === 'right') {
      const lineIdx = s.treeCursor;
      const slots = getTreeSlots(lineIdx, ctx.markers, ctx.lines);
      if (k.name === 'left') {
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

  // ── 日志（含简易 vim 模式） ──────────────────────

  let _lastGTime = 0; // gg 双击判定

  on('key', (k) => {
    if (locked()) return;
    if (focusState.focus !== 'log') return;
    const ctx = getLogCtx();
    if (!ctx || !ctx.scrollState) return;
    const s = focusState;

    // visual 激活时，选区终点跟随光标移动
    function syncVisualEnd(line) {
      if (!vimMode.visual) return;
      logSel.endLine = line;
      logSel.endCol = Infinity;
      logSel.active = true;
    }

    // ── 光标移动（normal + visual）──
    let target = null;
    if (k.name === 'up' || k.name === 'k') {
      target = Math.max(0, s.logCursor - 1);
    } else if (k.name === 'down' || k.name === 'j') {
      target = Math.min(ctx.lineToEntry.length - 1, s.logCursor + 1);
    } else if (k.name === 'home') {
      target = 0;
    } else if (k.name === 'end') {
      target = ctx.lineToEntry.length - 1;
    }
    if (target !== null) {
      if (ctx.lineToEntry.length === 0) return;
      s.logCursor = target;
      ensureCursorVisible(ctx.scrollState, ctx.height, ctx.lineToEntry.length, s.logCursor);
      syncVisualEnd(s.logCursor);
      onUpdate(); return;
    }

    // ── gg / G：跳到顶部 / 底部 ──
    if (!k.ctrl && !k.meta && k.name === 'g') {
      const now = Date.now();
      if (_lastGTime && now - _lastGTime < 500) {
        _lastGTime = 0;
        if (ctx.lineToEntry.length === 0) return;
        s.logCursor = 0;
        ensureCursorVisible(ctx.scrollState, ctx.height, ctx.lineToEntry.length, s.logCursor);
        syncVisualEnd(0);
        onUpdate(); return;
      }
      _lastGTime = now;
      return;
    }
    if (!k.ctrl && !k.meta && k.name === 'G') {
      if (ctx.lineToEntry.length === 0) return;
      s.logCursor = ctx.lineToEntry.length - 1;
      ensureCursorVisible(ctx.scrollState, ctx.height, ctx.lineToEntry.length, s.logCursor);
      syncVisualEnd(s.logCursor);
      onUpdate(); return;
    }

    // ── Ctrl+d / Ctrl+u：半页滚动 ──
    if (k.ctrl && (k.name === 'd' || k.name === 'u')) {
      if (ctx.lineToEntry.length === 0) return;
      const step = Math.max(1, Math.floor((ctx.height || 10) / 2));
      const dir = k.name === 'd' ? 1 : -1;
      s.logCursor = Math.min(ctx.lineToEntry.length - 1, Math.max(0, s.logCursor + dir * step));
      ensureCursorVisible(ctx.scrollState, ctx.height, ctx.lineToEntry.length, s.logCursor);
      syncVisualEnd(s.logCursor);
      onUpdate(); return;
    }

    // ── v：进入 / 退出 visual 模式 ──
    if (!k.ctrl && !k.meta && k.name === 'v') {
      if (ctx.lineToEntry.length === 0) return;
      if (vimMode.visual) {
        vimMode.visual = false;
        logSel.active = false;
      } else {
        vimMode.visual = true;
        logSel.active = true;
        logSel.startLine = s.logCursor;
        logSel.startCol = PREFIX_W;
        logSel.endLine = s.logCursor;
        logSel.endCol = Infinity;
      }
      onUpdate(); return;
    }

    if (k.name === 'return' || k.name === 'space') {
      // log 区域 Enter/Space 暂无操作
    }

    // ── 复制选中文本 ──
    // Ctrl+C / Ctrl+Shift+C (组合键) 或 y (vim 风格)
    const isCopyKey =
      (k.ctrl && (k.name === 'c' || (k.name === 'right' && k.shift)))  // Ctrl+C / Ctrl+Shift+C
      || (!k.ctrl && !k.meta && k.name === 'y');                        // y (vim yank)
    if (isCopyKey && logSel.active && onCopy) {
      onCopy({ ...logSel });
      logSel.active = false;
      vimMode.visual = false;
      onUpdate();
      return;
    }
    // ── c：复制当前筛选视图下的全部日志（无选中时） ──
    if (!k.ctrl && !k.meta && k.name === 'c' && onCopyAll) {
      onCopyAll();
      onUpdate();
      return;
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
    const bodyH = ctx.lineToEntry.length > ctx.height ? ctx.height - 1 : ctx.lineToEntry.length;
    const minIdx = Math.max(0, ctx.scrollState.maxIndex - bodyH + 1);
    const lineIdx = minIdx + (e.y - ctx.y);
    if (lineIdx < 0 || lineIdx >= ctx.lineToEntry.length) return;

    focusState.logCursor = lineIdx;
    const col = Math.max(PREFIX_W, e.x - 1); // 减去边框 1 列，跳过前缀
    _dragStart = { line: lineIdx, col };
    logSel.selecting = true;
    logSel.active = false;
    logSel.startLine = lineIdx;
    logSel.endLine = lineIdx;
    logSel.startCol = col;
    logSel.endCol = col;
    vimMode.visual = false; // 鼠标拖拽选区会覆盖 vim visual 选区
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
      logSel.endCol = Math.max(PREFIX_W, e.x - 1);
      logSel.active = true;
      onUpdate();
      return;
    }

    // 鼠标拖出面板上方 → 向上滚动扩展选区
    if (e.y < ctx.y && ctx.scrollState.maxIndex > 0) {
      ctx.scrollState.maxIndex--;
      logSel.endLine = minIdx - 1;
      logSel.endCol = PREFIX_W;
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
