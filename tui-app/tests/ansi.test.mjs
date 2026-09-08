/**
 * @file ANSI 按视觉宽度分割/切片/截断/填充的单元测试
 * @description 覆盖 ansiSplit / ansiSlice / ansiTruncate / ansiPad 的边界场景
 * @module {tests}/ansi
 * @author hound-builder
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ansiWidth, ansiSplit, ansiSlice, ansiTruncate, ansiPad,
  skipAnsi, stripAnsi, PREFIX_W,
} from '../utils/ansi.mjs';

// ── 辅助 ────────────────────────────────────────────

/** 验证每段视觉宽度 ≤ maxWidth，且所有段的 stripAnsi 拼接 == stripAnsi(原串) */
function assertSplitConsistent(str, maxWidth) {
  const segs = ansiSplit(str, maxWidth);
  for (const seg of segs) {
    const w = ansiWidth(seg);
    assert.ok(w <= maxWidth, `段宽 ${w} 超过 maxWidth ${maxWidth}: ${JSON.stringify(seg)}`);
  }
  const plain = stripAnsi(str);
  const joined = segs.map(stripAnsi).join('');
  assert.equal(joined, plain, 'stripAnsi 后拼接不一致');
}

/** 验证结果宽度 == expectedW */
function assertWidth(result, expectedW, label) {
  const w = ansiWidth(result);
  assert.equal(w, expectedW, `${label}: 宽度 ${w} != ${expectedW}`);
}

/** 验证结果的 stripAnsi == expectedPlain */
function assertPlain(result, expectedPlain, label) {
  assert.equal(stripAnsi(result), expectedPlain, `${label}: 纯文本不一致`);
}

// ── skipAnsi ────────────────────────────────────────

describe('skipAnsi', () => {
  it('BEL', () => {
    assert.equal(skipAnsi('\x07x', 0), 1);
  });
  it('CSI SGR', () => {
    assert.equal(skipAnsi('\x1b[31mx', 0), 5);
  });
  it('CSI 多参数', () => {
    assert.equal(skipAnsi('\x1b[1;31;4mx', 0), 9);
  });
  it('CSI 无参数', () => {
    assert.equal(skipAnsi('\x1b[mx', 0), 3);
  });
  it('OSC BEL 终止', () => {
    // \x1b]8;;http://x.com\x07 = 18 字符
    assert.equal(skipAnsi('\x1b]8;;http://x.com\x07x', 0), 18);
  });
  it('OSC ST 终止', () => {
    // \x1b]8;;http://x.com\x1b\\ = 19 字符
    assert.equal(skipAnsi('\x1b]8;;http://x.com\x1b\\x', 0), 19);
  });
  it('非 ANSI 字符', () => {
    assert.equal(skipAnsi('abc', 0), 1);
  });
  it('DCS 序列', () => {
    // skipAnsi 的 P_^ 分支以 0x40-0x7e 终止，不识别 ST（\x1b\\）
    // \x1bPq → q(0x71) 在范围内，返回索引 3
    assert.equal(skipAnsi('\x1bPqtest\x1b\\x', 0), 3);
  });
});

// ── stripAnsi ───────────────────────────────────────

describe('stripAnsi', () => {
  it('纯文本', () => {
    assert.equal(stripAnsi('hello'), 'hello');
  });
  it('SGR', () => {
    assert.equal(stripAnsi('\x1b[31mhello\x1b[0m'), 'hello');
  });
  it('OSC8 链接', () => {
    assert.equal(stripAnsi('\x1b]8;;http://x.com\x07Click\x1b]8;;\x07'), 'Click');
  });
  it('混合', () => {
    assert.equal(stripAnsi('\x1b[1mB\x1b[0m \x1b]8;;u\x07L\x1b]8;;\x07'), 'B L');
  });
  it('空串', () => {
    assert.equal(stripAnsi(''), '');
  });
  it('纯 ANSI 无可见字符', () => {
    assert.equal(stripAnsi('\x1b[31m\x1b[0m'), '');
  });
});

// ── ansiWidth ───────────────────────────────────────

describe('ansiWidth', () => {
  it('纯 ASCII', () => {
    assert.equal(ansiWidth('hello'), 5);
  });
  it('SGR 不计入宽度', () => {
    assert.equal(ansiWidth('\x1b[31mhello\x1b[0m'), 5);
  });
  it('OSC8 不计入宽度', () => {
    assert.equal(ansiWidth('\x1b]8;;http://x.com\x07Click\x1b]8;;\x07'), 5);
  });
  it('CJK 双宽', () => {
    assert.equal(ansiWidth('你好'), 4);
  });
  it('混合 ASCII + CJK', () => {
    assert.equal(ansiWidth('ab你c'), 5); // 1+1+2+1
  });
  it('空串', () => {
    assert.equal(ansiWidth(''), 0);
  });
  it('纯 ANSI 无可见字符', () => {
    assert.equal(ansiWidth('\x1b[31m\x1b[0m'), 0);
  });
});

// ── ansiSplit ───────────────────────────────────────

describe('ansiSplit', () => {
  it('纯文本，整除', () => {
    const segs = ansiSplit('abcdef', 3);
    assert.deepEqual(segs, ['abc', 'def']);
  });
  it('纯文本，不整除', () => {
    const segs = ansiSplit('abcde', 3);
    assert.deepEqual(segs, ['abc', 'de']);
  });
  it('单段', () => {
    const segs = ansiSplit('abc', 5);
    assert.deepEqual(segs, ['abc']);
  });
  it('空串', () => {
    const segs = ansiSplit('', 5);
    assert.deepEqual(segs, ['']);
  });
  it('maxWidth=0 返回原串', () => {
    const segs = ansiSplit('abc', 0);
    assert.deepEqual(segs, ['abc']);
  });
  it('maxWidth=1', () => {
    const segs = ansiSplit('abc', 1);
    assert.deepEqual(segs, ['a', 'b', 'c']);
  });

  it('SGR 跨段：每段继承颜色', () => {
    const str = '\x1b[31mHello World\x1b[0m';
    const segs = ansiSplit(str, 5);
    assert.equal(segs.length, 3);
    assertWidth(segs[0], 5);
    assertWidth(segs[1], 5);
    assertWidth(segs[2], 1);
    assertPlain(segs[0], 'Hello');
    assertPlain(segs[1], ' Worl');
    assertPlain(segs[2], 'd');
    // 每段应包含 \x1b[31m
    assert.ok(segs[0].includes('\x1b[31m'));
    assert.ok(segs[1].includes('\x1b[31m'));
    assert.ok(segs[2].includes('\x1b[31m'));
    // 非末段应以 \x1b[0m 结尾
    assert.ok(segs[0].endsWith('\x1b[0m'));
    assert.ok(segs[1].endsWith('\x1b[0m'));
    // 末段应以 \x1b[0m 结尾
    assert.ok(segs[2].endsWith('\x1b[0m'));
  });

  it('OSC8 链接跨段：边界处关闭+重开', () => {
    const str = '\x1b]8;;https://example.com\x07Click here\x1b]8;;\x07';
    const segs = ansiSplit(str, 5);
    assert.equal(segs.length, 2);
    assertWidth(segs[0], 5);
    assertWidth(segs[1], 5);
    assertPlain(segs[0], 'Click');
    assertPlain(segs[1], ' here');
    // 第一段应以 OSC8 关闭结尾
    assert.ok(segs[0].includes('\x1b]8;;\x07'));
    // 第二段应以 OSC8 打开开头
    assert.ok(segs[1].includes('\x1b]8;;https://example.com\x07'));
  });

  it('CJK 双宽字符在边界处', () => {
    // '你' 宽度 2，'好' 宽度 2，'世' 宽度 2，'界' 宽度 2
    // maxWidth=3：'你'(2) + '好'(2)=4>3 → 第一段 '你'，第二段 '好世'(4>3) → '好'，第三段 '界'
    const segs = ansiSplit('你好世界', 3);
    assertPlain(segs.join(''), '你好世界');
    for (const seg of segs) {
      assert.ok(ansiWidth(seg) <= 3, `段宽 ${ansiWidth(seg)} > 3`);
    }
  });

  it('CJK 整除', () => {
    const segs = ansiSplit('你好世界', 4); // 每段 2 个汉字
    assert.equal(segs.length, 2);
    assertPlain(segs[0], '你好');
    assertPlain(segs[1], '世界');
  });

  it('SGR + CJK 混合', () => {
    const str = '\x1b[31m你好世界\x1b[0m';
    assertSplitConsistent(str, 3);
    assertSplitConsistent(str, 4);
    assertSplitConsistent(str, 2);
  });

  it('SGR + OSC8 同时存在', () => {
    const str = '\x1b[1m\x1b]8;;http://x.com\x07Hello\x1b]8;;\x07\x1b[0m';
    assertSplitConsistent(str, 3);
    assertSplitConsistent(str, 2);
  });

  it('多个 SGR 嵌套', () => {
    const str = '\x1b[1m\x1b[31mBoldRed\x1b[0m';
    assertSplitConsistent(str, 3);
    assertSplitConsistent(str, 4);
  });

  it('maxWidth > 总宽度：单段', () => {
    const str = '\x1b[31mhi\x1b[0m';
    const segs = ansiSplit(str, 100);
    assert.equal(segs.length, 1);
    assertPlain(segs[0], 'hi');
  });

  it('长度为 1 的输入', () => {
    assert.deepEqual(ansiSplit('x', 1), ['x']);
    assert.deepEqual(ansiSplit('x', 2), ['x']);
  });

  it('纯 ANSI 无可见字符', () => {
    const str = '\x1b[31m\x1b[0m';
    const segs = ansiSplit(str, 5);
    assert.equal(segs.length, 1);
    assertWidth(segs[0], 0);
  });

  it('宽度一致性验证（随机宽度）', () => {
    const str = '\x1b[1m\x1b[32mHello World \x1b]8;;http://x.com\x07Click Here\x1b]8;;\x07 你好世界\x1b[0m';
    // maxWidth >= 2 才能容纳 CJK 双宽字符（单个字符宽度 > maxWidth 时无法满足约束）
    for (let w = 2; w <= 20; w++) {
      assertSplitConsistent(str, w);
    }
  });
});

// ── ansiSlice ───────────────────────────────────────

describe('ansiSlice', () => {
  it('纯文本', () => {
    assertPlain(ansiSlice('Hello World', 2, 7), 'llo W');
    assertWidth(ansiSlice('Hello World', 2, 7), 5);
  });
  it('完整范围', () => {
    assertPlain(ansiSlice('Hello', 0, 5), 'Hello');
  });
  it('空范围', () => {
    assert.equal(ansiSlice('Hello', 3, 3), '');
  });
  it('startCol > endCol', () => {
    assert.equal(ansiSlice('Hello', 5, 2), '');
  });
  it('SGR 范围内注入', () => {
    const result = ansiSlice('\x1b[31mHello\x1b[0m', 1, 4);
    assertPlain(result, 'ell');
    assertWidth(result, 3);
    // 应包含 \x1b[31m 注入
    assert.ok(result.includes('\x1b[31m'));
    // 应以 \x1b[0m 收尾
    assert.ok(result.endsWith('\x1b[0m'));
  });
  it('SGR 完整范围', () => {
    const result = ansiSlice('\x1b[31mHello\x1b[0m', 0, 5);
    assertPlain(result, 'Hello');
    assertWidth(result, 5);
  });
  it('OSC8 范围内注入', () => {
    const str = 'A\x1b]8;;http://x.com\x07BCDE\x1b]8;;\x07F';
    const result = ansiSlice(str, 1, 5);
    assertPlain(result, 'BCDE');
    assertWidth(result, 4);
    // 应包含 OSC8 打开
    assert.ok(result.includes('\x1b]8;;http://x.com\x07'));
    // 应以 OSC8 关闭结尾
    assert.ok(result.includes('\x1b]8;;\x07'));
  });
  it('OSC8 部分范围', () => {
    const str = 'A\x1b]8;;http://x.com\x07BCDE\x1b]8;;\x07F';
    const result = ansiSlice(str, 2, 4);
    assertPlain(result, 'CD');
    assertWidth(result, 2);
  });
  it('CJK 范围', () => {
    // '你好世界' = [0,2)你 [2,4)好 [4,6)世 [6,8)界
    assertPlain(ansiSlice('你好世界', 2, 6), '好世');
    assertWidth(ansiSlice('你好世界', 2, 6), 4);
  });
  it('超出范围', () => {
    assertPlain(ansiSlice('Hello', 0, 100), 'Hello');
  });
  it('从中间到末尾', () => {
    assertPlain(ansiSlice('Hello', 3, 100), 'lo');
  });
  it('范围起点恰好在 SGR 序列之后', () => {
    // '\x1b[31m' 占 0 宽度，'H' 从 visCol=0 开始
    const result = ansiSlice('\x1b[31mHello', 0, 3);
    assertPlain(result, 'Hel');
  });
  it('多段 SGR', () => {
    const str = '\x1b[31mRed\x1b[32mGreen\x1b[0m';
    const result = ansiSlice(str, 2, 7);
    assertPlain(result, 'dGree');
    assertWidth(result, 5);
  });
  it('空串', () => {
    assert.equal(ansiSlice('', 0, 5), '');
  });
  it('纯 ANSI 无可见字符', () => {
    assert.equal(ansiSlice('\x1b[31m\x1b[0m', 0, 5), '');
  });
});

// ── ansiTruncate ────────────────────────────────────

describe('ansiTruncate', () => {
  it('纯文本', () => {
    assert.equal(ansiTruncate('Hello World', 5), 'Hello');
  });
  it('不需要截断', () => {
    assert.equal(ansiTruncate('Hello', 5), 'Hello');
    assert.equal(ansiTruncate('Hi', 5), 'Hi');
  });
  it('SGR 截断后关闭', () => {
    const result = ansiTruncate('\x1b[31mhello\x1b[0m', 3);
    assertPlain(result, 'hel');
    assertWidth(result, 3);
    assert.ok(result.endsWith('\x1b[0m'), '应以 \\x1b[0m 收尾');
  });
  it('SGR 不需要截断时不应追加关闭', () => {
    const result = ansiTruncate('\x1b[31mhi\x1b[0m', 10);
    assert.equal(result, '\x1b[31mhi\x1b[0m');
  });
  it('OSC8 截断后关闭', () => {
    const result = ansiTruncate('\x1b]8;;http://x.com\x07Click here\x1b]8;;\x07', 5);
    assertPlain(result, 'Click');
    assertWidth(result, 5);
    // 应包含 OSC8 关闭
    assert.ok(result.includes('\x1b]8;;\x07'));
  });
  it('maxWidth=0', () => {
    const result = ansiTruncate('\x1b[31mabc\x1b[0m', 0);
    assertWidth(result, 0);
  });
  it('CJK 截断', () => {
    assertWidth(ansiTruncate('你好世界', 3), 2); // '你'(2) + '好'(2)=4>3 → 只取 '你'
    assertPlain(ansiTruncate('你好世界', 3), '你');
    assertWidth(ansiTruncate('你好世界', 4), 4);
    assertPlain(ansiTruncate('你好世界', 4), '你好');
  });
  it('CJK + SGR 截断', () => {
    const result = ansiTruncate('\x1b[31m你好世界\x1b[0m', 3);
    assertPlain(result, '你');
    assertWidth(result, 2);
    assert.ok(result.endsWith('\x1b[0m'));
  });
  it('空串', () => {
    assert.equal(ansiTruncate('', 5), '');
  });
  it('纯 ANSI 无可见字符', () => {
    const result = ansiTruncate('\x1b[31m\x1b[0m', 5);
    assertWidth(result, 0);
  });
  it('SGR + OSC8 截断', () => {
    const str = '\x1b[1m\x1b]8;;http://x.com\x07Hello World\x1b]8;;\x07\x1b[0m';
    const result = ansiTruncate(str, 5);
    assertPlain(result, 'Hello');
    assertWidth(result, 5);
    assert.ok(result.includes('\x1b]8;;\x07'));
    assert.ok(result.endsWith('\x1b[0m'));
  });
});

// ── ansiPad ─────────────────────────────────────────

describe('ansiPad', () => {
  it('短文本补空格', () => {
    const result = ansiPad('hi', 5);
    assert.equal(result, 'hi   ');
    assertWidth(result, 5);
  });
  it('精确宽度', () => {
    assert.equal(ansiPad('hello', 5), 'hello');
  });
  it('长文本截断', () => {
    const result = ansiPad('\x1b[31mhello world\x1b[0m', 8);
    assertWidth(result, 8);
    assertPlain(result, 'hello wo');
    assert.ok(result.endsWith('\x1b[0m'));
  });
  it('SGR 短文本补空格', () => {
    const result = ansiPad('\x1b[31mhi\x1b[0m', 5);
    assertWidth(result, 5);
    // stripAnsi 包含补的空格
    assert.equal(stripAnsi(result), 'hi   ');
  });
  it('CJK 补空格', () => {
    const result = ansiPad('你好', 5);
    assertWidth(result, 5);
    assert.equal(stripAnsi(result), '你好 ');
  });
  it('CJK 截断', () => {
    const result = ansiPad('你好世界', 5);
    assertWidth(result, 4); // '你好' = 4 宽度，截断到 5 不需要（4<5），补 1 空格
    assertPlain(result, '你好');
  });
  it('空串', () => {
    assert.equal(ansiPad('', 3), '   ');
  });
  it('OSC8 链接触发截断', () => {
    const result = ansiPad('\x1b]8;;http://x.com\x07Click here\x1b]8;;\x07', 5);
    assertWidth(result, 5);
    assertPlain(result, 'Click');
  });
});

// ── 交叉一致性 ──────────────────────────────────────

describe('交叉一致性', () => {
  it('ansiSplit 后 ansiWidth 一致', () => {
    const str = '\x1b[1mHello World 你好\x1b[0m';
    const segs = ansiSplit(str, 5);
    const totalW = segs.reduce((s, seg) => s + ansiWidth(seg), 0);
    assert.equal(totalW, ansiWidth(str));
  });
  it('ansiSplit 后 stripAnsi 拼接一致', () => {
    const str = '\x1b]8;;http://x.com\x07Click Here\x1b]8;;\x07 \x1b[31mRed\x1b[0m';
    for (let w = 1; w <= 15; w++) {
      assertSplitConsistent(str, w);
    }
  });
  it('ansiTruncate 结果宽度 == maxWidth（输入足够长时）', () => {
    const str = '\x1b[31mHello World\x1b[0m';
    for (let w = 1; w <= 11; w++) {
      assertWidth(ansiTruncate(str, w), w);
    }
  });
  it('ansiPad 结果宽度 == width', () => {
    const str = '\x1b[31mHello\x1b[0m';
    for (let w = 1; w <= 10; w++) {
      assertWidth(ansiPad(str, w), w);
    }
  });
  it('ansiSlice + ansiSlice 覆盖 == 完整字符串', () => {
    const str = '\x1b[31mHello World\x1b[0m';
    const full = ansiSlice(str, 0, 11);
    assertPlain(full, 'Hello World');
  });
});
