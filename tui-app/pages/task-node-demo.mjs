// TaskNode demo：集成到 tree 中

import { drawTree, toggleNode } from '../components/tree.mjs';
import { taskNode } from '../components/task-node.mjs';

const tree = {
  id: 'build', description: 'build', status: 'running', elapsed: 4500, progress: '2/3',
  showSuccess: true, showWarning: true, showError: true,
  children: [
    { id: 'compile', description: 'compile', status: 'done', elapsed: 12300, progress: '2/2',
      showSuccess: true, showWarning: false, showError: false, children: [
      { id: 'rustc', description: 'rustc', status: 'done', elapsed: 10200,
        showSuccess: true, showWarning: false, showError: false, children: [] },
      { id: 'tsc', description: 'tsc', status: 'done', elapsed: 2100,
        showSuccess: true, showWarning: false, showError: false, children: [] },
    ]},
    { id: 'bundle', description: 'bundle', status: 'running', elapsed: 3200, progress: '1/2',
      showSuccess: false, showWarning: true, showError: true, children: [
      { id: 'webpack', description: 'webpack', status: 'running', elapsed: 3200,
        showSuccess: false, showWarning: true, showError: false, children: [] },
      { id: 'rollup', description: 'rollup', status: 'pending', elapsed: 0,
        showSuccess: false, showWarning: false, showError: false, children: [] },
    ]},
    { id: 'test', description: 'test', status: 'pending', elapsed: 0,
      showSuccess: false, showWarning: false, showError: false, children: [
      { id: 'unit', description: 'unit', status: 'pending', children: [] },
      { id: 'e2e', description: 'e2e', status: 'pending', children: [] },
    ]},
  ],
};

console.log(drawTree(tree, { renderNode: taskNode }).join('\n'));
