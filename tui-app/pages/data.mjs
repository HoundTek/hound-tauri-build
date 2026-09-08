/**
 * @file 数据管理层
 * @description 任务树构建、日志条目管理、构建状态跟踪。
 *   所有状态 mutation 集中于此，渲染层通过读取导出对象获取数据。
 * @module {demos}/data
 * @author hound-builder
 */

import configModule from '../../lib/config.cjs';
import { applyFilter } from '../utils/filter.mjs';
import { toggleLevel } from '../components/filter-bar.mjs';

const tuiConfig = configModule.getConfig().tui;

// ── 纯函数 ──────────────────────────────────────────

/** 从后端 flat 任务定义构建嵌套树 */
function buildTreeFromDefs(taskDefs) {
  const map = new Map();
  for (const t of taskDefs) {
    map.set(t.id, { id: t.id, description: t.description, status: 'pending', elapsed: 0, logFilter: 1, children: [] });
  }
  const hasParent = new Set();
  for (const t of taskDefs) {
    for (const depId of t.dependsOn) {
      hasParent.add(depId);
    }
  }
  const roots = [];
  for (const t of taskDefs) {
    const node = map.get(t.id);
    for (const depId of t.dependsOn) {
      const child = map.get(depId);
      if (child && !node.children.includes(child)) node.children.push(child);
    }
    if (!hasParent.has(t.id)) roots.push(node);
  }
  return roots.length === 1 ? roots[0] : { id: '_root', description: 'build', status: 'pending', elapsed: 0, logFilter: 1, children: roots };
}

/** 递归查找并更新节点状态 */
function updateNodeStatus(node, taskId, status, elapsed) {
  if (node.id === taskId) {
    node.status = status;
    if (elapsed != null) node.elapsed = elapsed;
    return true;
  }
  if (node.children) {
    for (const c of node.children) {
      if (updateNodeStatus(c, taskId, status, elapsed)) return true;
    }
  }
  return false;
}

/** 检测日志等级 */
function detectLevel(text) {
  const t = text.toLowerCase();
  if (/error|fail|exception/i.test(t)) return 'error';
  if (/warn/i.test(t)) return 'warning';
  if (/success|done|complete|finished/i.test(t)) return 'success';
  if (/info/i.test(t)) return 'info';
  return 'log';
}

/** 收集 logFilter=0 的隐藏任务 ID */
function buildTaskFilters(root) {
  const hidden = new Set();
  (function walk(n) { if (n.logFilter === 0) hidden.add(n.id); n.children?.forEach(walk); })(root);
  return { hidden };
}

/** 计算完全展开的树行数 */
function countAllNodes(node) {
  let n = 1;
  if (node.children) for (const c of node.children) n += countAllNodes(c);
  return n;
}

// ── 可变状态 ────────────────────────────────────────

/** 任务树根节点 */
export let tree = { id: '_root', description: 'build', status: 'pending', elapsed: 0, logFilter: 1, children: [] };

/** 日志条目数组 */
export const logEntries = [];

/** taskId → 启动时刻的时间戳 */
const startTimes = new Map();

/** 全局构建启动时间 */
let buildStartTime = 0;

/** 构建结束时定格的总耗时 */
let finalElapsed = 0;

/** 构建是否成功 */
let buildOk = true;

/** 筛选状态 */
export const filterState = { levels: ['success', 'warning', 'info', 'error', 'log'], query: '', queryActive: false };

/** 是否正在运行 */
export const running = { val: true };

/** 退出确认面板状态 */
export const exitPanel = { visible: false, selected: 'n' };

/** 帮助页面板状态 */
export const helpPanel = { visible: false };

// ── 状态 mutation ───────────────────────────────────

/**
 * 从后端任务定义初始化树
 * @param {Array<{ id: string, description: string, dependsOn: string[] }>} taskDefs - 后端任务定义列表
 * @returns {void}
 */
export function initFromTasks(taskDefs) {
  tree = buildTreeFromDefs(taskDefs);
  logEntries.length = 0;
  startTimes.clear();
  buildStartTime = Date.now();
  running.val = true;
}

/**
 * 更新任务状态
 * @param {string} taskId - 任务 ID
 * @param {string} status - 新状态（pending / running / done / failed / skipped）
 * @param {number} [elapsed] - 已用毫秒数
 * @returns {void}
 */
export function onTaskStatus(taskId, status, elapsed) {
  if (status === 'running' && !startTimes.has(taskId)) {
    startTimes.set(taskId, Date.now() - (elapsed || 0));
  }
  if (status !== 'running') {
    startTimes.delete(taskId);
  }
  updateNodeStatus(tree, taskId, status, elapsed);
}

/**
 * 添加日志条目
 * @param {string} text - 日志文本
 * @param {string} [taskId] - 关联的任务 ID
 * @returns {void}
 */
export function onLogEntry(text, taskId) {
  logEntries.push({ text, level: detectLevel(text), taskId: taskId || '' });
  if (logEntries.length > tuiConfig.logLimit) {
    logEntries.splice(0, logEntries.length - tuiConfig.logLimit);
  }
}

/**
 * 构建结束
 * @param {boolean} ok - 构建是否成功
 * @returns {void}
 */
export function onBuildExit(ok) {
  running.val = false;
  buildOk = !!ok;
  finalElapsed = Date.now() - buildStartTime;
}

/**
 * 切换运行/暂停状态
 * @returns {void}
 */
export function toggleFinished() { running.val = !running.val; }

// ── 渲染辅助（供 makePage 调用）────────────────────

/**
 * 获取当前帧的任务统计 + 构建状态
 * @returns {{ finished: boolean, ok: boolean, finalElapsed: number, pending: number, running: number, done: number, failed: number, skipped: number, totalElapsed: number }}
 */
export function getStats() {
  const counts = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0 };
  (function walk(n) { counts[n.status] = (counts[n.status] || 0) + 1; n.children?.forEach(walk); })(tree);

  const now = Date.now();
  const totalElapsed = buildStartTime ? now - buildStartTime : 0;
  (function updateLiveElapsed(n) {
    if (n.status === 'running' && startTimes.has(n.id)) {
      n.elapsed = now - startTimes.get(n.id);
    }
    n.children?.forEach(updateLiveElapsed);
  })(tree);

  return { finished: !running.val, ok: buildOk, finalElapsed, ...counts, totalElapsed };
}

/**
 * 获取筛选后的日志条目
 * @returns {Array<{ text: string, level: string, taskId: string }>}
 */
export function getFilteredLogs() {
  const taskFilters = buildTaskFilters(tree);
  return applyFilter(logEntries, { ...filterState, taskFilters });
}

/**
 * 获取完全展开的树行数
 * @returns {number}
 */
export function getExpandedTreeH() { return countAllNodes(tree); }

// re-export toggleLevel 供 filterRow 使用
export { toggleLevel };
