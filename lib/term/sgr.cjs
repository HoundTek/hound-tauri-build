/**
 * @file SGR 样式状态机：解析与序列化
 * @description parseSgr 把 SGR 序列作用到结构化 StyleState（覆盖 16/256/真彩、
 *   属性位、4:x 下划线样式、58/59 下划线颜色）；styleToAnsi 把 StyleState
 *   序列化为最小 SGR 串（可按能力降级）。OSC 8 链接序列的打开/关闭也在此定义。
 * @module lib/term/sgr
 * @see docs/tui-cell-refactor.md §2.2
 */

const {
  A, U, defaultStyle, degradeStyle,
} = require('./cell.cjs');

// ── 解析 ──────────────────────────────────────────────

const clamp255 = (v) => Math.max(0, Math.min(255, v));

/**
 * 读取扩展颜色参数（38/48/58 之后）：5;n → idx，2;r;g;b → rgb。
 * @param {string[]} params - SGR 参数数组（按 ';' 切分）
 * @param {number} i - 38/48/58 所在的下标
 * @returns {{ color: ?import('./cell.cjs').Color, last: number }} last = 最后消费的参数下标
 */
function readExtColor(params, i) {
  const mode = parseInt(params[i + 1], 10);
  if (mode === 5) {
    const n = parseInt(params[i + 2], 10);
    if (Number.isFinite(n)) return { color: { mode: 'idx', n: clamp255(n) }, last: i + 2 };
    return { color: null, last: i };
  }
  if (mode === 2) {
    const r = parseInt(params[i + 2], 10);
    const g = parseInt(params[i + 3], 10);
    const b = parseInt(params[i + 4], 10);
    if ([r, g, b].every(Number.isFinite)) {
      return { color: { mode: 'rgb', r: clamp255(r), g: clamp255(g), b: clamp255(b) }, last: i + 4 };
    }
    return { color: null, last: i };
  }
  return { color: null, last: i };
}

/**
 * 把 SGR 序列作用到样式状态（原地修改并返回）。
 * 支持：0 复位；属性 1,2,3,5/6,7,8,9,53；下划线 4 / 4:0..4 / 21(双下划线)；
 * 单项复位 22..29,55；前景 30-37,38,39,90-97；背景 40-47,48,49,100-107；
 * 下划线颜色 58,59。不识别冒号形式的扩展颜色（罕见，静默忽略）。
 * @param {string} seq - 形如 '\x1b[...m' 的 SGR 序列
 * @param {import('./cell.cjs').StyleState} st
 * @returns {import('./cell.cjs').StyleState}
 */
function parseSgr(seq, st) {
  const m = /^\x1b\[([\d:;]*)m$/.exec(seq);
  if (!m) return st;
  const params = m[1] === '' ? ['0'] : m[1].split(';');

  for (let i = 0; i < params.length; i++) {
    const raw = params[i];
    // 冒号子参数形式（目前只消费 4:x 下划线样式）
    if (raw.includes(':')) {
      const [main, sub] = raw.split(':').map((s) => parseInt(s, 10) || 0);
      if (main === 4) {
        if (sub === 0) st.attrs &= ~A.UNDERLINE;
        // SGR 4:x 子参数 1..5（单/双/卷曲/点/虚线）→ U 枚举 0..4
        else { st.attrs |= A.UNDERLINE; st.underline = Math.min(U.DASHED, Math.max(0, sub - 1)); }
      }
      continue;
    }
    const n = parseInt(raw, 10) || 0;
    switch (n) {
      case 0: Object.assign(st, defaultStyle()); break;
      case 1: st.attrs |= A.BOLD; break;
      case 2: st.attrs |= A.DIM; break;
      case 3: st.attrs |= A.ITALIC; break;
      case 4: st.attrs |= A.UNDERLINE; st.underline = U.SINGLE; break;
      case 5: case 6: st.attrs |= A.BLINK; break;
      case 7: st.attrs |= A.INVERSE; break;
      case 8: st.attrs |= A.HIDDEN; break;
      case 9: st.attrs |= A.STRIKE; break;
      case 21: st.attrs |= A.UNDERLINE; st.underline = U.DOUBLE; break;
      case 22: st.attrs &= ~(A.BOLD | A.DIM); break;
      case 23: st.attrs &= ~A.ITALIC; break;
      case 24: st.attrs &= ~A.UNDERLINE; break;
      case 25: st.attrs &= ~A.BLINK; break;
      case 27: st.attrs &= ~A.INVERSE; break;
      case 28: st.attrs &= ~A.HIDDEN; break;
      case 29: st.attrs &= ~A.STRIKE; break;
      case 38: {
        const r = readExtColor(params, i);
        if (r.color) st.fg = r.color;
        i = r.last;
        break;
      }
      case 39: st.fg = null; break;
      case 48: {
        const r = readExtColor(params, i);
        if (r.color) st.bg = r.color;
        i = r.last;
        break;
      }
      case 49: st.bg = null; break;
      case 53: st.attrs |= A.OVERLINE; break;
      case 55: st.attrs &= ~A.OVERLINE; break;
      case 58: {
        const r = readExtColor(params, i);
        if (r.color) st.ulColor = r.color;
        i = r.last;
        break;
      }
      case 59: st.ulColor = null; break;
      default:
        if (n >= 30 && n <= 37) st.fg = { mode: 'idx', n: n - 30 };
        else if (n >= 40 && n <= 47) st.bg = { mode: 'idx', n: n - 40 };
        else if (n >= 90 && n <= 97) st.fg = { mode: 'idx', n: n - 90 + 8 };
        else if (n >= 100 && n <= 107) st.bg = { mode: 'idx', n: n - 100 + 8 };
        break; // 其他未识别参数忽略
    }
  }
  return st;
}

// ── 序列化 ────────────────────────────────────────────

/**
 * 颜色 → SGR 参数片段。
 * @param {import('./cell.cjs').Color} color
 * @param {'fg'|'bg'|'ul'} target
 * @returns {string[]} 参数数组（如 ['38','5','196'] 或 ['31']）
 */
function colorParams(color, target) {
  if (!color) return [];
  if (color.mode === 'rgb') {
    const base = target === 'fg' ? '38' : target === 'bg' ? '48' : '58';
    return [base, '2', String(color.r), String(color.g), String(color.b)];
  }
  const n = color.n;
  if (target === 'ul') return ['58', '5', String(n)];
  const isFg = target === 'fg';
  if (n < 8) return [String((isFg ? 30 : 40) + n)];
  if (n < 16) return [String((isFg ? 90 : 100) + n - 8)];
  return [isFg ? '38' : '48', '5', String(n)];
}

/** 属性位 → SGR 参数（固定顺序，保证序列化确定性） */
const ATTR_PARAMS = [
  [A.BOLD, '1'], [A.DIM, '2'], [A.ITALIC, '3'], [A.BLINK, '5'],
  [A.INVERSE, '7'], [A.HIDDEN, '8'], [A.STRIKE, '9'], [A.OVERLINE, '53'],
];

/**
 * StyleState → 最小 SGR 串。默认样式返回 ''（不输出复位，由调用方决定）。
 * @param {import('./cell.cjs').StyleState} st
 * @param {?object} [caps] - 能力（提供时先 degrade；缺省假定现代终端全特性）
 * @returns {string} 如 '\x1b[1;38;5;196m'，默认样式为 ''
 */
function styleToAnsi(st, caps) {
  const s = caps ? degradeStyle(st, caps) : st;
  const params = [];
  for (const [bit, p] of ATTR_PARAMS) {
    if (s.attrs & bit) params.push(p);
  }
  if (s.attrs & A.UNDERLINE) {
    const modern = !caps || caps.underlineStyles;
    // U 枚举 0..4 → SGR 4:x 子参数 1..5
    params.push(s.underline === U.SINGLE || !modern ? '4' : `4:${s.underline + 1}`);
  }
  params.push(...colorParams(s.fg, 'fg'));
  params.push(...colorParams(s.bg, 'bg'));
  params.push(...colorParams(s.ulColor, 'ul'));
  return params.length ? `\x1b[${params.join(';')}m` : '';
}

/**
 * 样式是否为默认样式（无属性、无颜色）。
 * @param {import('./cell.cjs').StyleState} st
 * @returns {boolean}
 */
function isDefaultStyle(st) {
  return st.attrs === 0 && !st.fg && !st.bg && !st.ulColor;
}

// ── OSC 8 超链接 ──────────────────────────────────────

/**
 * OSC 8 链接打开序列（link 为空返回 ''）。
 * @param {import('./cell.cjs').StyleState} st
 * @returns {string}
 */
function linkOpenSeq(st) {
  if (!st.link) return '';
  return `\x1b]8;${st.linkId ? `id=${st.linkId}` : ''};${st.link}\x07`;
}

/** OSC 8 链接关闭序列 */
const LINK_CLOSE = '\x1b]8;;\x07';

module.exports = {
  parseSgr,
  styleToAnsi,
  isDefaultStyle,
  linkOpenSeq,
  LINK_CLOSE,
};
