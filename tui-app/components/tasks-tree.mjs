/**
 * @file 任务树渲染组件
 * @description 将构建任务列表渲染为可折叠的树形结构。
 * @module components/tasks-tree
 * @author hound-builder
 */

import { getTaskTree } from '../utils/tasks.mjs';
import { drawTree } from './tree.mjs';
import { taskNode } from './task-node.mjs';

/**
 * 根据目标 ID 列表构建并渲染任务树
 * @param {string[]} targetIds 目标任务 ID 数组
 * @returns {string[]} 渲染后的行数组，若存在错误则返回错误信息数组
 */
export function tasksTree(targetIds) {
  const { nodes, errors } = getTaskTree(targetIds);
  if (errors.length > 0) return errors;
  const root = nodes.length === 1
    ? nodes[0]
    : { description: 'build', children: nodes };
  return drawTree(root, { renderNode: taskNode });
}
