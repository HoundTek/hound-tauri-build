/**
 * @file 终端格子模型（lib/term/cell.cjs + sgr.cjs）的单元测试
 * @description 覆盖样式比较、SGR 解析/序列化 round-trip、颜色降级矩阵。
 * @module {tests}/cell
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import cellMod from '../../lib/term/cell.cjs';
import sgrMod from '../../lib/term/sgr.cjs';

const {
  A, U, BLANK, defaultStyle, cell, colorEq, sameStyle, sameCell,
  idxToRgb, rgbToIdx, rgbToIdx16, degradeColor, degradeStyle,
} = cellMod;
const { parseSgr, styleToAnsi, isDefaultStyle, linkOpenSeq, LINK_CLOSE } = sgrMod;

/** 全特性能力（不降级） */
const FULL_CAPS = { colorLevel: 3, osc8: true, underlineStyles: true, underlineColor: true, blink: true };

/** 从序列数组解析出 StyleState */
function parse(...seqs) {
  const st = defaultStyle();
  for (const s of seqs) parseSgr(s, st);
  return st;
}

// ── 数据结构与比较 ────────────────────────────────────

describe('cell 数据结构', () => {
  it('BLANK 是默认样式的空格', () => {
    assert.equal(BLANK.text, ' ');
    assert.equal(BLANK.w, 1);
    assert.ok(isDefaultStyle(BLANK));
  });
  it('cell 工厂', () => {
    const c = cell('你', 2);
    assert.equal(c.text, '你');
    assert.equal(c.w, 2);
    assert.ok(isDefaultStyle(c));
    const styled = cell('x', 1, { ...defaultStyle(), attrs: A.BOLD });
    assert.ok(styled.attrs & A.BOLD);
  });
  it('colorEq', () => {
    assert.ok(colorEq(null, null));
    assert.ok(!colorEq(null, { mode: 'idx', n: 1 }));
    assert.ok(colorEq({ mode: 'idx', n: 5 }, { mode: 'idx', n: 5 }));
    assert.ok(!colorEq({ mode: 'idx', n: 5 }, { mode: 'idx', n: 6 }));
    assert.ok(colorEq({ mode: 'rgb', r: 1, g: 2, b: 3 }, { mode: 'rgb', r: 1, g: 2, b: 3 }));
    assert.ok(!colorEq({ mode: 'rgb', r: 1, g: 2, b: 3 }, { mode: 'idx', n: 3 }));
  });
  it('sameStyle / sameCell', () => {
    const a = parse('\x1b[1;31m');
    const b = parse('\x1b[31;1m'); // 顺序不同，语义相同
    assert.ok(sameStyle(a, b));
    const c = parse('\x1b[1;32m');
    assert.ok(!sameStyle(a, c));
    const ca = cell('x', 1, a);
    const cb = cell('x', 1, b);
    const cc = cell('y', 1, b);
    assert.ok(sameCell(ca, cb));
    assert.ok(!sameCell(ca, cc));
  });
  it('link 参与样式比较', () => {
    const a = { ...defaultStyle(), link: 'https://x' };
    const b = { ...defaultStyle(), link: 'https://y' };
    assert.ok(!sameStyle(a, b));
    assert.ok(sameStyle(a, { ...defaultStyle(), link: 'https://x' }));
  });
});

// ── parseSgr ─────────────────────────────────────────

describe('parseSgr', () => {
  it('空序列 / 0 复位', () => {
    const st = parse('\x1b[1;31m', '\x1b[m');
    assert.ok(isDefaultStyle(st));
    const st2 = parse('\x1b[1;31m', '\x1b[0m');
    assert.ok(isDefaultStyle(st2));
  });
  it('基本属性', () => {
    const st = parse('\x1b[1;2;3;5;7;8;9;53m');
    for (const bit of [A.BOLD, A.DIM, A.ITALIC, A.BLINK, A.INVERSE, A.HIDDEN, A.STRIKE, A.OVERLINE]) {
      assert.ok(st.attrs & bit, `缺少属性位 ${bit}`);
    }
  });
  it('16 色前景/背景', () => {
    const st = parse('\x1b[31;42m');
    assert.deepEqual(st.fg, { mode: 'idx', n: 1 });
    assert.deepEqual(st.bg, { mode: 'idx', n: 2 });
  });
  it('亮 16 色', () => {
    const st = parse('\x1b[91;102m');
    assert.deepEqual(st.fg, { mode: 'idx', n: 9 });
    assert.deepEqual(st.bg, { mode: 'idx', n: 10 });
  });
  it('256 色', () => {
    const st = parse('\x1b[38;5;196;48;5;24m');
    assert.deepEqual(st.fg, { mode: 'idx', n: 196 });
    assert.deepEqual(st.bg, { mode: 'idx', n: 24 });
  });
  it('真彩', () => {
    const st = parse('\x1b[38;2;255;128;0;48;2;1;2;3m');
    assert.deepEqual(st.fg, { mode: 'rgb', r: 255, g: 128, b: 0 });
    assert.deepEqual(st.bg, { mode: 'rgb', r: 1, g: 2, b: 3 });
  });
  it('下划线：4 / 21(双) / 4:3(卷曲)', () => {
    assert.equal(parse('\x1b[4m').underline, U.SINGLE);
    assert.equal(parse('\x1b[21m').underline, U.DOUBLE);
    assert.equal(parse('\x1b[4:3m').underline, U.CURLY);
    assert.ok(parse('\x1b[4:3m').attrs & A.UNDERLINE);
    // 4:0 取消下划线
    assert.ok(!(parse('\x1b[4:3m', '\x1b[4:0m').attrs & A.UNDERLINE));
  });
  it('下划线颜色 58 / 59', () => {
    const st = parse('\x1b[58;5;160m');
    assert.deepEqual(st.ulColor, { mode: 'idx', n: 160 });
    const st2 = parse('\x1b[58;2;10;20;30m');
    assert.deepEqual(st2.ulColor, { mode: 'rgb', r: 10, g: 20, b: 30 });
    assert.equal(parse('\x1b[58;5;160m', '\x1b[59m').ulColor, null);
  });
  it('单项复位 22/23/24/25/27/28/29/55', () => {
    const st = parse('\x1b[1;2;3;4;5;7;8;9;53m', '\x1b[22;23;24;25;27;28;29;55m');
    assert.equal(st.attrs, 0);
  });
  it('默认色复位 39 / 49', () => {
    const st = parse('\x1b[31;42m', '\x1b[39;49m');
    assert.equal(st.fg, null);
    assert.equal(st.bg, null);
  });
  it('复合序列顺序生效', () => {
    const st = parse('\x1b[1m', '\x1b[31m');
    assert.ok(st.attrs & A.BOLD);
    assert.deepEqual(st.fg, { mode: 'idx', n: 1 });
  });
  it('非 SGR 序列无副作用', () => {
    const st = defaultStyle();
    parseSgr('\x1b[2J', st);
    assert.ok(isDefaultStyle(st));
  });
});

// ── styleToAnsi ──────────────────────────────────────

describe('styleToAnsi', () => {
  it('默认样式 → 空串', () => {
    assert.equal(styleToAnsi(defaultStyle()), '');
  });
  it('序列化确定性（固定顺序）', () => {
    const st = parse('\x1b[48;5;24m', '\x1b[1m', '\x1b[38;2;255;0;0m');
    assert.equal(styleToAnsi(st), '\x1b[1;38;2;255;0;0;48;5;24m');
  });
  it('round-trip：parse(serialize(st)) 等价 st', () => {
    const cases = [
      parse('\x1b[1;31m'),
      parse('\x1b[3;4:3;58;5;160;38;5;196;48;2;1;2;3m'),
      parse('\x1b[21;92;103;9;53m'),
      parse('\x1b[2;7m'),
    ];
    for (const st of cases) {
      const rt = parse(styleToAnsi(st, FULL_CAPS));
      assert.ok(sameStyle(rt, st), `round-trip 不等价: ${styleToAnsi(st, FULL_CAPS)}`);
    }
  });
  it('caps 降级：curl 下划线回落单下划线', () => {
    const st = parse('\x1b[4:3m');
    const ansi = styleToAnsi(st, { ...FULL_CAPS, underlineStyles: false });
    assert.equal(ansi, '\x1b[4m');
  });
  it('caps 降级：rgb → 256', () => {
    const st = parse('\x1b[38;2;255;0;0m');
    const ansi = styleToAnsi(st, { ...FULL_CAPS, colorLevel: 2 });
    assert.equal(ansi, '\x1b[38;5;196m');
  });
  it('caps 降级：rgb → 16', () => {
    const st = parse('\x1b[38;2;255;0;0m');
    const ansi = styleToAnsi(st, { ...FULL_CAPS, colorLevel: 1 });
    assert.equal(ansi, '\x1b[91m'); // 255,0,0 → 亮红
  });
  it('caps 降级：无色级剥全部样式与链接', () => {
    const st = { ...parse('\x1b[1;31;4:3m'), link: 'https://x' };
    const out = degradeStyle(st, { ...FULL_CAPS, colorLevel: 0 });
    assert.equal(out.attrs, 0);
    assert.equal(out.fg, null);
    assert.equal(out.link, null);
    assert.equal(styleToAnsi(st, { ...FULL_CAPS, colorLevel: 0 }), '');
  });
  it('caps 降级：无 OSC8 剥链接、无 blink 剥闪烁', () => {
    const st = { ...parse('\x1b[5m'), link: 'https://x', linkId: 'a' };
    const out = degradeStyle(st, { ...FULL_CAPS, osc8: false, blink: false });
    assert.equal(out.link, null);
    assert.equal(out.linkId, null);
    assert.ok(!(out.attrs & A.BLINK));
  });
  it('下划线颜色随能力输出', () => {
    const st = parse('\x1b[4;58;5;160m');
    assert.ok(styleToAnsi(st, FULL_CAPS).includes('58;5;160'));
    assert.ok(!styleToAnsi(st, { ...FULL_CAPS, underlineColor: false }).includes('58'));
  });
});

// ── OSC 8 序列 ───────────────────────────────────────

describe('OSC 8', () => {
  it('linkOpenSeq 带 id', () => {
    const st = { ...defaultStyle(), link: 'https://x', linkId: 'p1' };
    assert.equal(linkOpenSeq(st), '\x1b]8;id=p1;https://x\x07');
  });
  it('linkOpenSeq 无链接为空串', () => {
    assert.equal(linkOpenSeq(defaultStyle()), '');
  });
  it('LINK_CLOSE 常量', () => {
    assert.equal(LINK_CLOSE, '\x1b]8;;\x07');
  });
});

// ── 颜色转换 ─────────────────────────────────────────

describe('颜色转换', () => {
  it('idxToRgb：基本色/立方体/灰阶', () => {
    assert.deepEqual(idxToRgb(0), [0, 0, 0]);
    assert.deepEqual(idxToRgb(196), [255, 0, 0]);
    assert.deepEqual(idxToRgb(21), [0, 0, 255]);
    assert.deepEqual(idxToRgb(244), [128, 128, 128]);
  });
  it('rgbToIdx：纯色命中立方体', () => {
    assert.equal(rgbToIdx(255, 0, 0), 196);
    assert.equal(rgbToIdx(0, 255, 0), 46);
    assert.equal(rgbToIdx(0, 0, 0), 16);
  });
  it('rgbToIdx：纯灰走灰阶梯', () => {
    assert.equal(rgbToIdx(128, 128, 128), 244);
    assert.equal(rgbToIdx(255, 255, 255), 231);
  });
  it('rgbToIdx16：落在 0-15 且红色系映射正确', () => {
    const n = rgbToIdx16(255, 0, 0);
    assert.ok(n >= 0 && n < 16);
    assert.ok(n === 1 || n === 9);
    assert.equal(rgbToIdx16(0, 0, 0), 0);
  });
  it('degradeColor 矩阵', () => {
    const rgb = { mode: 'rgb', r: 255, g: 0, b: 0 };
    assert.deepEqual(degradeColor(rgb, 3), rgb);
    assert.deepEqual(degradeColor(rgb, 2), { mode: 'idx', n: 196 });
    assert.equal(degradeColor(rgb, 1).mode, 'idx');
    assert.ok(degradeColor(rgb, 1).n < 16);
    assert.equal(degradeColor(rgb, 0), null);
    assert.equal(degradeColor(null, 1), null);
    // idx 在 level 2/3 原样
    assert.deepEqual(degradeColor({ mode: 'idx', n: 200 }, 2), { mode: 'idx', n: 200 });
  });
});

// ── core.tokenize 的结构化样式追踪 ──────────────────────

describe('tokenize 结构化样式', () => {
  it('可见段携带同步的 style 快照', async () => {
    const { core } = await import('../../lib/term/index.cjs');
    const tokens = core.tokenize('\x1b[1;31mAB\x1b[0mC');
    const vis = tokens.filter((t) => t.w > 0);
    assert.equal(vis.length, 2);
    assert.ok(vis[0].style.attrs & A.BOLD);
    assert.deepEqual(vis[0].style.fg, { mode: 'idx', n: 1 });
    assert.equal(vis[1].style.attrs, 0);
    assert.equal(vis[1].style.fg, null);
    // 原始串 state 仍然保留（行为兼容）
    assert.equal(vis[0].state.sgr, '\x1b[1;31m');
    assert.equal(vis[1].state.sgr, '');
  });
  it('OSC 8 链接同步到 style.link/linkId', async () => {
    const { core } = await import('../../lib/term/index.cjs');
    const tokens = core.tokenize('\x1b]8;id=p1;https://x\x07L\x1b]8;;\x07');
    const vis = tokens.filter((t) => t.w > 0);
    assert.equal(vis[0].style.link, 'https://x');
    assert.equal(vis[0].style.linkId, 'p1');
    assert.equal(vis[0].state.osc8, 'https://x');
  });
  it('真彩与 4:x 下划线被结构化解析', async () => {
    const { core } = await import('../../lib/term/index.cjs');
    const tokens = core.tokenize('\x1b[38;2;1;2;3;4:3mX');
    const vis = tokens.filter((t) => t.w > 0);
    assert.deepEqual(vis[0].style.fg, { mode: 'rgb', r: 1, g: 2, b: 3 });
    assert.equal(vis[0].style.underline, U.CURLY);
  });
});
