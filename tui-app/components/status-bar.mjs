// StatusBar 组件

import { tick } from '../utils/tick.mjs';
import { fmtTime } from './task-node.mjs';
import { theme } from '../utils/theme.mjs';

/** @param {{ minIndex: number, maxIndex: number, total: number, cursorLine?: number, cursorCol?: number }} */
export function statusBar({ minIndex, maxIndex, total, cursorLine, cursorCol }) {
  const range = `${minIndex + 1}-${maxIndex + 1} / ${total}`;
  let line = `[ ${range} ]`;
  if (cursorLine != null && cursorLine >= minIndex && cursorLine <= maxIndex) {
    const cur = cursorLine + 1;
    const col = cursorCol != null ? `:${cursorCol + 1}` : '';
    line += `  \u25B8${theme.bold}L${cur}${col}${theme.reset}${theme.dim}`;
  }
  return theme.dim + line + theme.reset;
}

/**
 * 构建状态横幅 → hLayout items
 * @param {{ finished: boolean, ok?: boolean, finalElapsed?: number, pending: number, running: number, done: number, failed: number, skipped: number }} stats
 * @param {number} [totalElapsed] 总耗时 ms
 * @returns {Array<{ text: string, width: number }>}
 */
export function buildStatusBar(stats, totalElapsed) {
  let label;
  if (stats.finished) {
    const tag = stats.ok === false ? 'Failed' : 'Finished';
    label = `[${tag} ${fmtTime(stats.finalElapsed || 0)}]`;
  } else if (totalElapsed > 0) {
    label = `[Building ${fmtTime(totalElapsed)}]`;
  } else {
    label = '[Building]';
  }
  const RESET = '\x1b[37;22m';  // 白色前景，复位粗细，保留背景

  function item(icon, color, count) {
    return `${color}${icon}${RESET} ${count}`;
  }

  const runningText = `${theme.PULSE[tick % 10]}\u25CF${RESET} ${stats.running}`;

  const items = [
    { text: theme.bold + label + RESET, width: label.length + 1 },
    { text: runningText,                  width: 3 + String(stats.running).length },
    { text: item('\u25CB', '\x1b[90m', stats.pending),  width: 3 + String(stats.pending).length },
    { text: item('\u2713', '\x1b[32m', stats.done),     width: 3 + String(stats.done).length },
    { text: item('\u2717', '\x1b[31m', stats.failed),   width: 3 + String(stats.failed).length },
    { text: item('\u25CC', '\x1b[90m', stats.skipped),   width: 3 + String(stats.skipped).length },
  ];

  return items;
}
