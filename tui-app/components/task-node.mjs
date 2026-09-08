/**
 * @file 任务节点单行渲染组件
 * @description 提供图标指示器、任务名称、复选框与进度/时长的单节点渲染。
 * @module components/task-node
 * @author hound-builder
 */

import { taskColor } from '../utils/colors.mjs';
import { tick } from '../utils/tick.mjs';
import { theme } from '../utils/theme.mjs';

/** 各任务状态对应的显示图标 */
const ICONS = {
  pending: '\u25CB',
  running: '\u25CF',
  done:    '\u2713',
  failed:  '\u2717',
  skipped: '\u25CC',
};

const ICON_COLORS = {
  pending: theme.faint,
  running: theme.ok,
  done:    theme.ok,
  failed:  theme.danger,
  skipped: theme.dim,
};

export function fmtTime(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m < 60) return `${m}m${sec}s`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h${min}m${sec}s`;
}

/** 二态复选框字符映射：0=隐藏 1=显示 */
const CHECKBOX = {
  0: '\u2610', // ☐
  1: '\u2611', // ☑
};

/**
 * @param {{ id: string, description: string, status: string, progress?: number, elapsed?: number, logFilter?: number }} task
 * @returns {string}
 */
export function taskNode(task) {
  const icon = ICONS[task.status] || ICONS.pending;
  let prefix;
  if (task.status === 'running') {
    prefix = theme.PULSE[tick % 10] + icon + theme.reset;
  } else {
    const iconColor = ICON_COLORS[task.status] || ICON_COLORS.pending;
    prefix = iconColor + icon + theme.reset;
  }
  const name = taskColor(task.id) + task.description + theme.reset;

  const cb = theme.faint + (CHECKBOX[task.logFilter ?? 1]) + theme.reset;

  let right = '';
  if (task.progress != null) right += ` ${task.progress}`;
  if (task.elapsed != null) right += ` ${fmtTime(task.elapsed)}`;
  right = right ? theme.faint + right + theme.reset : ' ';
  return prefix + ' ' + name + ' ' + cb + right;
}
