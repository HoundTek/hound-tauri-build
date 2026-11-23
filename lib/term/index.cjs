/**
 * @file 终端字符串统一入口
 * @description 模型操作（width/plain/isAscii/slice/truncate/wrap/pad/concat/join）
 *   + 样式（style）的静态 API 门面。lib/(CJS) 直接 require 本文件；
 *   tui-app(ESM) 经 tui-app/utils/term.mjs 转发。
 *   格子层（cell/sgr）自此导出，供 Buffer/Screen 与高级消费者使用。
 * @module lib/term
 */

const core = require('./core.cjs');
const cell = require('./cell.cjs');
const sgr = require('./sgr.cjs');
const { style } = require('./style.cjs');

const term = {
  // 视图
  plain: core.plain,
  width: core.width,
  isAscii: core.isAscii,
  // 操作
  slice: core.slice,
  truncate: core.truncate,
  wrap: core.wrap,
  pad: core.pad,
  concat: core.concat,
  join: core.join,
  // 样式
  style,
  // 常量
  PREFIX_W: core.PREFIX_W,
};

module.exports = { term, core, cell, sgr, style };
