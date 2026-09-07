/**
 * @file ANSI 转义序列通用工具
 * @description 提供序列跳过、tokenizer、按宽度分割/切片/截断/填充等操作。
 *   核心设计：tokenizer 遍历原始字符串，产出 {text, w, state} 段，
 *   上层函数（ansiSplit / ansiSlice / ansiTruncate / ansiPad）基于段构建结果，
 *   正确处理 OSC 8 超链接在分割边界处的关闭与重开。
 * @module {utils}/ansi
 * @author hound-builder
 */

import { charWidth } from './char-width.mjs';

// ── 底层跳过 ────────────────────────────────────────

/**
 * 跳过 str[i] 开始的 ANSI 转义序列（ESC/CSI/OSC/BEL），返回序列结束后的索引。
 * 若 str[i] 不是序列起始（\x1b 或 \x07），返回 i + 1。
 * @param {string} str
 * @param {number} i - 当前索引（应指向 \x1b 或 \x07）
 * @returns {number} 序列之后的索引
 */
export function skipAnsi(str, i) {
  const ch = str[i];
  if (ch === '\x07') return i + 1;
  if (ch !== '\x1b') return i + 1;

  const next = str[i + 1];
  if (next === ']') {
    let j = i + 2;
    while (j < str.length && str[j] !== '\x07') {
      if (str[j] === '\x1b' && j + 1 < str.length && str[j + 1] === '\\') return j + 2;
      j++;
    }
    return j + (j < str.length ? 1 : 0);
  }
  if (next && '[P_^'.includes(next)) {
    let j = i + 2;
    while (j < str.length && (str[j] < '\x40' || str[j] > '\x7e')) j++;
    return j + (j < str.length ? 1 : 0);
  }
  return i + 2;
}

// ── 去除 ────────────────────────────────────────────

/**
 * 去除 str 中所有 ANSI 转义序列，返回纯文本。
 * @param {string} str
 * @returns {string}
 */
export function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b\].*?\x1b\\/g, '');
}

// ── 宽度计算 ────────────────────────────────────────

/**
 * 计算文本的视觉显示宽度（跳过所有 ANSI 序列）
 * @param {string} text
 * @returns {number}
 */
export function ansiWidth(text) {
  let w = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\x07' || text[i] === '\x1b') { i = skipAnsi(text, i); continue; }
    w += charWidth(text[i]);
    i++;
  }
  return w;
}

// ── Tokenizer ───────────────────────────────────────

/**
 * @typedef {Object} AnsiState
 * @property {string|null} osc8 - 当前活跃的 OSC 8 超链接 URL（null 表示不在链接内）
 * @property {string} sgr - 当前最后一个 SGR 序列（如 '\x1b[31m'），空串表示无样式
 */

/**
 * @typedef {Object} AnsiToken
 * @property {string} text - 原始文本片段（含 ANSI 码）
 * @property {number} w - 视觉宽度
 * @property {AnsiState} state - 此段起始时的活跃状态
 */

/**
 * 有状态遍历 ANSI 字符串，产出段列表。
 * 每个段记录文本、视觉宽度、以及该段起始时的活跃 ANSI 状态。
 * @param {string} str
 * @returns {AnsiToken[]}
 */
function tokenize(str) {
  const result = [];
  let i = 0;
  let w = 0;
  let curText = '';
  let curW = 0;
  let state = { osc8: null, sgr: '' };
  let snapState = { ...state }; // 可见字符累积时的状态快照

  /** 用 snapState flush 可见字符段（确保 token 携带正确的活跃状态） */
  function flush() {
    if (curText.length > 0) {
      result.push({ text: curText, w: curW, state: { ...snapState } });
      curText = '';
      curW = 0;
    }
  }

  while (i < str.length) {
    // BEL（OSC 终止符）
    if (str[i] === '\x07') {
      curText += '\x07';
      i++;
      continue;
    }

    // ESC 序列
    if (str[i] === '\x1b') {
      const start = i;
      i++;
      // OSC 序列: ESC ] ... (BEL 或 ST 终止)
      if (str[i] === ']') {
        i++;
        while (i < str.length && str[i] !== '\x07') {
          if (str[i] === '\x1b' && i + 1 < str.length && str[i + 1] === '\\') { i += 2; break; }
          i++;
        }
        if (i < str.length && str[i] === '\x07') i++;
        const seq = str.slice(start, i);
        // 解析 OSC 8 超链接：\x1b]8;[params;]url\x07
        const m = seq.match(/^\x1b\]8;[^;\x07]*;([^\x07]*)\x07$/);
        if (m) state = { ...state, osc8: m[1] || null };
        flush();
        result.push({ text: seq, w: 0, state: { ...state } });
        continue;
      }
      // CSI / DCS / PM / APC
      if ('[P_^'.includes(str[i])) i++;
      while (i < str.length && (str[i] < '\x40' || str[i] > '\x7e')) i++;
      if (i < str.length) i++;
      const seq = str.slice(start, i);
      // SGR 序列追踪
      if (/^\x1b\[\d*(;\d+)*m$/.test(seq)) {
        state = { ...state, sgr: (seq === '\x1b[0m' || seq === '\x1b[m') ? '' : seq };
      }
      flush();
      result.push({ text: seq, w: 0, state: { ...state } });
      continue;
    }

    // 可见字符
    const cw = charWidth(str[i]);
    curText += str[i];
    curW += cw;
    snapState = { ...state }; // 每次添加字符时快照当前状态
    i++;
  }

  flush();
  return result;
}

// ── 分割 ────────────────────────────────────────────

/**
 * 按视觉宽度分割字符串，每段不超过 maxWidth。
 * OSC 8 超链接在分割边界处正确关闭（行尾）并在下一段重开（行首）。
 * @param {string} str - 原始字符串（含 ANSI 序列）
 * @param {number} maxWidth - 每段最大视觉宽度
 * @returns {string[]} 分割后的字符串数组
 */
export function ansiSplit(str, maxWidth) {
  if (maxWidth <= 0) return [str];
  const tokens = tokenize(str);
  if (tokens.length === 0) return [''];

  const segments = [];
  let cur = '';
  let curW = 0;

  for (const token of tokens) {
    if (token.w === 0) {
      // ANSI 序列：直通
      cur += token.text;
      continue;
    }

    // 可见字符段
    for (let j = 0; j < token.text.length; j++) {
      const ch = token.text[j];
      const cw = charWidth(ch);

      if (curW + cw > maxWidth && curW > 0) {
        // ── 到达宽度边界，关闭当前段 ──
        const { osc8, sgr } = token.state;
        if (osc8) cur += '\x1b]8;;\x07'; // 关闭超链接
        if (sgr) cur += '\x1b[0m';       // 重置 SGR
        segments.push(cur);

        // ── 开始新段 ──
        cur = '';
        if (osc8) cur += '\x1b]8;;' + osc8 + '\x07'; // 重开超链接
        if (sgr) cur += sgr;                           // 恢复 SGR
        curW = 0;
      }

      cur += ch;
      curW += cw;
    }
  }

  if (cur.length > 0 || segments.length === 0) {
    // 收尾：关闭未闭合的 OSC 8 链接
    const lastState = tokens[tokens.length - 1].state;
    if (lastState.osc8) cur += '\x1b]8;;\x07';
    segments.push(cur);
  }

  return segments;
}

// ── 切片 ────────────────────────────────────────────

/**
 * 按视觉列切片：从 startCol（含）到 endCol（不含），保留 ANSI 序列。
 * 范围起始处若有活跃 OSC 8 / SGR 状态，会自动注入对应的打开序列。
 * 范围结束处若有活跃状态，会注入对应的关闭序列。
 * @param {string} str
 * @param {number} startCol
 * @param {number} endCol
 * @returns {string}
 */
export function ansiSlice(str, startCol, endCol) {
  if (startCol >= endCol) return '';
  const tokens = tokenize(str);
  let result = '';
  let visCol = 0;
  let started = false;
  let lastVisibleState = null; // 最后一个被包含可见字符的状态
  let includedChars = false;   // 是否包含过可见字符

  for (const token of tokens) {
    if (token.w === 0) {
      // ANSI 序列：仅在范围内时直通
      if (started && visCol < endCol) result += token.text;
      continue;
    }

    for (let j = 0; j < token.text.length; j++) {
      const cw = charWidth(token.text[j]);

      if (!started && visCol >= startCol) {
        // 注入起始点的活跃状态
        const s = token.state;
        if (s.osc8) result += '\x1b]8;;' + s.osc8 + '\x07';
        if (s.sgr) result += s.sgr;
        started = true;
      }

      if (visCol >= endCol) break;
      visCol += cw;
      if (started) {
        result += token.text[j];
        lastVisibleState = token.state;
        includedChars = true;
      }
    }

    if (visCol >= endCol) break;
  }

  // 收尾：关闭起始点引入但仍在作用的 OSC 8 / SGR
  if (includedChars && lastVisibleState) {
    if (lastVisibleState.osc8) result += '\x1b]8;;\x07';
    if (lastVisibleState.sgr) result += '\x1b[0m';
  }

  return result;
}

// ── 截断 ────────────────────────────────────────────

/**
 * 按视觉宽度截断字符串（ANSI 感知）。
 * 截断点若处于 OSC 8 超链接内，会先关闭链接再重置 SGR。
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string}
 */
export function ansiTruncate(text, maxWidth) {
  const tokens = tokenize(text);
  let result = '';
  let w = 0;
  let lastVisibleState = { osc8: null, sgr: '' }; // 最后一个被包含可见字符的状态
  let brokeInToken = false; // 是否在可见字符 token 内部截断

  for (const token of tokens) {
    if (token.w === 0) {
      result += token.text;
      continue;
    }

    for (let j = 0; j < token.text.length; j++) {
      const cw = charWidth(token.text[j]);
      if (w + cw > maxWidth) { brokeInToken = true; break; }
      lastVisibleState = { ...token.state };
      w += cw;
      result += token.text[j];
    }

    if (w >= maxWidth) break;
  }

  // 截断后收尾：仅在 token 内部截断时需要关闭仍在作用的 OSC 8 / SGR
  if (brokeInToken) {
    if (lastVisibleState.osc8) result += '\x1b]8;;\x07';
    if (lastVisibleState.sgr) result += '\x1b[0m';
  }

  return result;
}

// ── 填充 / 截断到指定宽度 ───────────────────────────

/**
 * 填充/截断文本到指定视觉宽度（ANSI 感知）。
 * 短于 width 时右侧补空格；长于 width 时截断并正确关闭 OSC 8 / SGR。
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
export function ansiPad(text, width) {
  const need = width - ansiWidth(text);
  if (need >= 0) return text + ' '.repeat(need);
  return ansiTruncate(text, width);
}

/**
 * 常量：日志行前缀宽度（▶ + 空格，不可选中区域）
 */
export const PREFIX_W = 2;

// ── 向后兼容导出 ────────────────────────────────────

/** @deprecated 使用 ansiPad */
export const padLine = ansiPad;

/** @deprecated 使用 ansiSlice */
export const visSlice = ansiSlice;

/** @deprecated 使用 ansiWidth */
export const textWidth = ansiWidth;
