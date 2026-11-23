/**
 * @file 终端格子（Cell）模型
 * @description 把终端画面抽象为 rows × cols 的 Cell 网格：每个格子是一个
 *   grapheme cluster + 结构化样式（颜色/属性/下划线/超链接）。
 *   样式与文本分离、颜色结构化（不存 ANSI 串），从而支持相等比较与能力降级。
 *   本模块只定义数据结构与纯函数；网格操作见 buffer.cjs，序列化见 sgr.cjs。
 * @module lib/term/cell
 * @see docs/tui-cell-refactor.md §2
 */

// ── 样式属性位标志 ────────────────────────────────────

/** Cell.attrs 位标志 */
const A = {
  BOLD: 1,
  DIM: 2,
  ITALIC: 4,
  UNDERLINE: 8,
  BLINK: 16,
  INVERSE: 32,
  HIDDEN: 64,
  STRIKE: 128,
  OVERLINE: 256,
};

/** 下划线样式（attrs 含 UNDERLINE 时有效） */
const U = {
  SINGLE: 0,
  DOUBLE: 1,
  CURLY: 2,
  DOTTED: 3,
  DASHED: 4,
};

/**
 * @typedef {null | {mode:'idx', n:number} | {mode:'rgb', r:number, g:number, b:number}} Color
 * null = 终端默认色；idx = 0-255 调色板；rgb = 24 位真彩。
 */

/**
 * @typedef {Object} StyleState
 * @property {Color} fg
 * @property {Color} bg
 * @property {number} attrs      - A.* 位或
 * @property {number} underline  - U.*
 * @property {?Color} ulColor    - 下划线颜色（SGR 58）
 * @property {?string} link      - OSC 8 URL
 * @property {?string} linkId    - OSC 8 id（同 id 的格子属于同一链接块）
 */

/**
 * @typedef {StyleState & { text: string, w: number }} Cell
 * text：grapheme cluster 原文（续格恒为 ''）；w：1|2（主格）/ 0（续格占位）。
 */

/**
 * 默认（空）样式。
 * @returns {StyleState}
 */
function defaultStyle() {
  return { fg: null, bg: null, attrs: 0, underline: U.SINGLE, ulColor: null, link: null, linkId: null };
}

/** 空白格单例（空格、默认样式）。冻结以防原地改写——Buffer 只替换引用，从不修改格子。 */
const BLANK = Object.freeze({ text: ' ', w: 1, ...defaultStyle() });

/**
 * 构造一个格子。
 * @param {string} text - grapheme cluster
 * @param {number} w - 显示宽度（1|2；续格 0）
 * @param {StyleState} [style] - 样式（缺省默认样式）
 * @returns {Cell}
 */
function cell(text, w, style) {
  return { text, w, ...(style || defaultStyle()) };
}

// ── 相等比较 ──────────────────────────────────────────

/**
 * 颜色相等。
 * @param {Color} a
 * @param {Color} b
 * @returns {boolean}
 */
function colorEq(a, b) {
  if (a === b) return true; // null/null 或同一引用
  if (!a || !b || a.mode !== b.mode) return false;
  if (a.mode === 'idx') return a.n === b.n;
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/**
 * 样式相等（差量渲染 run 合并的依据）。
 * @param {StyleState} a
 * @param {StyleState} b
 * @returns {boolean}
 */
function sameStyle(a, b) {
  return a.attrs === b.attrs
    && a.underline === b.underline
    && colorEq(a.fg, b.fg)
    && colorEq(a.bg, b.bg)
    && colorEq(a.ulColor, b.ulColor)
    && a.link === b.link
    && a.linkId === b.linkId;
}

/**
 * 格子完全相等（文本 + 宽度 + 样式）。
 * @param {Cell} a
 * @param {Cell} b
 * @returns {boolean}
 */
function sameCell(a, b) {
  return a.text === b.text && a.w === b.w && sameStyle(a, b);
}

// ── 颜色空间转换（降级用） ────────────────────────────

/** xterm 基本 16 色的 RGB 值（idx 0-15） */
const BASIC16_RGB = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0],
  [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];

/**
 * 256 调色板索引 → RGB。
 * @param {number} n - 0-255
 * @returns {[number, number, number]}
 */
function idxToRgb(n) {
  if (n < 16) return BASIC16_RGB[n];
  if (n < 232) {
    const v = n - 16;
    const lvl = (i) => (i === 0 ? 0 : i * 40 + 55);
    return [lvl(Math.floor(v / 36)), lvl(Math.floor((v % 36) / 6)), lvl(v % 6)];
  }
  const g = (n - 232) * 10 + 8;
  return [g, g, g];
}

/**
 * RGB → 最近的 256 调色板索引（立方体与灰阶分别取近，比较择优）。
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number} 16-255
 */
function rgbToIdx(r, g, b) {
  // 纯灰 → 灰阶梯
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 238) return 231;
    return 232 + Math.min(23, Math.round((r - 8) / 10));
  }
  const q = (v) => {
    if (v < 48) return 0;
    if (v < 115) return 1;
    return Math.min(5, Math.round((v - 35) / 40));
  };
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

/**
 * RGB → 最近的基本 16 色索引（平方距离）。
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number} 0-15
 */
function rgbToIdx16(r, g, b) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < 16; i++) {
    const [cr, cg, cb] = BASIC16_RGB[i];
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * 颜色按色级降级：rgb → 256 → 16 → null（无色）。
 * @param {Color} color
 * @param {number} colorLevel - 0|1(16)|2(256)|3(truecolor)
 * @returns {Color}
 */
function degradeColor(color, colorLevel) {
  if (!color) return null;
  if (colorLevel <= 0) return null;
  if (colorLevel >= 3) return color; // 真彩终端原样输出
  const rgb = color.mode === 'rgb' ? [color.r, color.g, color.b] : idxToRgb(color.n);
  if (colorLevel === 1) return { mode: 'idx', n: rgbToIdx16(rgb[0], rgb[1], rgb[2]) };
  if (color.mode === 'rgb') return { mode: 'idx', n: rgbToIdx(rgb[0], rgb[1], rgb[2]) };
  return color; // level 2 的 idx 原样
}

/**
 * 样式按终端能力降级（序列化边界一次性调用；Buffer 内永远存原始样式）。
 * @param {StyleState} st
 * @param {{ colorLevel: number, osc8: boolean, underlineStyles: boolean, underlineColor: boolean, blink: boolean }} caps
 * @returns {StyleState} 新对象，不改入参
 */
function degradeStyle(st, caps) {
  const out = { ...st };
  out.fg = degradeColor(st.fg, caps.colorLevel);
  out.bg = degradeColor(st.bg, caps.colorLevel);
  out.ulColor = caps.underlineColor ? degradeColor(st.ulColor, caps.colorLevel) : null;
  if (caps.colorLevel <= 0) {
    out.attrs = 0;
    out.underline = U.SINGLE;
  } else {
    if (!caps.underlineStyles && (st.attrs & A.UNDERLINE) && st.underline !== U.SINGLE) {
      out.underline = U.SINGLE;
    }
    if (!caps.blink) out.attrs &= ~A.BLINK;
  }
  if (!caps.osc8 || caps.colorLevel <= 0) {
    out.link = null;
    out.linkId = null;
  }
  return out;
}

module.exports = {
  A,
  U,
  BLANK,
  defaultStyle,
  cell,
  colorEq,
  sameStyle,
  sameCell,
  idxToRgb,
  rgbToIdx,
  rgbToIdx16,
  degradeColor,
  degradeStyle,
};
