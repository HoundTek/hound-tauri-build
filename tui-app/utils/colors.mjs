/**
 * @file 颜色系统
 * @description 任务 ID 到 ANSI 颜色的映射，供树节点和日志圆点共用.
 * @module colors
 * @author hound-builder
 */

const COLORS = [
  '\x1b[36m', // cyan
  '\x1b[33m', // yellow
  '\x1b[35m', // magenta
  '\x1b[32m', // green
  '\x1b[34m', // blue
  '\x1b[91m', // bright red
  '\x1b[96m', // bright cyan
  '\x1b[93m', // bright yellow
  '\x1b[95m', // bright magenta
  '\x1b[92m', // bright green
  '\x1b[94m', // bright blue
  '\x1b[37m', // white
];
const RESET = '\x1b[0m';

function hashId(id) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 返回任务对应的 ANSI 颜色码 */
export function taskColor(id) {
  return COLORS[hashId(id) % COLORS.length];
}

/** 返回带颜色的文本 */
export function colorText(id, text) {
  return taskColor(id) + text + RESET;
}

/**
 * 返回带颜色的归属标记 ►，用于区分日志来源
 * @param {string|number} id - 任务 ID
 * @returns {string} 带 ANSI 颜色的箭头符号
 */
export function taskDot(id) {
  return taskColor(id) + '\u25BA' + RESET;
}

const STATUS_ICONS = {
  pending: '\u25CB',
  running: '\u25CF',
  done:    '\u2713',
  failed:  '\u2717',
  skipped: '\u25CC',
};
const STATUS_COLORS = {
  pending: '\x1b[90m',
  running: '\x1b[33m',
  done:    '\x1b[32m',
  failed:  '\x1b[31m',
  skipped: '\x1b[2m',
};

/** 返回按任务状态着色的状态图标 */
export function statusDot(status) {
  const s = status || 'pending';
  return (STATUS_COLORS[s] || STATUS_COLORS.pending) + (STATUS_ICONS[s] || STATUS_ICONS.pending) + RESET;
}
