// 日志空间组件演示
import { logSpace } from '../components/log-space.mjs';
import { scroll } from '../components/scroll.mjs';

// 模拟日志内容
const logContent = [
  'Log 1 Hello World!',
  'Log 2 This is a log',
  'Log 3 Warning!',
  'Log 4 Error!',
  'Log 5 Debug!',
  'Log 6 Info!',
  'Log 7 Trace!',
  'Log 8 Debug!',
  'Log 9 Info!',
  'Log 10 Trace!',
];

// 模拟滚动条
const scrollIndex = 5;

// 模拟滚动条高度
const scrollHeight = 5;

// 模拟滚动条宽度
const scrollWidth = 20;

export function makePage() {
    return logSpace(scrollWidth+2, scrollHeight+2, scroll(scrollHeight, scrollWidth, logContent, scrollIndex));
}