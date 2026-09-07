import { wrapLine } from '../utils/wrap-line.mjs';

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
  const lines = wrapLine(origin, 9);
  // 在每一行后添加'|'标记
  return lines.map((l) => l + '|');
}
