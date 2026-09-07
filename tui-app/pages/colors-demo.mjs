// 颜色系统 demo
// 用法：node demos/colors-demo.mjs

import { taskColor, colorText, taskDot } from '../utils/colors.mjs';

const tasks = ['compile', 'bundle', 'test', 'lint', 'deploy', 'rustc', 'tsc', 'webpack'];

console.log('=== taskColor + 节点名 ===');
for (const id of tasks) {
  console.log(`  ${colorText(id, id)}  (${id})`);
}

console.log('\n=== taskDot + 日志行 ===');
for (const id of tasks) {
  console.log(`  ${taskDot(id)} log line from ${id}`);
}

console.log('\n=== 同ID确定性 ===');
console.log(`  compile: ${taskColor('compile')}  -> ${taskColor('compile')}`);
console.log(`  bundle:  ${taskColor('bundle')}   -> ${taskColor('bundle')}`);
