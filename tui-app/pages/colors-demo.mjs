// 颜色系统 demo（term.style.task 稳定配色）
// 用法：node pages/colors-demo.mjs

import { term } from '../utils/term.mjs';

const tasks = ['compile', 'bundle', 'test', 'lint', 'deploy', 'rustc', 'tsc', 'webpack'];

console.log('=== style.task + 节点名 ===');
for (const id of tasks) {
  console.log(`  ${term.style.task(id)}  (${id})`);
}

console.log('\n=== style.taskDot + 日志行 ===');
for (const id of tasks) {
  console.log(`  ${term.style.taskDot(id)} log line from ${id}`);
}

console.log('\n=== 同ID确定性 ===');
console.log(`  compile: ${term.style.task('compile')}  -> ${term.style.task('compile')}`);
console.log(`  bundle:  ${term.style.task('bundle')}   -> ${term.style.task('bundle')}`);
