/**
 * @file 筛选引擎
 * @description 提供预设等级筛选、自定义文本筛选及按任务过滤功能.
 * @module filter
 * @author hound-builder
 */

const LEVELS = ['success', 'warning', 'error', 'info'];

/**
 * 根据等级、文本和任务过滤条件筛选日志条目
 * @param {Array<{ text: string, level: string, taskId?: string }>} entries
 * @param {{ levels?: string[], query?: string, taskFilters?: { hidden: Set<string> } }} opts
 * @returns {Array<{ text: string, level: string, taskId?: string }>}
 */
export function applyFilter(entries, opts = {}) {
  let result = entries;

  // 按任务过滤：hidden 任务完全排除
  if (opts.taskFilters && opts.taskFilters.hidden.size > 0) {
    result = result.filter((e) => !opts.taskFilters.hidden.has(e.taskId));
  }

  // 预设等级筛选
  if (opts.levels && opts.levels.length < LEVELS.length) {
    if (opts.levels.length === 0) return [];
    const set = new Set(opts.levels);
    result = result.filter((e) => set.has(e.level));
  }

  // 自定义文本筛选
  if (opts.queryActive && opts.query && opts.query.trim()) {
    const q = opts.query.toLowerCase();
    result = result.filter((e) => e.text.toLowerCase().includes(q));
  }

  return result;
}
