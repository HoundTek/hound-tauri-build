// 鼠标事件诊断 demo
// 用法：将 index.mjs 中 './demos/index.mjs' 改为 './demos/mouse-test.mjs'

import { getTerminalSize } from '../utils/terminal-size.mjs';
import { on, initEvents, destroyEvents, diag } from '../utils/events.mjs';

const events = [];
let rawCount = 0;

on('key', (k) => {
  rawCount++;
  events.push({ type: 'key', data: k });
});
on('click', (m) => {
  rawCount++;
  events.push({ type: 'click', data: m });
});
on('scroll', (m) => {
  rawCount++;
  events.push({ type: 'scroll', data: m });
});
on('mouse', (m) => {
  rawCount++;
  events.push({ type: 'mouse', data: m });
});
on('resize', (s) => {
  events.push({ type: 'resize', data: s });
});

const stdin = process.stdin;
initEvents();
process.on('exit', destroyEvents);

export function makePage() {
  const { rows, columns } = getTerminalSize();
  const lines = [];

  // 诊断头部
  lines.push(`\x1b[1mTerminal: ${columns}x${rows}  |  events: ${events.length}\x1b[0m`);
  lines.push(`setRawMode: ${typeof stdin.setRawMode}  |  isTTY: ${stdin.isTTY}  |  isRaw: ${stdin.isRaw}`);
  lines.push('─'.repeat(columns));

  const maxLines = rows - 4;
  const recent = events.slice(-maxLines);
  for (const e of recent) {
    let s = '';
    if (e.type === 'key') s = `KEY  name=${e.data.name} ctrl=${!!e.data.ctrl} seq=${JSON.stringify(e.data.sequence)}`;
    else if (e.type === 'click') s = `CLK  btn=${e.data.btn} x=${e.data.x} y=${e.data.y}`;
    else if (e.type === 'scroll') s = `SCRL dir=${e.data.dir} x=${e.data.x} y=${e.data.y}`;
    else if (e.type === 'mouse') s = `MOUS btn=${e.data.btn} x=${e.data.x} y=${e.data.y} ${e.data.type}`;
    else if (e.type === 'resize') s = `RSZ  rows=${e.data.rows} columns=${e.data.columns}`;
    else s = JSON.stringify(e);
    lines.push(s);
  }

  while (lines.length < rows - 1) lines.push('');
  lines[rows - 1] = `\x1b[90mK${diag.key} C${diag.click} M${diag.mouse} | Press Enter to exit\x1b[0m`;
  return lines;
}

// stubs for index.mjs compatibility
export const filterState = { levels: [], query: '' };
export const running = { val: false };
export const tree = { description: '', children: [] };
export function toggleLevel() {}
export function toggleFinished() {}
export function setScrollCallback() {}
