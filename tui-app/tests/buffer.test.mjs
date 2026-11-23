/**
 * @file 格子缓冲与渲染出口（lib/term/buffer.cjs + screen.cjs + caps.cjs）的单元测试
 * @description 覆盖宽字符不变量、裁剪、blit、toRawLines round-trip、diff 最小输出、能力检测。
 * @module {tests}/buffer
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bufMod from '../../lib/term/buffer.cjs';
import screenMod from '../../lib/term/screen.cjs';
import capsMod from '../../lib/term/caps.cjs';
import cellMod from '../../lib/term/cell.cjs';
import { core } from '../../lib/term/index.cjs';

const { TermBuffer } = bufMod;
const { Screen } = screenMod;
const { detectCaps } = capsMod;
const { A, BLANK, defaultStyle } = cellMod;

const FULL_CAPS = { colorLevel: 3, osc8: true, syncOutput: true, underlineStyles: true, underlineColor: true, blink: true };

/** 收集输出的假终端 */
function fakeOut(cols = 10, rows = 4) {
  return {
    columns: cols,
    rows,
    writes: [],
    write(s) { this.writes.push(s); },
    text() { return this.writes.join(''); },
  };
}

// ── TermBuffer 基础 ──────────────────────────────────

describe('TermBuffer 基础', () => {
  it('初始为空白格，越界 get 返回 BLANK', () => {
    const b = new TermBuffer(5, 3);
    assert.equal(b.get(0, 0), BLANK);
    assert.equal(b.get(-1, 0), BLANK);
    assert.equal(b.get(5, 0), BLANK);
    assert.equal(b.get(0, 3), BLANK);
  });
  it('set/get 与越界丢弃', () => {
    const b = new TermBuffer(5, 3);
    const c = { text: 'x', w: 1, ...defaultStyle() };
    b.set(2, 1, c);
    assert.equal(b.get(2, 1), c);
    b.set(9, 9, c); // 不抛错
    assert.equal(b.get(2, 1), c);
  });
  it('resize 保留左上角重叠内容', () => {
    const b = new TermBuffer(4, 2);
    b.write(0, 0, 'ab');
    b.resize(8, 4);
    assert.equal(b.get(0, 0).text, 'a');
    assert.equal(b.get(1, 0).text, 'b');
    assert.equal(b.cols, 8);
    b.resize(1, 1);
    assert.equal(b.get(0, 0).text, 'a');
  });
});

// ── 宽字符不变量 ─────────────────────────────────────

describe('宽字符规则', () => {
  it('w=2 主格自动写续格', () => {
    const b = new TermBuffer(5, 1);
    b.write(0, 0, '你');
    assert.equal(b.get(0, 0).text, '你');
    assert.equal(b.get(0, 0).w, 2);
    assert.equal(b.get(1, 0).w, 0);
    assert.equal(b.get(1, 0).text, '');
  });
  it('覆盖主格时清理续格', () => {
    const b = new TermBuffer(5, 1);
    b.write(0, 0, '你');
    b.set(0, 0, { text: 'a', w: 1, ...defaultStyle() });
    assert.equal(b.get(1, 0), BLANK);
  });
  it('覆盖续格时清理主格', () => {
    const b = new TermBuffer(5, 1);
    b.write(0, 0, '你');
    b.set(1, 0, { text: 'b', w: 1, ...defaultStyle() });
    assert.equal(b.get(0, 0), BLANK);
    assert.equal(b.get(1, 0).text, 'b');
  });
  it('行尾放不下 w=2 → 降级同样式空格', () => {
    const b = new TermBuffer(1, 1);
    b.set(0, 0, { text: '你', w: 2, ...defaultStyle() });
    assert.equal(b.get(0, 0).text, ' ');
    assert.equal(b.get(0, 0).w, 1);
  });
  it('write 在行尾裁剪宽字符（不写半个字）', () => {
    const b = new TermBuffer(3, 1);
    const end = b.write(0, 0, 'ab你');
    assert.equal(end, 2); // '你' 宽 2 放不下第 3 列
    assert.equal(b.get(2, 0), BLANK);
  });
});

// ── write / writeWrapped ─────────────────────────────

describe('write / writeWrapped', () => {
  it('基本文本与返回结束列', () => {
    const b = new TermBuffer(10, 2);
    assert.equal(b.write(2, 0, 'abc'), 5);
    assert.equal(b.get(2, 0).text, 'a');
    assert.equal(b.get(4, 0).text, 'c');
  });
  it('样式落入格子', () => {
    const b = new TermBuffer(10, 1);
    b.write(0, 0, '\x1b[1;31mAB\x1b[0mC');
    assert.ok(b.get(0, 0).attrs & A.BOLD);
    assert.deepEqual(b.get(0, 0).fg, { mode: 'idx', n: 1 });
    assert.equal(b.get(2, 0).fg, null);
    assert.equal(b.get(2, 0).attrs, 0);
  });
  it('OSC8 链接落入格子', () => {
    const b = new TermBuffer(10, 1);
    b.write(0, 0, '\x1b]8;id=p;https://x\x07L\x1b]8;;\x07');
    assert.equal(b.get(0, 0).link, 'https://x');
    assert.equal(b.get(0, 0).linkId, 'p');
  });
  it('maxW 裁剪', () => {
    const b = new TermBuffer(10, 1);
    const end = b.write(0, 0, 'abcdef', 3);
    assert.equal(end, 3);
    assert.equal(b.get(3, 0), BLANK);
  });
  it('writeWrapped 折行落格并受 h 限制', () => {
    const b = new TermBuffer(10, 3);
    const n = b.writeWrapped(0, 0, 'abcdefgh', 3, 2);
    assert.equal(n, 2);
    assert.equal(b.get(0, 0).text, 'a');
    assert.equal(b.get(0, 1).text, 'd');
    assert.equal(b.get(0, 2), BLANK);
  });
});

// ── fillRect / blit ──────────────────────────────────

describe('fillRect / blit', () => {
  it('fillRect 只改样式不动文本', () => {
    const b = new TermBuffer(5, 2);
    b.write(0, 0, 'ab');
    const bg = { mode: 'idx', n: 24 };
    b.fillRect(0, 0, 3, 1, { bg });
    assert.equal(b.get(0, 0).text, 'a');
    assert.deepEqual(b.get(0, 0).bg, bg);
    assert.deepEqual(b.get(2, 0).bg, bg);
    assert.equal(b.get(0, 1).bg, null);
  });
  it('blit 区域拷贝', () => {
    const src = new TermBuffer(10, 1);
    src.write(0, 0, '0123456789');
    const dst = new TermBuffer(4, 1);
    dst.blit(src, 3, 0, 4, 1, 0, 0);
    assert.equal(dst.get(0, 0).text, '3');
    assert.equal(dst.get(3, 0).text, '6');
  });
  it('blit 右缘切到宽字符 → 降级空格', () => {
    const src = new TermBuffer(10, 1);
    src.write(0, 0, 'ab你c');
    const dst = new TermBuffer(4, 1);
    dst.blit(src, 0, 0, 3, 1, 0, 0); // 区域含 'a','b','你'(主格在列2，续格列3被切)
    assert.equal(dst.get(2, 0).text, ' ');
    assert.equal(dst.get(2, 0).w, 1);
  });
  it('blit 左缘切入续格 → 降级空格', () => {
    const src = new TermBuffer(10, 1);
    src.write(0, 0, '你ab');
    const dst = new TermBuffer(3, 1);
    dst.blit(src, 1, 0, 3, 1, 0, 0); // 列 1 是续格
    assert.equal(dst.get(0, 0).text, ' ');
    assert.equal(dst.get(1, 0).text, 'a');
  });
});

// ── toRawLines ───────────────────────────────────────

describe('toRawLines', () => {
  it('空缓冲 → 空行', () => {
    const b = new TermBuffer(5, 2);
    assert.deepEqual(b.toRawLines(), ['', '']);
  });
  it('round-trip：plain 与宽度一致', () => {
    const raw = 'ab \x1b[1;31m你好\x1b[0m c';
    const b = new TermBuffer(20, 1);
    b.write(0, 0, raw);
    const [line] = b.toRawLines(FULL_CAPS);
    assert.equal(core.plain(line), core.plain(raw));
    assert.equal(core.width(line), core.width(raw));
  });
  it('样式 run 合并：相同样式不重复发 SGR', () => {
    const b = new TermBuffer(10, 1);
    b.write(0, 0, '\x1b[31mAB\x1b[0m');
    const [line] = b.toRawLines(FULL_CAPS);
    assert.equal((line.match(/\x1b\[31m/g) || []).length, 1);
    assert.ok(line.endsWith('\x1b[0m'));
  });
  it('行尾空白裁剪', () => {
    const b = new TermBuffer(10, 1);
    b.write(0, 0, 'ab');
    const [line] = b.toRawLines();
    assert.equal(line, 'ab');
  });
  it('链接格序列化出 OSC8 开闭', () => {
    const b = new TermBuffer(10, 1);
    b.write(0, 0, '\x1b]8;;https://x\x07L\x1b]8;;\x07');
    const [line] = b.toRawLines(FULL_CAPS);
    assert.ok(line.includes('\x1b]8;;https://x\x07'));
    assert.ok(line.includes('\x1b]8;;\x07'));
  });
  it('caps 无 osc8 时链接被剥离', () => {
    const b = new TermBuffer(10, 1);
    b.write(0, 0, '\x1b]8;;https://x\x07L\x1b]8;;\x07');
    const [line] = b.toRawLines({ ...FULL_CAPS, osc8: false });
    assert.ok(!line.includes('\x1b]8'));
    assert.equal(core.plain(line), 'L');
  });
});

// ── Screen 差量渲染 ──────────────────────────────────

describe('Screen diff', () => {
  it('首帧整帧重绘，内容齐全', () => {
    const out = fakeOut(10, 3);
    const s = new Screen(out, { caps: FULL_CAPS });
    s.enter();
    out.writes.length = 0;
    s.frame((buf) => buf.write(0, 0, 'hello'));
    const text = out.text();
    assert.ok(text.includes('hello'));
    assert.ok(text.includes('\x1b[1;1H'));
  });
  it('相同帧无输出', () => {
    const out = fakeOut(10, 3);
    const s = new Screen(out, { caps: FULL_CAPS });
    s.frame((buf) => buf.write(0, 0, 'hello'));
    out.writes.length = 0;
    s.frame((buf) => buf.write(0, 0, 'hello'));
    assert.equal(out.text(), '');
  });
  it('单格变化 → 输出最小（含定位与新字符）', () => {
    const out = fakeOut(10, 3);
    const s = new Screen(out, { caps: FULL_CAPS });
    s.frame((buf) => buf.write(0, 0, 'aaaa'));
    out.writes.length = 0;
    s.frame((buf) => { buf.write(0, 0, 'aaaa'); buf.write(2, 0, 'b'); });
    const text = out.text();
    assert.ok(text.length <= 40, `输出过大: ${text.length}B ${JSON.stringify(text)}`);
    assert.ok(text.includes('\x1b[1;3H'));
    assert.ok(text.includes('b'));
  });
  it('syncOutput 包裹 ?2026', () => {
    const out = fakeOut(10, 3);
    const s = new Screen(out, { caps: FULL_CAPS });
    s.frame((buf) => buf.write(0, 0, 'x'));
    const text = out.text();
    assert.ok(text.startsWith('\x1b[?2026h'));
    assert.ok(text.endsWith('\x1b[?2026l'));
  });
  it('无 syncOutput 能力时不包裹', () => {
    const out = fakeOut(10, 3);
    const s = new Screen(out, { caps: { ...FULL_CAPS, syncOutput: false } });
    s.frame((buf) => buf.write(0, 0, 'x'));
    assert.ok(!out.text().includes('2026'));
  });
  it('resize 后强制整帧重绘', () => {
    const out = fakeOut(10, 3);
    const s = new Screen(out, { caps: FULL_CAPS });
    s.frame((buf) => buf.write(0, 0, 'hello'));
    s.resize(12, 4);
    out.writes.length = 0;
    s.frame((buf) => buf.write(0, 0, 'hello'));
    assert.ok(out.text().includes('\x1b[1;1H'));
  });
  it('样式变化触发 SGR 输出', () => {
    const out = fakeOut(10, 3);
    const s = new Screen(out, { caps: FULL_CAPS });
    s.frame((buf) => buf.write(0, 0, '\x1b[31mab'));
    out.writes.length = 0;
    s.frame((buf) => buf.write(0, 0, '\x1b[32mab'));
    const text = out.text();
    assert.ok(text.includes('\x1b[32m'));
  });
  it('enter/exit 序列', () => {
    const out = fakeOut();
    const s = new Screen(out, { caps: FULL_CAPS });
    s.enter();
    assert.ok(out.text().includes('\x1b[?1049h'));
    assert.ok(out.text().includes('\x1b[?25l'));
    out.writes.length = 0;
    s.exit();
    assert.ok(out.text().includes('\x1b[?25h'));
    assert.ok(out.text().includes('\x1b[?1049l'));
  });
});

// ── caps 检测 ────────────────────────────────────────

describe('detectCaps', () => {
  it('非 TTY → 全关', () => {
    const caps = detectCaps({}, false);
    assert.equal(caps.colorLevel, 0);
    assert.equal(caps.osc8, false);
    assert.equal(caps.syncOutput, false);
  });
  it('iTerm → osc8/syncOutput 开', () => {
    const caps = detectCaps({ TERM_PROGRAM: 'iTerm.app', TERM: 'xterm-256color' }, true);
    assert.equal(caps.osc8, true);
    assert.equal(caps.syncOutput, true);
  });
  it('CI 环境保守关闭 osc8', () => {
    const caps = detectCaps({ TERM_PROGRAM: 'iTerm.app', CI: 'true' }, true);
    assert.equal(caps.osc8, false);
  });
  it('kitty 终端 → 扩展下划线与 kitty 键盘', () => {
    const caps = detectCaps({ TERM: 'xterm-kitty' }, true);
    assert.equal(caps.underlineStyles, true);
    assert.equal(caps.kittyKeyboard, true);
  });
  it('未知终端保守降级', () => {
    const caps = detectCaps({ TERM: 'dumb', TERM_PROGRAM: '' }, true);
    assert.equal(caps.underlineStyles, false);
    assert.equal(caps.kittyKeyboard, false);
  });
});
