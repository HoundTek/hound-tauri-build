// 文本宽度计算函数
// 核心实现已迁移至 ansi.mjs，此处 re-export 保持向后兼容

export { ansiWidth as textWidth, ansiSlice as visSlice } from './ansi.mjs';
