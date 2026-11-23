/**
 * @file 高亮渲染辅助
 * @description 提供行高亮、列范围反白、选区高亮、搜索匹配下划线等渲染函数。
 *   所有函数为纯函数，通过参数接收状态（logSel / logSearch），不依赖闭包。
 * @module {utils}/highlight
 * @author hound-builder
 */

import { core, term } from './term.mjs';

// ── ANSI 常量 ───────────────────────────────────────

const REV     = '\x1b[7m';
const REV_OFF = '\x1b[27m';

const PREFIX_W = term.PREFIX_W;

/**
 * 从 line[i] 读取一个显示单元：ANSI 序列返回 { ansi: true, len }，
 * 可见字符返回一个 grapheme cluster 的 { ansi: false, len, w }。
 * @param {string} line
 * @param {number} i
 * @returns {{ ansi: boolean, len: number, w: number }}
 */
function readUnit(line, i) {
  if (line[i] === '\x07' || line[i] === '\x1b') {
    return { ansi: true, len: core.skipAnsi(line, i) - i, w: 0 };
  }
  const g = core.graphemes(line.slice(i))[0];
  return g ? { ansi: false, len: g.text.length, w: g.w } : { ansi: false, len: 1, w: 0 };
}

// ── 行级高亮 ────────────────────────────────────────

/**
 * 行高亮：反白效果贯穿整行
 * @param {string} line
 * @returns {string}
 */
export function highlightLine(line) {
  return REV + line + REV_OFF;
}

/**
 * 对单行文本的视觉列范围 [colStart, colEnd) 叠加反白效果
 * @param {string} line
 * @param {number} colStart
 * @param {number} colEnd
 * @returns {string}
 */
export function highlightSlot(line, colStart, colEnd) {
  return highlightRange(line, colStart, colEnd);
}

/**
 * 在单行文本的视觉列范围 [colStart, colEnd) 上叠加反白效果。
 * 范围内部的 ANSI 码被剥离，确保反白效果一致。
 * 状态感知：若源文本在剥离点原本处于反白态（如选区高亮），
 * 会在追加尾部前补回 \x1b[7m，避免叠加处理破坏既有选区高亮。
 * colEnd 可传 Infinity 表示行尾。
 * @param {string} line
 * @param {number} colStart
 * @param {number} colEnd
 * @returns {string}
 */
function highlightRange(line, colStart, colEnd) {
  if (colStart >= colEnd) return line;

  let result = '';
  let visCol = 0;
  let i = 0;
  let started = false;
  let srcRev = false;

  while (i < line.length && visCol < colEnd) {
    const unit = readUnit(line, i);
    if (unit.ansi) {
      const seq = line.slice(i, i + unit.len);
      i += unit.len;
      // 跟踪源文本反白状态（SGR 序列）
      if (seq.startsWith('\x1b[') && seq.endsWith('m')) {
        const params = seq.slice(2, -1).split(';');
        if (params.includes('0') || params.includes('27')) srcRev = false;
        else if (params.includes('7')) srcRev = true;
      }
      if (!started) result += seq;
      continue;
    }

    if (!started && visCol >= colStart) {
      result += '\x1b[0m' + REV;
      started = true;
    }
    visCol += unit.w;
    result += line.slice(i, i + unit.len);
    i += unit.len;
  }

  if (started) result += REV_OFF;
  if (i < line.length) {
    if (srcRev) result += REV;
    result += line.slice(i);
  }

  return result;
}

// ── 下划线 ──────────────────────────────────────────

/**
 * 在视觉列 [colStart, colEnd) 上插入下划线开关（不剥离既有 ANSI）
 * @param {string} line
 * @param {number} colStart
 * @param {number} colEnd
 * @returns {string}
 */
function underlineRange(line, colStart, colEnd) {
  if (colStart >= colEnd) return line;
  let visCol = 0;
  let i = 0;
  let sIdx = -1;
  let eIdx = -1;
  while (i < line.length && eIdx < 0) {
    const unit = readUnit(line, i);
    if (unit.ansi) { i += unit.len; continue; }
    if (sIdx < 0 && visCol >= colStart) sIdx = i;
    visCol += unit.w;
    i += unit.len;
    if (visCol >= colEnd) { eIdx = i; break; }
  }
  if (sIdx < 0) return line;
  if (eIdx < 0) eIdx = line.length;
  return line.slice(0, sIdx) + '\x1b[4m' + line.slice(sIdx, eIdx) + '\x1b[24m' + line.slice(eIdx);
}

// ── 选区 / 搜索高亮 ────────────────────────────────

/**
 * 在给定的 lines 数组上应用 logSel 选择高亮（仅选中列范围，跳过前缀）
 * @param {string[]} lines
 * @param {{ active: boolean, startLine: number, endLine: number, startCol: number, endCol: number }} sel
 * @returns {string[]}
 */
export function applyLogSelection(lines, sel) {
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
      cs = a === sel.startLine ? sel.startCol : sel.endCol;
    } else if (i === b) {
      ce = b === sel.startLine ? sel.startCol : sel.endCol;
    }

    out[i] = highlightRange(out[i], cs, ce);
  }
  return out;
}

/**
 * 高亮所有搜索匹配（下划线）；搜索进行中时当前匹配额外反白
 * @param {string[]} lines
 * @param {{ active: boolean, query: string, lastQuery: string, matches: Array<{line: number, col: number, len: number}>, pos: number }} ls
 * @returns {string[]}
 */
export function applyLogSearch(lines, ls) {
  const hasQuery = ls.active ? !!ls.query : (!!ls.lastQuery && ls.pos >= 0);
  if (!hasQuery) return lines;
  const out = lines.slice();
  // 1. 所有匹配 → 下划线
  for (const m of ls.matches) {
    if (m.line >= 0 && m.line < out.length) {
      out[m.line] = underlineRange(out[m.line], m.col, m.col + m.len);
    }
  }
  // 2. 当前匹配 → 额外反白
  if (ls.active && ls.pos >= 0 && ls.pos < ls.matches.length) {
    const cm = ls.matches[ls.pos];
    if (cm.line >= 0 && cm.line < out.length) {
      out[cm.line] = highlightRange(out[cm.line], cm.col, cm.col + cm.len);
    }
  }
  return out;
}
