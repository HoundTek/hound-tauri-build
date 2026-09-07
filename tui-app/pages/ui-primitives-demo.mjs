// 文本、按钮、单行布局 demo

import { text } from '../components/text.mjs';
import { button } from '../components/button.mjs';
import { hLayout } from '../components/h-layout.mjs';

const W = 60;

console.log('=' .repeat(W));
console.log('text');
console.log('=' .repeat(W));

console.log(text('plain text', { width: W }) + '|');
console.log(text('red bold', { color: 'red', bold: true, width: W }) + '|');
console.log(text('cyan underline', { color: 'cyan', underline: true, width: W }) + '|');
console.log(text('dim gray', { color: 'gray', dim: true, width: W }) + '|');

console.log('');
console.log('=' .repeat(W));
console.log('button');
console.log('=' .repeat(W));

const items = [
  { text: button('Success', { active: true, color: '\x1b[32m', width: 11 }), width: 12 },
  { text: button('Warning', { active: true, color: '\x1b[33m', width: 11 }), width: 12 },
  { text: button('Error', { active: false, width: 9 }), width: 10 },
];

for (const item of items) {
  console.log(item.text + '|');
}

console.log('');
console.log('=' .repeat(W));
console.log('hLayout (filter bar 示例)');
console.log('=' .repeat(W));

const bar = hLayout(items, W).line;
console.log(bar + '|');

console.log('');
console.log('=' .repeat(W));
console.log('hLayout (status bar 示例)');
console.log('=' .repeat(W));

const statusItems = [
  { text: text('[Building]', { bold: true, width: 12 }), width: 12 },
  { text: text('Success: 3', { color: 'green', width: 12 }), width: 12 },
  { text: text('Failed: 0', { color: 'red', width: 11 }), width: 11 },
  { text: text('Skipped: 2', { color: 'gray', width: 12 }), width: 12 },
];
console.log(hLayout(statusItems, W).line + '|');
