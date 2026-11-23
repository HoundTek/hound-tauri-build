/**
 * @file term 模块的 ESM 转发层
 * @description tui-app 统一从本模块取终端字符串能力；
 *   实现位于 lib/term/(CJS)，与 lib/bin/tasks 共用同一份。
 * @module tui-app/utils/term
 */

import termModule from '../../lib/term/index.cjs';

export const { term, core, cell, sgr, style } = termModule;
export default termModule;
