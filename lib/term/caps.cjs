/**
 * @file 终端能力检测（caps）
 * @description 检测色级 / OSC 8 / 同步输出(?2026) / 扩展下划线 / kitty 键盘协议，
 *   结果供序列化降级（cell.degradeStyle）与渲染出口（Screen）使用。
 *   检测基于 TERM_PROGRAM / TERM 白名单 + chalk 的 supports-color，CI 环境保守降级。
 * @module lib/term/caps
 * @see docs/tui-cell-refactor.md §3
 */

const chalk = require('chalk');

/**
 * @typedef {Object} TermCaps
 * @property {number} colorLevel - 0|1(16色)|2(256色)|3(真彩)
 * @property {boolean} osc8 - OSC 8 超链接
 * @property {boolean} syncOutput - DEC ?2026 同步输出（防撕裂）
 * @property {boolean} underlineStyles - SGR 4:x 扩展下划线样式
 * @property {boolean} underlineColor - SGR 58 下划线颜色
 * @property {boolean} blink - 闪烁属性
 * @property {boolean} kittyKeyboard - kitty 键盘协议（预留，Phase D）
 */

/**
 * 检测终端能力。
 * @param {NodeJS.ProcessEnv} [env]
 * @param {boolean} [isTTY] - 输出是否 TTY（缺省看 process.stdout）
 * @returns {TermCaps}
 */
function detectCaps(env = process.env, isTTY = process.stdout.isTTY) {
  if (!isTTY) {
    return {
      colorLevel: 0, osc8: false, syncOutput: false,
      underlineStyles: false, underlineColor: false, blink: false, kittyKeyboard: false,
    };
  }

  const level = (chalk.supportsColor && chalk.supportsColor.level) || 0;
  const termProgram = env.TERM_PROGRAM || '';
  const term = env.TERM || '';
  const inCI = !!env.CI;

  const modern = /^(iTerm\.app|WezTerm|kitty|foot|ghostty|vscode|Windows_Terminal|Apple_Terminal)$/i.test(termProgram)
    || /kitty|wezterm|foot|ghostty|alacritty/i.test(term);
  const kittyLike = /^(WezTerm|kitty|foot|ghostty)$/i.test(termProgram)
    || /kitty|wezterm|foot|ghostty/i.test(term);

  return {
    colorLevel: level,
    // OSC 8：现代终端白名单，CI 保守关闭
    osc8: !inCI && modern,
    // 同步输出 ?2026：现代终端白名单（不支持只是回到逐帧绘制，无副作用）
    syncOutput: modern,
    // 扩展下划线样式/颜色：kitty 系较可靠，其余保守按单下划线降级
    underlineStyles: kittyLike,
    underlineColor: kittyLike || modern,
    blink: level > 0,
    kittyKeyboard: kittyLike,
  };
}

/** 进程级缓存（终端能力在生命周期内不变） */
let _cached = null;

/**
 * 取当前进程的能力（缓存）。
 * @returns {TermCaps}
 */
function getCaps() {
  if (!_cached) _cached = detectCaps();
  return _cached;
}

/** 重置缓存（测试用） */
function resetCaps() {
  _cached = null;
}

module.exports = { detectCaps, getCaps, resetCaps };
