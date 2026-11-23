/**
 * @file 终端样式静态 API
 * @description 基于 chalk 的链式样式（颜色/背景/粗体/暗色/下划线/反白…全量开放），
 *   附加 htb 专用能力：OSC 8 超链接、任务 ID 稳定配色、任务状态图标。
 *   非 TTY 环境下 chalk 自动降级为无样式（输出纯文本）。
 * @module lib/term/style
 */

const chalk = require('chalk');

// ── OSC 8 超链接 ────────────────────────────────────

/**
 * 生成 OSC 8 超链接（iTerm2 / Windows Terminal / 现代终端可点击）。
 * @param {string} url
 * @param {string} text - 显示文本
 * @returns {string}
 */
function link(url, text) {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

// ── 任务 ID 稳定配色 ────────────────────────────────

/** 任务配色池（chalk 前景色名） */
const TASK_COLORS = [
  'cyan', 'yellow', 'magenta', 'green', 'blue',
  'redBright', 'cyanBright', 'yellowBright', 'magentaBright', 'greenBright',
  'blueBright', 'white',
];

/** 稳定哈希：同一任务 ID 永远同色 */
function hashId(id) {
  let h = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * 按任务 ID 稳定配色渲染文本（同一 ID 永远同色）。
 * @param {string} id - 任务 ID
 * @param {string} [text] - 要渲染的文本，缺省为 id 本身
 * @returns {string}
 */
function task(id, text) {
  const name = TASK_COLORS[hashId(id) % TASK_COLORS.length];
  return chalk[name](text == null ? String(id) : text);
}

/**
 * 带任务配色的归属标记 ►，用于区分日志来源。
 * @param {string|number} id - 任务 ID
 * @returns {string}
 */
function taskDot(id) {
  return task(id, '►');
}

// ── 任务状态图标 ────────────────────────────────────

const STATUS_ICONS = {
  pending: '○',
  running: '●',
  done: '✓',
  failed: '✗',
  skipped: '◌',
};

/**
 * 按任务状态着色的状态图标。
 * @param {'pending'|'running'|'done'|'failed'|'skipped'} status
 * @returns {string}
 */
function status(statusName) {
  const s = statusName || 'pending';
  const icon = STATUS_ICONS[s] || STATUS_ICONS.pending;
  switch (s) {
    case 'running': return chalk.yellow(icon);
    case 'done': return chalk.green(icon);
    case 'failed': return chalk.red(icon);
    case 'skipped': return chalk.dim(icon);
    default: return chalk.gray(icon);
  }
}

// ── 汇总导出 ────────────────────────────────────────

/**
 * style：chalk 全量链式样式（style.bold.cyan('x')、style.bgHex('#123').white('x')…）
 * + link / task / taskDot / status 静态方法。
 */
const style = Object.assign(chalk, { link, task, taskDot, status });

module.exports = { style, link, task, taskDot, status, STATUS_ICONS, TASK_COLORS };
