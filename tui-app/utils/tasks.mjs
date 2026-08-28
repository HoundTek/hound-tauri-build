import { createRequire } from 'module';
import { join } from 'path';

const require = createRequire(import.meta.url);
const { loadTaskRegistry } = require(join(import.meta.dirname, '..', '..', 'lib', 'task-runner.cjs'));

/** 任务树节点 */
class TaskNode {
  constructor(id, description, children = []) {
    this.id = id;
    this.description = description;
    this.children = children;
  }
}

/** BFS 收集目标及其全部传递依赖 */
function collectDeps(targetIds, registry) {
  const needed = new Set();
  const queue = [...targetIds];
  while (queue.length > 0) {
    const id = queue.shift();
    if (needed.has(id) || !registry.has(id)) continue;
    needed.add(id);
    for (const dep of registry.get(id).dependsOn) queue.push(dep);
  }
  return [...needed].map((id) => registry.get(id));
}

/** 构建任务树 */
function buildTree(taskList, registry) {
  const hasDependent = new Set();
  for (const t of taskList) {
    for (const dep of t.dependsOn) hasDependent.add(dep);
  }
  const roots = taskList.filter((t) => !hasDependent.has(t.id));

  function buildNode(id) {
    const task = registry.get(id);
    if (!task) return null;
    return new TaskNode(task.id, task.description, task.dependsOn.map(buildNode).filter(Boolean));
  }

  return roots.map((r) => buildNode(r.id)).filter(Boolean);
}

/*
 * 返回任务树
 * @param {string[]} [targetIds] - 目标任务 ID 列表，默认全部
 * @returns {{ nodes: TaskNode[], errors: string[] }}
 */
export function getTaskTree(targetIds) {
  const registry = loadTaskRegistry();

  if (!targetIds || targetIds.length === 0) {
    targetIds = [...registry.keys()];
  }

  const errors = [];
  for (const id of targetIds) {
    if (!registry.has(id)) errors.push('Unknown task: ' + id);
  }
  if (errors.length > 0) return { nodes: [], errors };

  const taskList = collectDeps(targetIds, registry);
  return { nodes: buildTree(taskList, registry), errors: [] };
}
