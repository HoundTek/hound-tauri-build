/**
 * @file 文本宽度计算函数 re-export
 * @description 核心实现已迁移至 ansi.mjs，此处 re-export 保持向后兼容.
 * @module text-width
 * @author hound-builder
 */

/**
 * 从 ansi.mjs 重新导出的文本宽度计算与可视切片函数
 * @type {{ textWidth: (s: string) => number, visSlice: (s: string, start: number, end?: number) => string }}
 */
export { ansiWidth as textWidth, ansiSlice as visSlice } from './ansi.mjs';
