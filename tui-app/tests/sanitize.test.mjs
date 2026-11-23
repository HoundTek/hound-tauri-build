/**
 * @file lib/sys/run.cjs sanitizeLogLine 单元测试
 * @description 验证子进程输出清洗：\r 进度覆盖、C0 控制字符、非 SGR/OSC8 转义序列剥除。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeLogLine } = require('../../lib/sys/run.cjs');

test('普通文本原样保留', () => {
  assert.equal(sanitizeLogLine('Compiling parallel v0.1.0'), 'Compiling parallel v0.1.0');
  assert.equal(sanitizeLogLine('中文输出 ✓'), '中文输出 ✓');
});

test('尾部 \\r 去除', () => {
  assert.equal(sanitizeLogLine('abc\r'), 'abc');
});

test('\\r 进度覆盖：保留最后一个非空段', () => {
  assert.equal(sanitizeLogLine('Downloading 10%\rDownloading 20%'), 'Downloading 20%');
  assert.equal(sanitizeLogLine('ab\rcd\r'), 'cd');
  assert.equal(sanitizeLogLine('a\rb\rc'), 'c');
});

test('C0 控制字符剥除（保留 \\x1b 与 \\x07）', () => {
  assert.equal(sanitizeLogLine('a\x00b\x08c'), 'abc');
  assert.equal(sanitizeLogLine('a\x07b'), 'a\x07b'); // 落单 BEL 仅响铃，保留以不破坏 OSC 8 终止符
  assert.equal(sanitizeLogLine('\x1b[31mred\x1b[0m'), '\x1b[31mred\x1b[0m');
});

test('SGR 序列保留', () => {
  assert.equal(sanitizeLogLine('\x1b[1;33mwarn\x1b[0m'), '\x1b[1;33mwarn\x1b[0m');
  assert.equal(sanitizeLogLine('\x1b[38;5;24mcolor\x1b[39m'), '\x1b[38;5;24mcolor\x1b[39m');
  assert.equal(sanitizeLogLine('\x1b[7mrev\x1b[27m'), '\x1b[7mrev\x1b[27m');
});

test('OSC 8 超链接保留', () => {
  const osc8 = '\x1b]8;;https://example.com\x07link\x1b]8;;\x07';
  assert.equal(sanitizeLogLine(osc8), osc8);
});

test('非 SGR 的 CSI 剥除（光标移动/清屏等）', () => {
  assert.equal(sanitizeLogLine('\x1b[1A\x1b[Kclean'), 'clean');
  assert.equal(sanitizeLogLine('\x1b[2J\x1b[Hhome'), 'home');
  assert.equal(sanitizeLogLine('\x1b[?25lhidden\x1b[?25h'), 'hidden');
});

test('非 OSC8 的 OSC 剥除（如 OSC 52 剪贴板）', () => {
  assert.equal(sanitizeLogLine('\x1b]52;c;YmNk\x07text'), 'text');
  assert.equal(sanitizeLogLine('\x1b]0;title\x07text'), 'text');
});

test('其他 ESC 序列剥除', () => {
  assert.equal(sanitizeLogLine('\x1bMtext'), 'text');
  assert.equal(sanitizeLogLine('\x1bcreset'), 'reset');
});

test('混合场景：cargo 风格输出行', () => {
  const line = '\x1b[1m\x1b[32m   Compiling\x1b[0m parallel v0.1.0\r\x1b[1m\x1b[32m    Building\x1b[0m parallel';
  assert.equal(sanitizeLogLine(line), '\x1b[1m\x1b[32m    Building\x1b[0m parallel');
});
