/**
 * @file Overlay 面板渲染
 * @description 退出确认弹窗和帮助页 overlay 的渲染函数。
 *   纯函数，不依赖闭包状态，通过参数接收面板状态和终端尺寸。
 * @module {demos}/panels
 * @author hound-builder
 */

import { term } from '../utils/term.mjs';
import { theme } from '../utils/theme.mjs';

/** 帮助页内容 */
const HELP = [
  'Hound TUI 键盘帮助',
  '',
  'Tab / Shift+Tab      切换焦点（树 / 日志 / 筛选）',
  'j / k / h / l、方向键  移动光标',
  '0 / ^ / $            行首 / 首个非空 / 行尾',
  'w / b / e            词首 / 词首回退 / 词尾',
  'gg / G               日志顶部 / 底部',
  'Ctrl+f/b、PgUp/PgDn  整页滚动',
  'Ctrl+d / Ctrl+u      半页滚动',
  '数字 + 移动键         重复次数（如 3j / 2w / 5G）',
  'v                    visual 选择',
  'y / yy               复制选区 / 复制当前行',
  '/ 搜索；n / N         查找 / 下一个 / 上一个',
  'c                    复制当前筛选视图全部日志',
  'ESC                  退出选区/搜索；再按 = 退出确认',
  '? 或 F1               本帮助',
];

/**
 * 在 output 数组上叠加退出确认弹窗
 * @param {string[]} output - 输出行数组（会被就地修改）
 * @param {{ visible: boolean, selected: string }} panel - 面板状态
 * @param {number} W - 终端宽度
 * @param {number} H - 终端高度
 * @returns {void}
 */
export function renderExitPanel(output, panel, W, H) {
  if (!panel.visible) return;

  const modalW = 28;
  const modalH = 4;
  const mx = Math.max(0, Math.floor((W - modalW) / 2));
  const my = Math.max(0, Math.floor((H - modalH) / 2));
  const sel = panel.selected || 'n';

  const padStr = (s, w) => s + ' '.repeat(Math.max(0, w - term.width(s)));

  const lines = [
    ' \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510 ',
    ' \u2502 Exit Hound Builder?    \u2502 ',
  ];

  const yLabel = (sel === 'y' ? theme.rev + '[Y]' + theme.revOff : '[Y]') + ' Yes';
  const nLabel = (sel === 'n' ? theme.rev + '[N]' + theme.revOff : '[N]') + ' No';
  lines.push(' \u2502 ' + padStr(yLabel, 11) + '  ' + padStr(nLabel, 9) + ' \u2502 ');
  lines.push(' \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518 ');

  for (let r = 0; r < modalH && my + r < H; r++) {
    const orig = output[my + r];
    const left = term.slice(orig, 0, mx);
    const right = term.slice(orig, mx + modalW, term.width(orig));
    output[my + r] = left + theme.bold + lines[r] + theme.reset + right;
  }
}

/**
 * 在 output 数组上叠加帮助页 overlay
 * @param {string[]} output - 输出行数组（会被就地修改）
 * @param {{ visible: boolean }} panel - 面板状态
 * @param {number} W - 终端宽度
 * @param {number} H - 终端高度
 * @returns {void}
 */
export function renderHelpPanel(output, panel, W, H) {
  if (!panel.visible) return;

  const contentW = Math.max(2, ...HELP.map((l) => term.width(l))) + 2;
  const contentH = HELP.length + 2;
  const bx = Math.max(0, Math.floor((W - contentW) / 2));
  const by = Math.max(0, Math.floor((H - contentH) / 2));

  const padStr = (s, w) => s + ' '.repeat(Math.max(0, w - term.width(s)));
  const hlines = [
    '\u250c' + '\u2500'.repeat(contentW - 2) + '\u2510',
    ...HELP.map((l) => '\u2502' + padStr(l, contentW - 2) + '\u2502'),
    '\u2514' + '\u2500'.repeat(contentW - 2) + '\u2518',
  ];

  for (let r = 0; r < contentH && by + r < H; r++) {
    const orig = output[by + r];
    const left = term.slice(orig, 0, bx);
    const right = term.slice(orig, bx + contentW, term.width(orig));
    const line = r === 1 ? theme.bold + hlines[r] : hlines[r];
    output[by + r] = left + theme.rev + line + theme.revOff + right;
  }
}
