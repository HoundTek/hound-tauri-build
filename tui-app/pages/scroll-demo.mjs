// 滚动组件演示
// 包含测试用的滚动内容，行的长短等不一，且包含各种字符

import { scroll } from '../components/scroll.mjs';

const content = [
  'Hound Tauri 构建系统',
  '基于 TaskDAG + ConflictSet 架构',
  '短行',
  '这条线比较长需要占用更多的宽度来展示内容ABCDEFG',
  '\x1b[31m红色ANSI文字\x1b[0m 普通',
  '中英混合 Mixed 日本語 テスト 🎉',
  '全角字符：ＡＢＣＤＥＦＧＨＩＪ',
  'end',
];

let maxIdx = 1;

export function makePage() {
  return scroll(5, 50, content, maxIdx);
}