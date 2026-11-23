import { term } from '../utils/term.mjs';

const origin = '中文字符、全角字符ＡＢＣ、'
  + 'ANSI:\x1b[31m红色\x1b[0m '
  + 'CSI:\x1b[3D '
  + 'OSC:\x1b]0;title\x07 '
  + 'BEL:\x07 '
  + 'ST:\x1b\\ '
  + 'DCS:\x1bPtest\x1b\\ '
  + 'PM:\x1b^test\x1b\\ '
  + 'APC:\x1b_test\x1b\\ '
  + 'ASCII🎉';
export function makePage() {
  // term.wrap 不补空格：demo 在行尾加 '|' 标记验证宽度边界
  const lines = term.wrap(origin, 9);
  return lines.map((l) => term.pad(l, 9) + '|');
}
