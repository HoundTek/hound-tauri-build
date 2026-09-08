/**
 * @file 终端主题适配样式
 * @description 弹窗/警告等覆盖层不再写死 256 色背景，改用反白/加粗/标准 ANSI 色，以适配终端主题.
 * @module theme
 * @author hound-builder
 */

/**
 * 终端主题样式常量集合，包含反白、强调、标准 ANSI 前景色及呼吸动画序列
 * @type {{
 *   rev: string, revOff: string,
 *   bold: string, dim: string, underline: string, underOff: string, reset: string,
 *   fgDefault: string,
 *   warn: string, warnBold: string,
 *   danger: string, dangerBold: string,
 *   ok: string, info: string, faint: string,
 *   PULSE: string[]
 * }}
 */
export const theme = {
  // 反白（高亮/选中/弹窗强调行）
  rev:      '\x1b[7m',
  revOff:   '\x1b[27m',
  // 文字强调
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  underline:'\x1b[4m',
  underOff: '\x1b[24m',
  reset:    '\x1b[0m',
  // 标准 ANSI 前景色（终端主题自适应）
  fgDefault:'\x1b[39m',
  warn:     '\x1b[33m',   // 黄
  warnBold: '\x1b[1;33m',
  danger:   '\x1b[31m',   // 红
  dangerBold:'\x1b[1;31m',
  ok:       '\x1b[32m',   // 绿
  info:     '\x1b[36m',   // 青
  faint:    '\x1b[90m',   // 亮黑（弱化）
  // 运行中呼吸动画（10帧循环 dim→绿→亮绿→粗体绿→绿→...）
  PULSE: [
    '\x1b[2m',       '\x1b[2m\x1b[32m',
    '\x1b[92m',      '\x1b[1m\x1b[32m',
    '\x1b[32m',      '\x1b[32m',
    '\x1b[1m\x1b[32m','\x1b[92m',
    '\x1b[2m\x1b[32m','\x1b[2m',
  ],
};
