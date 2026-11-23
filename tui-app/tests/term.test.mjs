/**
 * @file 终端字符串模型（lib/term/core.cjs）的单元测试
 * @description 覆盖 core.wrap / core.slice / core.truncate / core.pad / core.width / core.plain 的边界场景
 * @module {tests}/term
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { core } from '../../lib/term/index.cjs';

// ── 辅助 ────────────────────────────────────────────

/** 验证每段视觉宽度 ≤ maxWidth，且所有段的 core.plain 拼接 == core.plain(原串) */
function assertSplitConsistent(str, maxWidth) {
  const segs = core.wrap(str, maxWidth);
  for (const seg of segs) {
    const w = core.width(seg);
    assert.ok(w <= maxWidth, `段宽 ${w} 超过 maxWidth ${maxWidth}: ${JSON.stringify(seg)}`);
  }
  const plain = core.plain(str);
  const joined = segs.map(core.plain).join('');
  assert.equal(joined, plain, 'core.plain 后拼接不一致');
}

/** 验证结果宽度 == expectedW */
function assertWidth(result, expectedW, label) {
  const w = core.width(result);
  assert.equal(w, expectedW, `${label}: 宽度 ${w} != ${expectedW}`);
}

/** 验证结果的 core.plain == expectedPlain */
function assertPlain(result, expectedPlain, label) {
  assert.equal(core.plain(result), expectedPlain, `${label}: 纯文本不一致`);
}

// ── core.skipAnsi ────────────────────────────────────────

describe('core.skipAnsi', () => {
  it('BEL', () => {
    assert.equal(core.skipAnsi('\x07x', 0), 1);
  });
  it('CSI SGR', () => {
    assert.equal(core.skipAnsi('\x1b[31mx', 0), 5);
  });
  it('CSI 多参数', () => {
    assert.equal(core.skipAnsi('\x1b[1;31;4mx', 0), 9);
  });
  it('CSI 无参数', () => {
    assert.equal(core.skipAnsi('\x1b[mx', 0), 3);
  });
  it('OSC BEL 终止', () => {
    // \x1b]8;;http://x.com\x07 = 18 字符
    assert.equal(core.skipAnsi('\x1b]8;;http://x.com\x07x', 0), 18);
  });
  it('OSC ST 终止', () => {
    // \x1b]8;;http://x.com\x1b\\ = 19 字符
    assert.equal(core.skipAnsi('\x1b]8;;http://x.com\x1b\\x', 0), 19);
  });
  it('非 ANSI 字符', () => {
    assert.equal(core.skipAnsi('abc', 0), 1);
  });
  it('DCS 序列', () => {
    // core.skipAnsi 的 P_^ 分支以 0x40-0x7e 终止，不识别 ST（\x1b\\）
    // \x1bPq → q(0x71) 在范围内，返回索引 3
    assert.equal(core.skipAnsi('\x1bPqtest\x1b\\x', 0), 3);
  });
});

// ── core.plain ───────────────────────────────────────

describe('core.plain', () => {
  it('纯文本', () => {
    assert.equal(core.plain('hello'), 'hello');
  });
  it('SGR', () => {
    assert.equal(core.plain('\x1b[31mhello\x1b[0m'), 'hello');
  });
  it('OSC8 链接', () => {
    assert.equal(core.plain('\x1b]8;;http://x.com\x07Click\x1b]8;;\x07'), 'Click');
  });
  it('混合', () => {
    assert.equal(core.plain('\x1b[1mB\x1b[0m \x1b]8;;u\x07L\x1b]8;;\x07'), 'B L');
  });
  it('空串', () => {
    assert.equal(core.plain(''), '');
  });
  it('纯 ANSI 无可见字符', () => {
    assert.equal(core.plain('\x1b[31m\x1b[0m'), '');
  });
});

// ── core.width ───────────────────────────────────────

describe('core.width', () => {
  it('纯 ASCII', () => {
    assert.equal(core.width('hello'), 5);
  });
  it('SGR 不计入宽度', () => {
    assert.equal(core.width('\x1b[31mhello\x1b[0m'), 5);
  });
  it('OSC8 不计入宽度', () => {
    assert.equal(core.width('\x1b]8;;http://x.com\x07Click\x1b]8;;\x07'), 5);
  });
  it('CJK 双宽', () => {
    assert.equal(core.width('你好'), 4);
  });
  it('混合 ASCII + CJK', () => {
    assert.equal(core.width('ab你c'), 5); // 1+1+2+1
  });
  it('空串', () => {
    assert.equal(core.width(''), 0);
  });
  it('纯 ANSI 无可见字符', () => {
    assert.equal(core.width('\x1b[31m\x1b[0m'), 0);
  });
});

// ── core.wrap ───────────────────────────────────────

describe('core.wrap', () => {
  it('纯文本，整除', () => {
    const segs = core.wrap('abcdef', 3);
    assert.deepEqual(segs, ['abc', 'def']);
  });
  it('纯文本，不整除', () => {
    const segs = core.wrap('abcde', 3);
    assert.deepEqual(segs, ['abc', 'de']);
  });
  it('单段', () => {
    const segs = core.wrap('abc', 5);
    assert.deepEqual(segs, ['abc']);
  });
  it('空串', () => {
    const segs = core.wrap('', 5);
    assert.deepEqual(segs, ['']);
  });
  it('maxWidth=0 返回原串', () => {
    const segs = core.wrap('abc', 0);
    assert.deepEqual(segs, ['abc']);
  });
  it('maxWidth=1', () => {
    const segs = core.wrap('abc', 1);
    assert.deepEqual(segs, ['a', 'b', 'c']);
  });

  it('SGR 跨段：每段继承颜色', () => {
    const str = '\x1b[31mHello World\x1b[0m';
    const segs = core.wrap(str, 5);
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
    const segs = core.wrap(str, 5);
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

  it('OSC8 链接原子化：放不进剩余宽度时整体移到下一行', () => {
    // 'AB '(3) + 链接 LINK(4) = 7 > 5 → 链接整体移到第二行，不被切成 L/INK
    const str = 'AB \x1b]8;;https://x\x07LINK\x1b]8;;\x07CD';
    const segs = core.wrap(str, 5);
    assertPlain(segs[0], 'AB ');
    assert.ok(segs[0].endsWith('\x1b]8;;\x07'), '第一行末尾的链接开启序列应被关闭（防止 pad 空格变链接）');
    assertPlain(segs[1], 'LINKC');
    assert.ok(segs[1].includes('LINK'), '链接显示文本完整位于第二段');
    assertPlain(segs[2], 'D');
    // 链接文本不得跨段
    for (const seg of segs) {
      const p = core.plain(seg);
      if (p.includes('L') || p.includes('INK')) {
        assert.ok(p.includes('LINK'), `链接被切开: ${JSON.stringify(p)}`);
      }
    }
  });

  it('OSC8 链接比整行还宽时：允许按字符切断并正确关闭/重开', () => {
    const str = '\x1b]8;;https://example.com\x07Click here\x1b]8;;\x07';
    const segs = core.wrap(str, 5);
    assertSplitConsistent(str, 5);
    assert.equal(segs.length, 2);
    // 段界处：前段关闭、后段重开
    assert.ok(segs[0].endsWith('\x1b]8;;\x07'));
    assert.ok(segs[1].startsWith('\x1b]8;;https://example.com\x07'));
  });

  it('OSC8 链接恰好放下时不换行', () => {
    const str = 'AB \x1b]8;;https://x\x07LI\x1b]8;;\x07';
    const segs = core.wrap(str, 5);
    assert.equal(segs.length, 1);
    assertPlain(segs[0], 'AB LI');
  });

  it('链接开启序列在行尾时不留下未关闭的链接（pad 空格不变成链接）', () => {
    // 触发原子化换行后，第一行只含开启序列：必须以关闭序列收尾
    const str = 'AB \x1b]8;;https://x\x07LINK\x1b]8;;\x07';
    const segs = core.wrap(str, 5);
    assert.ok(segs[0].endsWith('\x1b]8;;\x07'));
    assertPlain(segs[1], 'LINK');
  });

  it('CJK 双宽字符在边界处', () => {
    // '你' 宽度 2，'好' 宽度 2，'世' 宽度 2，'界' 宽度 2
    // maxWidth=3：'你'(2) + '好'(2)=4>3 → 第一段 '你'，第二段 '好世'(4>3) → '好'，第三段 '界'
    const segs = core.wrap('你好世界', 3);
    assertPlain(segs.join(''), '你好世界');
    for (const seg of segs) {
      assert.ok(core.width(seg) <= 3, `段宽 ${core.width(seg)} > 3`);
    }
  });

  it('CJK 整除', () => {
    const segs = core.wrap('你好世界', 4); // 每段 2 个汉字
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
    const segs = core.wrap(str, 100);
    assert.equal(segs.length, 1);
    assertPlain(segs[0], 'hi');
  });

  it('长度为 1 的输入', () => {
    assert.deepEqual(core.wrap('x', 1), ['x']);
    assert.deepEqual(core.wrap('x', 2), ['x']);
  });

  it('纯 ANSI 无可见字符', () => {
    const str = '\x1b[31m\x1b[0m';
    const segs = core.wrap(str, 5);
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

// ── core.slice ───────────────────────────────────────

describe('core.slice', () => {
  it('纯文本', () => {
    assertPlain(core.slice('Hello World', 2, 7), 'llo W');
    assertWidth(core.slice('Hello World', 2, 7), 5);
  });
  it('完整范围', () => {
    assertPlain(core.slice('Hello', 0, 5), 'Hello');
  });
  it('空范围', () => {
    assert.equal(core.slice('Hello', 3, 3), '');
  });
  it('startCol > endCol', () => {
    assert.equal(core.slice('Hello', 5, 2), '');
  });
  it('SGR 范围内注入', () => {
    const result = core.slice('\x1b[31mHello\x1b[0m', 1, 4);
    assertPlain(result, 'ell');
    assertWidth(result, 3);
    // 应包含 \x1b[31m 注入
    assert.ok(result.includes('\x1b[31m'));
    // 应以 \x1b[0m 收尾
    assert.ok(result.endsWith('\x1b[0m'));
  });
  it('SGR 完整范围', () => {
    const result = core.slice('\x1b[31mHello\x1b[0m', 0, 5);
    assertPlain(result, 'Hello');
    assertWidth(result, 5);
  });
  it('OSC8 范围内注入', () => {
    const str = 'A\x1b]8;;http://x.com\x07BCDE\x1b]8;;\x07F';
    const result = core.slice(str, 1, 5);
    assertPlain(result, 'BCDE');
    assertWidth(result, 4);
    // 应包含 OSC8 打开
    assert.ok(result.includes('\x1b]8;;http://x.com\x07'));
    // 应以 OSC8 关闭结尾
    assert.ok(result.includes('\x1b]8;;\x07'));
  });
  it('OSC8 部分范围', () => {
    const str = 'A\x1b]8;;http://x.com\x07BCDE\x1b]8;;\x07F';
    const result = core.slice(str, 2, 4);
    assertPlain(result, 'CD');
    assertWidth(result, 2);
  });
  it('CJK 范围', () => {
    // '你好世界' = [0,2)你 [2,4)好 [4,6)世 [6,8)界
    assertPlain(core.slice('你好世界', 2, 6), '好世');
    assertWidth(core.slice('你好世界', 2, 6), 4);
  });
  it('超出范围', () => {
    assertPlain(core.slice('Hello', 0, 100), 'Hello');
  });
  it('从中间到末尾', () => {
    assertPlain(core.slice('Hello', 3, 100), 'lo');
  });
  it('范围起点恰好在 SGR 序列之后', () => {
    // '\x1b[31m' 占 0 宽度，'H' 从 visCol=0 开始
    const result = core.slice('\x1b[31mHello', 0, 3);
    assertPlain(result, 'Hel');
  });
  it('多段 SGR', () => {
    const str = '\x1b[31mRed\x1b[32mGreen\x1b[0m';
    const result = core.slice(str, 2, 7);
    assertPlain(result, 'dGree');
    assertWidth(result, 5);
  });
  it('空串', () => {
    assert.equal(core.slice('', 0, 5), '');
  });
  it('纯 ANSI 无可见字符', () => {
    assert.equal(core.slice('\x1b[31m\x1b[0m', 0, 5), '');
  });
});

// ── core.truncate ────────────────────────────────────

describe('core.truncate', () => {
  it('纯文本', () => {
    assert.equal(core.truncate('Hello World', 5), 'Hello');
  });
  it('不需要截断', () => {
    assert.equal(core.truncate('Hello', 5), 'Hello');
    assert.equal(core.truncate('Hi', 5), 'Hi');
  });
  it('SGR 截断后关闭', () => {
    const result = core.truncate('\x1b[31mhello\x1b[0m', 3);
    assertPlain(result, 'hel');
    assertWidth(result, 3);
    assert.ok(result.endsWith('\x1b[0m'), '应以 \\x1b[0m 收尾');
  });
  it('SGR 不需要截断时不应追加关闭', () => {
    const result = core.truncate('\x1b[31mhi\x1b[0m', 10);
    assert.equal(result, '\x1b[31mhi\x1b[0m');
  });
  it('OSC8 截断后关闭', () => {
    const result = core.truncate('\x1b]8;;http://x.com\x07Click here\x1b]8;;\x07', 5);
    assertPlain(result, 'Click');
    assertWidth(result, 5);
    // 应包含 OSC8 关闭
    assert.ok(result.includes('\x1b]8;;\x07'));
  });
  it('maxWidth=0', () => {
    const result = core.truncate('\x1b[31mabc\x1b[0m', 0);
    assertWidth(result, 0);
  });
  it('CJK 截断', () => {
    assertWidth(core.truncate('你好世界', 3), 2); // '你'(2) + '好'(2)=4>3 → 只取 '你'
    assertPlain(core.truncate('你好世界', 3), '你');
    assertWidth(core.truncate('你好世界', 4), 4);
    assertPlain(core.truncate('你好世界', 4), '你好');
  });
  it('CJK + SGR 截断', () => {
    const result = core.truncate('\x1b[31m你好世界\x1b[0m', 3);
    assertPlain(result, '你');
    assertWidth(result, 2);
    assert.ok(result.endsWith('\x1b[0m'));
  });
  it('空串', () => {
    assert.equal(core.truncate('', 5), '');
  });
  it('纯 ANSI 无可见字符', () => {
    const result = core.truncate('\x1b[31m\x1b[0m', 5);
    assertWidth(result, 0);
  });
  it('SGR + OSC8 截断', () => {
    const str = '\x1b[1m\x1b]8;;http://x.com\x07Hello World\x1b]8;;\x07\x1b[0m';
    const result = core.truncate(str, 5);
    assertPlain(result, 'Hello');
    assertWidth(result, 5);
    assert.ok(result.includes('\x1b]8;;\x07'));
    assert.ok(result.endsWith('\x1b[0m'));
  });
});

// ── core.pad ─────────────────────────────────────────

describe('core.pad', () => {
  it('短文本补空格', () => {
    const result = core.pad('hi', 5);
    assert.equal(result, 'hi   ');
    assertWidth(result, 5);
  });
  it('精确宽度', () => {
    assert.equal(core.pad('hello', 5), 'hello');
  });
  it('长文本截断', () => {
    const result = core.pad('\x1b[31mhello world\x1b[0m', 8);
    assertWidth(result, 8);
    assertPlain(result, 'hello wo');
    assert.ok(result.endsWith('\x1b[0m'));
  });
  it('SGR 短文本补空格', () => {
    const result = core.pad('\x1b[31mhi\x1b[0m', 5);
    assertWidth(result, 5);
    // core.plain 包含补的空格
    assert.equal(core.plain(result), 'hi   ');
  });
  it('CJK 补空格', () => {
    const result = core.pad('你好', 5);
    assertWidth(result, 5);
    assert.equal(core.plain(result), '你好 ');
  });
  it('CJK 截断', () => {
    const result = core.pad('你好世界', 5);
    assertWidth(result, 4); // '你好' = 4 宽度，截断到 5 不需要（4<5），补 1 空格
    assertPlain(result, '你好');
  });
  it('空串', () => {
    assert.equal(core.pad('', 3), '   ');
  });
  it('OSC8 链接触发截断', () => {
    const result = core.pad('\x1b]8;;http://x.com\x07Click here\x1b]8;;\x07', 5);
    assertWidth(result, 5);
    assertPlain(result, 'Click');
  });
});

// ── 交叉一致性 ──────────────────────────────────────

describe('交叉一致性', () => {
  it('core.wrap 后 core.width 一致', () => {
    const str = '\x1b[1mHello World 你好\x1b[0m';
    const segs = core.wrap(str, 5);
    const totalW = segs.reduce((s, seg) => s + core.width(seg), 0);
    assert.equal(totalW, core.width(str));
  });
  it('core.wrap 后 core.plain 拼接一致', () => {
    const str = '\x1b]8;;http://x.com\x07Click Here\x1b]8;;\x07 \x1b[31mRed\x1b[0m';
    for (let w = 1; w <= 15; w++) {
      assertSplitConsistent(str, w);
    }
  });
  it('core.truncate 结果宽度 == maxWidth（输入足够长时）', () => {
    const str = '\x1b[31mHello World\x1b[0m';
    for (let w = 1; w <= 11; w++) {
      assertWidth(core.truncate(str, w), w);
    }
  });
  it('core.pad 结果宽度 == width', () => {
    const str = '\x1b[31mHello\x1b[0m';
    for (let w = 1; w <= 10; w++) {
      assertWidth(core.pad(str, w), w);
    }
  });
  it('core.slice + core.slice 覆盖 == 完整字符串', () => {
    const str = '\x1b[31mHello World\x1b[0m';
    const full = core.slice(str, 0, 11);
    assertPlain(full, 'Hello World');
  });
});

// ── 复杂字符串（string-width / grapheme cluster）─────

describe('复杂字符串', () => {
  it('emoji 单字符宽度 2', () => {
    assert.equal(core.width('✅'), 2);
  });
  it('ZWJ 序列整体宽度 2，不拆散', () => {
    assert.equal(core.width('👨‍👩‍👧'), 2);
    // ZWJ 序列不可被 slice 拆开
    assert.equal(core.plain(core.slice('a👨‍👩‍👧b', 1, 3)), '👨‍👩‍👧');
  });
  it('组合字符整体宽度 1', () => {
    assert.equal(core.width('é'), 1); // e + U+0301
  });
  it('国旗（区域指示符对）宽度 2', () => {
    assert.equal(core.width('🇨🇳'), 2);
  });
  it('VS16 变体选择符不增宽', () => {
    assert.equal(core.width('✔️'), 2); // ✔ + VS16
  });
  it('wrap 不拆散 ZWJ 序列', () => {
    const segs = core.wrap('a👨‍👩‍👧b', 2);
    assert.equal(segs.map(core.plain).join(''), 'a👨‍👩‍👧b');
    for (const s of segs) assert.ok(core.width(s) <= 2);
  });
  it('truncate 不拆散 ZWJ 序列', () => {
    const r = core.truncate('a👨‍👩‍👧b', 2);
    assert.equal(core.plain(r), 'a'); // 余 1 列放不下 emoji
    assert.equal(core.width(core.truncate('a👨‍👩‍👧b', 3)), 3);
  });
  it('emoji + SGR + CJK 混合宽度', () => {
    assert.equal(core.width('[31m中a✅[0m'), 5);
  });
  it('isAscii 判定', () => {
    assert.equal(core.isAscii('abc 123'), true);
    assert.equal(core.isAscii('[31mabc[0m'), true);
    assert.equal(core.isAscii('中'), false);
    assert.equal(core.isAscii('✅'), false);
  });
  it('pad 对齐', () => {
    assert.equal(core.pad('hi', 6, { align: 'right' }), '    hi');
    assert.equal(core.plain(core.pad('hi', 6, { align: 'center' })), '  hi  ');
    assert.equal(core.width(core.pad('中', 6, { align: 'right' })), 6);
  });
});

// ── ST（\x1b\\）终止的 OSC 序列（cargo/rustc 超链接格式）─────

describe('ST 终止的 OSC 8', () => {
  const st = '\x1b]8;;file:///project/src/main.rs\x1b\\main.rs\x1b]8;;\x1b\\';
  it('plain 剥离 ST 终止的 OSC 序列', () => {
    assert.equal(core.plain(st), 'main.rs');
  });
  it('width 不把链接 URL 计入宽度（防守卫误触发）', () => {
    assert.equal(core.width(st), 7);
  });
  it('wrap 行宽按真实宽度约束', () => {
    const segs = core.wrap(st, 10);
    for (const s of segs) assert.ok(core.width(s) <= 10);
    assert.equal(segs.map(core.plain).join(''), 'main.rs');
  });
  it('tokenize 识别 ST 链接状态', () => {
    const tokens = core.tokenize(st);
    const vis = tokens.filter((t) => t.w > 0);
    assert.equal(vis[0].state.osc8, 'file:///project/src/main.rs');
    assert.equal(vis[0].style.link, 'file:///project/src/main.rs');
  });
  it('BEL 与 ST 混合', () => {
    const mixed = '\x1b]8;;https://a\x07A\x1b]8;;\x07\x1b]8;;https://b\x1b\\B\x1b]8;;\x1b\\';
    assert.equal(core.plain(mixed), 'AB');
    assert.equal(core.width(mixed), 2);
  });
});
