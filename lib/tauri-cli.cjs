/**
 * @file Tauri CLI 解析与调用
 * @description 直接定位 @tauri-apps/cli 的可执行入口，统一以
 *   `node <cli.js> ...args` 调用——不经 shell、不经 .bin shim、不经 yarn/npm，
 *   与包管理器（yarn/npm/pnpm/bun）和 package.json scripts 完全无关。
 * @module lib/tauri-cli
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '..', '..');

/** @type {{ cmd: string, baseArgs: string[], source: string } | null | undefined} */
let cached;

/**
 * 从项目的 node_modules 解析 @tauri-apps/cli 的 bin 入口 JS。
 * peerDependency 必然可解析（pnpm 隔离布局同样适用）。
 * @returns {{ cmd: string, baseArgs: string[], source: string } | null}
 */
function tryResolveLocal() {
  try {
    const pkgJsonPath = require.resolve('@tauri-apps/cli/package.json', { paths: [ROOT_DIR] });
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const binField = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin && (pkg.bin.tauri || Object.values(pkg.bin)[0]));
    if (!binField) return null;
    const cliJs = path.resolve(path.dirname(pkgJsonPath), binField);
    if (!fs.existsSync(cliJs)) return null;
    return { cmd: process.execPath, baseArgs: [cliJs], source: 'local' };
  } catch (_) {
    return null;
  }
}

/**
 * 回退：项目 node_modules/.bin 下的 shim（posix 可执行脚本；Windows 的 .cmd 不经 shell 无法直接执行，跳过）。
 * @returns {{ cmd: string, baseArgs: string[], source: string } | null}
 */
function tryResolveBin() {
  if (process.platform === 'win32') return null;
  const shim = path.join(ROOT_DIR, 'node_modules', '.bin', 'tauri');
  if (fs.existsSync(shim)) return { cmd: shim, baseArgs: [], source: 'bin' };
  return null;
}

/**
 * 回退：PATH 中的全局 tauri。
 * @returns {{ cmd: string, baseArgs: string[], source: string } | null}
 */
function tryResolvePath() {
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, 'tauri' + ext.toLowerCase());
      const fullUpper = path.join(dir, 'tauri' + ext);
      for (const candidate of [full, fullUpper]) {
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
          return { cmd: candidate, baseArgs: [], source: 'global' };
        } catch (_) { /* not here */ }
      }
    }
  }
  return null;
}

/**
 * 解析 Tauri CLI（带缓存）。三种来源按优先级：本地依赖 > .bin shim > 全局 PATH。
 * @returns {{ cmd: string, baseArgs: string[], source: string }}
 */
function resolveTauriCli() {
  if (cached === undefined) {
    cached = tryResolveLocal() || tryResolveBin() || tryResolvePath() || null;
  }
  if (!cached) {
    const err = new Error(
      '未找到 Tauri CLI。\n' +
      '  修复：在项目根目录执行 npm install -D @tauri-apps/cli（或 yarn add -D @tauri-apps/cli）'
    );
    err.code = 'HTB_TAURI_CLI_NOT_FOUND';
    throw err;
  }
  return cached;
}

/**
 * 组装 tauri 调用的 argv：{ cmd, args }，供 lib/sys/run.cjs 使用。
 * @param {string[]} args - tauri 子命令与参数（如 ['build', '--target', '...']）
 * @returns {{ cmd: string, args: string[] }}
 */
function tauriCmd(args) {
  const cli = resolveTauriCli();
  return { cmd: cli.cmd, args: [...cli.baseArgs, ...args] };
}

/**
 * 执行 tauri 命令（lib/sys/run.cjs 的便捷封装）。
 * @param {string[]} args
 * @param {object} [opts] - 透传 run() 的 opts（cwd 缺省为项目根）
 * @returns {Promise<{ ok: boolean, code: number|null, output: string, guides: string[] }>}
 */
function runTauri(args, opts = {}) {
  const { run } = require('./sys/run.cjs');
  const { cmd, args: fullArgs } = tauriCmd(args);
  return run(cmd, fullArgs, { cwd: ROOT_DIR, ...opts });
}

module.exports = { resolveTauriCli, tauriCmd, runTauri };
