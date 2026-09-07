// 等级筛选切换工具

/** 切换等级在筛选状态中的启用/禁用 */
export function toggleLevel(state, level) {
  const idx = state.levels.indexOf(level);
  if (idx >= 0) state.levels.splice(idx, 1);
  else state.levels.push(level);
}
