// 筛选引擎 demo
import { applyFilter } from '../utils/filter.mjs';

const entries = [
  { text: 'compiling rustc...', level: 'info', taskId: 'rustc' },
  { text: 'rustc done in 12.3s', level: 'success', taskId: 'rustc' },
  { text: 'WARNING: unused import', level: 'warning', taskId: 'rustc' },
  { text: 'ERROR: type mismatch', level: 'error', taskId: 'tsc' },
  { text: 'tsc done in 3.2s', level: 'success', taskId: 'tsc' },
  { text: 'bundling...', level: 'info', taskId: 'webpack' },
  { text: 'ERROR: module not found', level: 'error', taskId: 'webpack' },
];

function show(label, result) {
  console.log(`\n=== ${label} (${result.length}) ===`);
  result.forEach((e) => console.log(`  [${e.level}] ${e.text}`));
}

show('全部', applyFilter(entries));

show('仅 error', applyFilter(entries, { levels: ['error'] }));

show('error + warning', applyFilter(entries, { levels: ['error', 'warning'] }));

show('含 "rustc"', applyFilter(entries, { query: 'rustc' }));

show('error + 含 "module"', applyFilter(entries, { levels: ['error'], query: 'module' }));
