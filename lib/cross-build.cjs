/**
 * @file 交叉编译构建（cross）与前端产物暂存
 * @description 替代原 CROSS_CMD 的 POSIX shell 拼接（rm -rf / cp -r / code=$? / exit $code）：
 *   纯 Node 实现「执行前端构建 hook → 暂存前端产物 → tauri build（hook 置空）→ 清理暂存」，
 *   任何结果都清理（finally），退出码如实传递，跨平台可用。
 *   hook 由本模块先执行（而非 tauri 内部），原因：
 *   1. 暂存发生在 tauri build 之前，若 hook 在 tauri 内部执行，暂存的是构建前的旧产物；
 *   2. tauri 内部执行 hook 时若 hook 间接触发 htb（如 yarn build → htb build），会无限递归。
 * @module lib/cross-build
 */

const fs = require('fs');
const path = require('path');
const fsx = require('./sys/fsx.cjs');
const { run } = require('./sys/run.cjs');
const { runTauri } = require('./tauri-cli.cjs');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '..', '..');

/**
 * 读取 tauri.conf.json 的 build 字段（如 beforeBuildCommand），失败返回空串。
 * @param {string} tauriDir
 * @param {string} field
 * @returns {string}
 */
function readTauriHook(tauriDir, field) {
  try {
    const conf = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, tauriDir, 'tauri.conf.json'), 'utf8'));
    return String((conf.build && conf.build[field]) || '').trim();
  } catch {
    return '';
  }
}

/**
 * 从 tauri.conf.json 的 build.frontendDist 派生前端产物目录（相对项目根）。
 * frontendDist 相对 tauriDir 解析（如 "../dist" → "dist"）。
 * 读取失败或字段缺失返回 null（调用方走回退值）。
 * @param {string} tauriDir
 * @returns {string|null}
 */
function frontendDistDir(tauriDir) {
  const dist = readTauriHook(tauriDir, 'frontendDist');
  if (!dist) return null;
  const abs = path.resolve(ROOT_DIR, tauriDir, dist);
  const rel = path.relative(ROOT_DIR, abs);
  // 防御：frontendDist 指到项目根之外时不可用
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel || '.';
}

/**
 * 将 hook 命令按空白拆为 argv；含 shell 元字符时返回 null（无法用 shell:false 安全执行）。
 * @param {string} cmd
 * @returns {string[]|null}
 */
function splitHook(cmd) {
  if (/[|&;<>$`\\"']/.test(cmd)) return null;
  const parts = cmd.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

/**
 * 执行 beforeBuildCommand（前端构建 hook）。
 * 由本模块先执行（而非 tauri 内部），原因：
 * 1. 暂存发生在 tauri build 之前，若 hook 在 tauri 内部执行，暂存的是构建前的旧产物；
 * 2. tauri 内部执行 hook 时若 hook 间接触发 htb（如 yarn build → htb build），会无限递归。
 * @param {object} opts
 * @param {string} opts.tauriDir - Tauri 目录（相对项目根）
 * @param {(line: string) => void} [opts.onLine] - 行级日志回调
 * @param {{ signaled: boolean }} [opts.abort] - 中止信号
 * @returns {Promise<boolean>} 无 hook 视为成功
 */
async function runFrontendBuild({ tauriDir, onLine, abort }) {
  const hook = readTauriHook(tauriDir, 'beforeBuildCommand');
  if (!hook) return true;
  const parts = splitHook(hook);
  if (!parts) {
    if (onLine) onLine(`[error] beforeBuildCommand 含 shell 元字符，无法安全执行: ${hook}`);
    if (onLine) onLine('[hint] 请改为简单命令（如 "node node_modules/vite/bin/vite.js build"），或清空该字段后手动构建前端');
    return false;
  }
  if (onLine) onLine(`Running beforeBuildCommand \`${hook}\``);
  const h = await run(parts[0], parts.slice(1), { cwd: ROOT_DIR, env: buildEnv(), onLine, abort });
  for (const g of h.guides) if (onLine) onLine(`[hint] ${g}`);
  if (!h.ok) {
    if (onLine) onLine(`[error] beforeBuildCommand 失败（退出码 ${h.code == null ? 'N/A' : h.code}）`);
    return false;
  }
  return true;
}

/**
 * 纯前端构建（web 目标）：执行 hook 并确认产物目录存在。
 * @param {object} opts
 * @param {string} opts.tauriDir
 * @param {string} opts.frontendDir - 前端产物目录（相对项目根）
 * @param {(line: string) => void} [opts.onLine]
 * @param {{ signaled: boolean }} [opts.abort]
 * @returns {Promise<boolean>}
 */
async function webBuild({ tauriDir, frontendDir, onLine, abort }) {
  if (!await runFrontendBuild({ tauriDir, onLine, abort })) return false;
  if (!fs.existsSync(path.join(ROOT_DIR, frontendDir))) {
    if (onLine) onLine(`[error] 前端产物目录不存在: ${frontendDir}`);
    if (onLine) onLine('[hint] 请检查 tauri.conf.json 的 build.frontendDist 与 beforeBuildCommand 的输出目录是否一致');
    return false;
  }
  return true;
}

/**
 * 暂存前端产物到 tauriDir/.htb-frontend-dist，执行构建，finally 清理。
 * @param {object} opts
 * @param {string[]} opts.tauriArgs - tauri build 参数（target/bundles 等，不含 --config）
 * @param {string} opts.tauriDir - Tauri 目录（相对项目根）
 * @param {string} opts.frontendDir - 前端产物目录（相对项目根）
 * @param {(line: string) => void} [opts.onLine] - 行级日志回调
 * @param {{ signaled: boolean }} [opts.abort] - 中止信号
 * @returns {Promise<boolean>}
 */
async function stagedBuild({ tauriArgs, tauriDir, frontendDir, onLine, abort }) {
  const staging = path.join(ROOT_DIR, tauriDir, '.htb-frontend-dist');
  fsx.rmrf(staging);

  // 1) 先执行 beforeBuildCommand，保证暂存的是最新前端产物
  if (!await runFrontendBuild({ tauriDir, onLine, abort })) return false;

  // 2) 暂存前端产物
  const distAbs = path.join(ROOT_DIR, frontendDir);
  if (!fs.existsSync(distAbs)) {
    if (onLine) onLine(`[error] 前端产物目录不存在: ${frontendDir}`);
    if (onLine) onLine('[hint] 请在 tauri.conf.json 配置 beforeBuildCommand（前端构建命令），或先手动构建前端');
    return false;
  }
  fsx.cp(distAbs, staging);

  try {
    // 3) tauri build：hook 已由本模块执行，覆盖为 no-op 防止重复执行与递归
    const override = JSON.stringify({
      build: { frontendDist: './.htb-frontend-dist', beforeBuildCommand: 'node -e ""' },
    });
    const r = await runTauri(
      ['build', ...tauriArgs, '--config', override],
      { onLine, abort, env: buildEnv() },
    );
    for (const g of r.guides) if (onLine) onLine(`[hint] ${g}`);
    return r.ok;
  } finally {
    fsx.rmrf(staging);
  }
}

/**
 * 直接构建（无暂存）：tauri build 透传。
 * @param {object} opts
 * @param {string[]} opts.tauriArgs
 * @param {(line: string) => void} [opts.onLine]
 * @param {{ signaled: boolean }} [opts.abort]
 * @returns {Promise<boolean>}
 */
async function plainBuild({ tauriArgs, onLine, abort }) {
  const r = await runTauri(['build', ...tauriArgs], { onLine, abort, env: buildEnv() });
  for (const g of r.guides) if (onLine) onLine(`[hint] ${g}`);
  return r.ok;
}

/**
 * 子进程环境：注入项目 node_modules/.bin 到 PATH（与 buildChildEnv 一致，
 * 供 tauri 内部探测的工具可用；tauri CLI 本身不依赖 PATH）。
 * 另外注入 brew LLVM 的 keg-only bin 目录（若存在 llvm-rc）：
 * macOS 上 brew install llvm 默认不进 PATH，而 tauri-winres 编译
 * MSVC 目标的 Windows 资源（图标/清单）需要 llvm-rc。
 */
function buildEnv() {
  const nodeBin = path.join(ROOT_DIR, 'node_modules', '.bin');
  const extra = LLVM_BIN_DIRS.filter((d) => fs.existsSync(path.join(d, 'llvm-rc')));
  const PATH = [nodeBin, ...extra, process.env.PATH].filter(Boolean).join(path.delimiter);
  return { ...process.env, PATH, FORCE_COLOR: '1' };
}

/** brew LLVM 的 keg-only 安装位置（Apple Silicon / Intel） */
const LLVM_BIN_DIRS = ['/opt/homebrew/opt/llvm/bin', '/usr/local/opt/llvm/bin'];

module.exports = { stagedBuild, plainBuild, webBuild, runFrontendBuild, frontendDistDir, buildEnv, readTauriHook, splitHook };
