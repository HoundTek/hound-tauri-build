/**
 * @file hound-tauri-build 入口
 * @description 导出 task-runner 核心引擎 API。
 *              自动检测运行环境：优先加载本地副本（npm 发布版），
 *              回退到 monorepo 路径（开发时）。
 * @module hound-tauri-build
 */

const path = require('path');

/**
 * 解析构建模块路径，兼容开发（monorepo）与发布（npm）两种布局
 * @param {string} name - 模块文件名（相对于 lib/）
 * @returns {*} 模块导出
 */
function resolveBuildModule(name) {
  try {
    return require(`./lib/${name}`);
  } catch {
    return require(path.join(__dirname, '..', 'build', 'lib', name));
  }
}

const taskRunner = resolveBuildModule('task-runner.cjs');

module.exports = {
  /** 加载任务注册表 @type {typeof taskRunner.loadTaskRegistry} */
  loadTaskRegistry: taskRunner.loadTaskRegistry,
  /** 解析任务依赖图 @type {typeof taskRunner.resolveTaskGraph} */
  resolveTaskGraph: taskRunner.resolveTaskGraph,
  /** 执行任务列表 @type {typeof taskRunner.executeTasks} */
  executeTasks: taskRunner.executeTasks,
  /** 便捷入口：加载→解析→执行 @type {typeof taskRunner.run} */
  run: taskRunner.run,
  /** 以 inherit stdio 执行命令 @type {typeof taskRunner.runCmdInherit} */
  runCmdInherit: taskRunner.runCmdInherit,
};
