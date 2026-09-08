/**
 * @file 筛选栏组件
 * @description 提供日志等级筛选的切换逻辑。
 * @module filter-bar
 * @author hound-builder
 */

/**
 * 切换指定等级在筛选状态中的启用/禁用
 * @param {{ levels: string[] }} state - 筛选状态对象
 * @param {string} level - 要切换的日志等级名称
 * @returns {void}
 */
export function toggleLevel(state, level) {
  const idx = state.levels.indexOf(level);
  if (idx >= 0) state.levels.splice(idx, 1);
  else state.levels.push(level);
}
