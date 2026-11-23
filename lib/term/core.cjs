/**
 * @file 终端字符串模型核心
 * @description 三种视图：raw（原始串，含 ANSI）/ plain（纯文本）/ width（显示列宽）。
 *   所有操作输入输出均为 raw，宽度按终端列计算。
 *   宽度算法委托 string-width（emoji ZWJ 序列、组合字符、全角统一正确）；
 *   可见文本按 grapheme cluster（Intl.Segmenter）迭代，绝不拆散复杂字符。
 *   ANSI tokenizer 沿用经测试的 ansi.mjs 实现，保留 OSC 8 超链接
 *   在分割/切片边界处的关闭与重开（库不具备的能力）。
 * @module lib/term/core
 */

const stringWidth = require('string-width');
const { defaultStyle } = require('./cell.cjs');
const { parseSgr } = require('./sgr.cjs');

/** grapheme 分割器（进程级单例；Node >= 16 内置） */
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

/**
 * 把可见文本分成 grapheme cluster 数组：[{ text, w }]。
 * ZWJ 序列 / 组合字符 / 国旗等不会被拆开。
 * @param {string} text - 不含 ANSI 序列的可见文本
 * @returns {Array<{ text: string, w: number }>}
 */
function graphemes(text) {
  const out = [];
  for (const { segment } of segmenter.segment(text)) {
    out.push({ text: segment, w: clusterWidth(segment) });
  }
  return out;
}

/**
 * 单个 cluster 的显示宽度：控制字符 0，其余 string-width。
 * @param {string} cluster
 * @returns {number}
 */
function clusterWidth(cluster) {
  // C0/C1 控制字符不占列（\n 不应出现在行内，防御性归零）
  let w = 0;
  for (const ch of cluster) {
    const code = ch.codePointAt(0);
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code < 0xa0)) return 0;
  }
  w = stringWidth(cluster);
  return w;
}

// ── 底层跳过 ────────────────────────────────────────

/**
 * 跳过 str[i] 开始的 ANSI 转义序列（ESC/CSI/OSC/BEL），返回序列结束后的索引。
 * 若 str[i] 不是序列起始（\x1b 或 \x07），返回 i + 1。
 * @param {string} str
 * @param {number} i - 当前索引（应指向 \x1b 或 \x07）
 * @returns {number} 序列之后的索引
 */
function skipAnsi(str, i) {
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

// ── 视图：plain / width / isAscii ───────────────────

/**
 * 去除 str 中所有 ANSI 转义序列，返回纯文本。
 * 用自家 skipAnsi 实现（而非 strip-ansi）：strip-ansi 无法识别 ST（\x1b\\）终止的
 *  OSC 序列（如 cargo/rustc 输出的 OSC 8 超链接），会把链接 URL 残留为可见宽度。
 * @param {string} str
 * @returns {string}
 */
function plain(str) {
  let out = '';
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === '\x1b' || ch === '\x07') {
      i = skipAnsi(str, i);
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * 计算文本的显示宽度（列数），ANSI 序列不占宽度。
 * @param {string} str
 * @returns {number}
 */
function width(str) {
  // string-width 内部已剥离 ANSI；控制字符不算列宽（与原 charWidth 语义一致）
  return stringWidth(plain(str).replace(/[\x00-\x1f\x7f]/g, ''));
}

/**
 * plain 是否为纯 ASCII（可打印字符与空白）。
 * 纯 ASCII 串宽度 == 字符数，调用方可据此走快路径。
 * @param {string} str
 * @returns {boolean}
 */
function isAscii(str) {
  return /^[\x20-\x7e\t]*$/.test(plain(str));
}

// ── Tokenizer ───────────────────────────────────────

/**
 * @typedef {Object} TermState
 * @property {string|null} osc8 - 当前活跃的 OSC 8 超链接 URL（null 表示不在链接内）
 * @property {string} sgr - 当前最后一个 SGR 序列（如 '\x1b[31m'），空串表示无样式
 */

/**
 * @typedef {Object} TermToken
 * @property {string} text - 原始文本片段（含 ANSI 码）
 * @property {number} w - 显示宽度
 * @property {TermState} state - 此段起始时的活跃状态（原始串形式，供 wrap/slice 注入）
 * @property {import('./cell.cjs').StyleState} style - 此段起始时的结构化样式（Cell 层消费）
 * @property {Array<{ text: string, w: number }>} [clusters] - 可见段的 grapheme 划分
 */

/**
 * 有状态遍历 ANSI 字符串，产出段列表。
 * 每个 token 同时携带原始串状态（state）与结构化样式（style），两者同步推进。
 * @param {string} str
 * @returns {TermToken[]}
 */
function tokenize(str) {
  const result = [];
  let i = 0;
  let curText = '';
  let state = { osc8: null, sgr: '' };
  let style = defaultStyle();
  let snapState = { ...state }; // 可见字符累积时的状态快照
  let snapStyle = { ...style };

  /** 用 snapState/snapStyle flush 可见字符段（确保 token 携带正确的活跃状态） */
  function flush() {
    if (curText.length > 0) {
      const clusters = graphemes(curText);
      const w = clusters.reduce((s, c) => s + c.w, 0);
      result.push({ text: curText, w, state: { ...snapState }, style: { ...snapStyle }, clusters });
      curText = '';
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
        // 解析 OSC 8 超链接：\x1b]8;[params;]url(BEL|ST)（params 可含 id=xxx）
        const m = seq.match(/^\x1b\]8;([^;\x07\x1b]*);([^\x07\x1b]*)(?:\x07|\x1b\\)$/);
        if (m) {
          const url = m[2] || null;
          state = { ...state, osc8: url };
          const idM = /(?:^|;)id=([^;]+)/.exec(m[1]);
          style = { ...style, link: url, linkId: url && idM ? idM[1] : null };
        }
        flush();
        result.push({ text: seq, w: 0, state: { ...state }, style: { ...style } });
        continue;
      }
      // CSI / DCS / PM / APC
      if ('[P_^'.includes(str[i])) i++;
      while (i < str.length && (str[i] < '\x40' || str[i] > '\x7e')) i++;
      if (i < str.length) i++;
      const seq = str.slice(start, i);
      // SGR 序列追踪（原始串：保持最后一个 SGR 原文；结构化：parseSgr 全量状态）
      if (/^\x1b\[\d*(;\d+)*m$/.test(seq)) {
        state = { ...state, sgr: (seq === '\x1b[0m' || seq === '\x1b[m') ? '' : seq };
      }
      parseSgr(seq, style);
      flush();
      result.push({ text: seq, w: 0, state: { ...state }, style: { ...style } });
      continue;
    }

    // 可见字符：按 code unit 累积，flush 时统一做 grapheme 划分与宽度计算
    curText += str[i];
    i++;
    snapState = { ...state };
    snapStyle = { ...style };
  }

  flush();
  return result;
}

// ── 操作：wrap / slice / truncate / pad ─────────────

/**
 * 按显示宽度折行，每段不超过 maxWidth。
 * OSC 8 超链接作为原子单元：整个链接（显示文本）放不进当前行剩余宽度时整体移到下一行，
 * 避免链接对象被切成两半；仅当链接自身比整行还宽时才按字符切断（边界处关闭/重开链接与 SGR）。
 * 不补空格（需要整宽背景时自行 term.pad）。
 * @param {string} str - 原始串（含 ANSI）
 * @param {number} maxWidth - 每段最大显示宽度
 * @returns {string[]}
 */
function wrap(str, maxWidth) {
  if (maxWidth <= 0) return [str];
  const tokens = tokenize(str);
  if (tokens.length === 0) return [''];

  // 展平为条目流：seq = 零宽序列，vis = 单个 grapheme cluster
  const items = [];
  for (const token of tokens) {
    if (token.w === 0) {
      items.push({ seq: true, text: token.text, state: token.state });
    } else {
      for (const c of token.clusters) {
        items.push({ seq: false, text: c.text, w: c.w, state: token.state });
      }
    }
  }

  const closeSeq = (s) => (s.osc8 ? '\x1b]8;;\x07' : '') + (s.sgr ? '\x1b[0m' : '');
  const openSeq = (s) => (s.osc8 ? '\x1b]8;;' + s.osc8 + '\x07' : '') + (s.sgr || '');

  const segments = [];
  let cur = '';
  let curW = 0;
  let curState = { osc8: null, sgr: '' }; // 当前行内容末尾的活跃状态（含零宽序列的影响）
  let prevVisLink = null;                 // 当前行最后一个可见 cluster 的链接 ID（run 起点检测用）

  function endLine() {
    cur += closeSeq(curState);
    segments.push(cur);
    cur = '';
    curW = 0;
    curState = { osc8: null, sgr: '' };
    prevVisLink = null;
  }

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    if (it.seq) {
      cur += it.text;
      curState = { ...it.state };
      continue;
    }

    const linkId = it.state.osc8 || null;

    // 新链接 run 起点：整段放不进当前行则先换行（链接原子化）
    if (linkId && linkId !== prevVisLink) {
      let runW = 0;
      for (let j = idx; j < items.length; j++) {
        const r = items[j];
        if (r.seq) continue;
        if ((r.state.osc8 || null) !== linkId) break;
        runW += r.w;
      }
      if (runW <= maxWidth && curW > 0 && curW + runW > maxWidth) {
        endLine();
        cur += openSeq(it.state);
      }
    }

    if (curW + it.w > maxWidth && curW > 0) {
      endLine();
      cur += openSeq(it.state);
    }

    cur += it.text;
    curW += it.w;
    curState = { ...it.state };
    prevVisLink = linkId;
  }

  if (cur.length > 0 || segments.length === 0) {
    if (curState.osc8) cur += '\x1b]8;;\x07';
    segments.push(cur);
  }

  return segments;
}

/**
 * 按显示列切片：从 startCol（含）到 endCol（不含），保留 ANSI 序列。
 * 范围起始处若有活跃 OSC 8 / SGR 状态，自动注入打开序列；结束处注入关闭序列。
 * @param {string} str
 * @param {number} startCol
 * @param {number} endCol
 * @returns {string}
 */
function slice(str, startCol, endCol) {
  if (startCol >= endCol) return '';
  const tokens = tokenize(str);
  let result = '';
  let visCol = 0;
  let started = false;
  let lastVisibleState = null;
  let includedChars = false;

  for (const token of tokens) {
    if (token.w === 0) {
      if (started && visCol < endCol) result += token.text;
      continue;
    }

    for (const cluster of token.clusters) {
      if (!started && visCol >= startCol) {
        const s = token.state;
        if (s.osc8) result += '\x1b]8;;' + s.osc8 + '\x07';
        if (s.sgr) result += s.sgr;
        started = true;
      }

      if (visCol >= endCol) break;
      visCol += cluster.w;
      if (started) {
        result += cluster.text;
        lastVisibleState = token.state;
        includedChars = true;
      }
    }

    if (visCol >= endCol) break;
  }

  if (includedChars && lastVisibleState) {
    if (lastVisibleState.osc8) result += '\x1b]8;;\x07';
    if (lastVisibleState.sgr) result += '\x1b[0m';
  }

  return result;
}

/**
 * 按显示宽度截断（ANSI 感知）。
 * 截断点若处于 OSC 8 链接内，先关闭链接再重置 SGR。
 * @param {string} str
 * @param {number} maxWidth
 * @returns {string}
 */
function truncate(str, maxWidth) {
  const tokens = tokenize(str);
  let result = '';
  let w = 0;
  let lastVisibleState = { osc8: null, sgr: '' };
  let brokeInToken = false;

  for (const token of tokens) {
    if (token.w === 0) {
      result += token.text;
      continue;
    }

    for (const cluster of token.clusters) {
      if (w + cluster.w > maxWidth) { brokeInToken = true; break; }
      lastVisibleState = { ...token.state };
      w += cluster.w;
      result += cluster.text;
    }

    if (w >= maxWidth) break;
  }

  if (brokeInToken) {
    if (lastVisibleState.osc8) result += '\x1b]8;;\x07';
    if (lastVisibleState.sgr) result += '\x1b[0m';
  }

  return result;
}

/**
 * 补齐/截断到指定显示宽度。
 * @param {string} str
 * @param {number} targetWidth
 * @param {{ align?: 'left'|'right'|'center', fill?: string }} [opts] - fill 限单列宽字符
 * @returns {string}
 */
function pad(str, targetWidth, opts) {
  const align = (opts && opts.align) || 'left';
  const fill = (opts && opts.fill) || ' ';
  const need = targetWidth - width(str);
  if (need <= 0) return truncate(str, targetWidth);

  const left = align === 'right' ? need : align === 'center' ? Math.floor(need / 2) : 0;
  const right = need - left;
  return fill.repeat(left) + str + fill.repeat(right);
}

// ── 操作：拼接 ──────────────────────────────────────

/**
 * 顺序拼接（语义占位：让「终端字符串拼接」在代码中显式可见）。
 * @param {...string} parts
 * @returns {string}
 */
function concat(...parts) {
  return parts.join('');
}

/**
 * 以分隔符拼接数组。
 * @param {string[]} parts
 * @param {string} [sep]
 * @returns {string}
 */
function join(parts, sep) {
  return parts.join(sep == null ? '' : sep);
}

/** 日志行前缀宽度（▶ + 空格，不可选中区域）——由 TUI 布局约定 */
const PREFIX_W = 2;

module.exports = {
  // 视图
  plain,
  width,
  isAscii,
  // 操作
  slice,
  truncate,
  wrap,
  pad,
  concat,
  join,
  // 底层（测试与高亮等高级消费者）
  skipAnsi,
  tokenize,
  graphemes,
  PREFIX_W,
};
