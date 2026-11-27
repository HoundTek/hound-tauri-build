/**
 * @file 环境预检
 * @description 构建前按目标平台检查依赖环境，失败时输出「什么坏了 / 为什么 / 怎么修」
 *   的引导面板（分操作系统给出命令）。任一必需检查失败即中止构建。
 *   独立命令：htb doctor（全量检查报告，不构建）。
 * @module lib/preflight
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { style } = require('./term/index.cjs');
const { resolveExecutable } = require('./sys/run.cjs');

const ROOT_DIR = process.env.HOUND_BUILD_ROOT || path.resolve(__dirname, '..', '..');

// ── 探测原语 ────────────────────────────────────────

/** 命令是否可执行成功（version 探测） */
function probe(cmd, args) {
  try {
    const r = spawnSync(resolveExecutable(cmd), args, { encoding: 'utf8', timeout: 15000 });
    return r.status === 0;
  } catch (_) {
    return false;
  }
}

/** 命令是否存在（不执行） */
function commandExists(cmd) {
  return resolveExecutable(cmd) !== cmd;
}

// ── 检查项注册表 ────────────────────────────────────

/**
 * needs: 该检查适用的目标平台（'all' 或平台名数组）
 * host:  仅在指定主机平台执行（缺省不限）
 */
const CHECKS = [
  {
    id: 'node',
    needs: 'all',
    detect() {
      const major = Number(process.version.slice(1).split('.')[0]);
      return major >= 18
        ? { ok: true, detail: process.version }
        : { ok: false, detail: `${process.version}（需要 >= 18）`, hint: '升级 Node.js：https://nodejs.org/' };
    },
  },
  {
    id: 'tauri-cli',
    needs: 'all',
    detect() {
      try {
        const { resolveTauriCli } = require('./tauri-cli.cjs');
        const cli = resolveTauriCli();
        return { ok: true, detail: `${cli.source} (${cli.cmd})` };
      } catch (e) {
        return { ok: false, detail: '未找到 @tauri-apps/cli', hint: 'npm install -D @tauri-apps/cli（或 yarn add -D @tauri-apps/cli）' };
      }
    },
  },
  {
    id: 'rust',
    needs: 'all',
    detect() {
      return probe('cargo', ['--version'])
        ? { ok: true, detail: 'cargo 可用' }
        : { ok: false, detail: 'cargo 不可用', hint: '安装 Rust：https://rustup.rs（curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh）' };
    },
  },
  {
    id: 'cross',
    needs: ['win', 'linux', 'linux-arm64'],
    // 仅在「主机不是目标平台」时需要交叉编译
    hostCheck(target) {
      if (target === 'win') return process.platform !== 'win32';
      if (target === 'linux') return process.platform !== 'linux';
      // linux-arm64：仅在 linux/arm64 主机上可原生构建，其余都需要 cross
      if (target === 'linux-arm64') return !(process.platform === 'linux' && process.arch === 'arm64');
      return true;
    },
    detect() {
      return probe('cross', ['--version'])
        ? { ok: true, detail: 'cross 可用' }
        : { ok: false, detail: 'cross 未安装', hint: 'cargo install cross' };
    },
  },
  {
    id: 'docker',
    needs: ['win', 'linux', 'linux-arm64'],
    hostCheck(target) {
      if (target === 'win') return process.platform !== 'win32';
      if (target === 'linux') return process.platform !== 'linux';
      if (target === 'linux-arm64') return !(process.platform === 'linux' && process.arch === 'arm64');
      return true;
    },
    detect() {
      if (!commandExists('docker')) {
        const hint = {
          darwin: '安装 Docker Desktop：https://www.docker.com/products/docker-desktop/（或 brew install --cask docker）',
          win32: '安装 Docker Desktop：https://www.docker.com/products/docker-desktop/',
          linux: '安装 Docker：sudo apt install docker.io（或发行版对应包）',
        }[process.platform];
        return { ok: false, detail: 'docker 未安装', hint };
      }
      return probe('docker', ['info'])
        ? { ok: true, detail: 'Docker daemon 运行中' }
        : {
            ok: false,
            detail: 'Docker daemon 未运行',
            hint: {
              darwin: '启动 Docker Desktop：open -a Docker',
              win32: '启动 Docker Desktop',
              linux: 'sudo systemctl start docker（或 systemctl --user start docker）',
            }[process.platform],
          };
    },
  },
  {
    id: 'cargo-xwin',
    needs: ['win-arm64', 'win-arm64-portable', 'win-portable'],
    detect() {
      return probe('cargo', ['xwin', '--version'])
        ? { ok: true, detail: 'cargo-xwin 可用' }
        : { ok: false, detail: 'cargo-xwin 未安装', hint: 'cargo install cargo-xwin（Windows ARM 交叉编译工具链）' };
    },
  },
  {
    id: 'rust-target:win-portable',
    needs: ['win-portable'],
    detect() {
      try {
        const r = spawnSync(resolveExecutable('rustup'), ['target', 'list', '--installed'], { encoding: 'utf8', timeout: 15000 });
        const installed = r.status === 0 && r.stdout.includes('x86_64-pc-windows-msvc');
        return installed
          ? { ok: true, detail: 'x86_64-pc-windows-msvc 已安装' }
          : { ok: false, detail: '缺少 Rust 目标 x86_64-pc-windows-msvc', hint: 'rustup target add x86_64-pc-windows-msvc' };
      } catch (_) {
        return { ok: false, detail: 'rustup 不可用', hint: '安装 Rust：https://rustup.rs，然后 rustup target add x86_64-pc-windows-msvc' };
      }
    },
  },
  {
    id: 'rust-target:win-arm64',
    needs: ['win-arm64', 'win-arm64-portable'],
    detect() {
      try {
        const r = spawnSync(resolveExecutable('rustup'), ['target', 'list', '--installed'], { encoding: 'utf8', timeout: 15000 });
        const installed = r.status === 0 && r.stdout.includes('aarch64-pc-windows-msvc');
        return installed
          ? { ok: true, detail: 'aarch64-pc-windows-msvc 已安装' }
          : { ok: false, detail: '缺少 Rust 目标 aarch64-pc-windows-msvc', hint: 'rustup target add aarch64-pc-windows-msvc' };
      } catch (_) {
        return { ok: false, detail: 'rustup 不可用', hint: '安装 Rust：https://rustup.rs，然后 rustup target add aarch64-pc-windows-msvc' };
      }
    },
  },
  {
    id: 'clang',
    needs: ['win-arm64', 'win-arm64-portable', 'win-portable'],
    // cargo-xwin 用 clang-cl/lld 链接 MSVC 目标；Windows 主机装 LLVM 即可
    detect() {
      return probe('clang', ['--version'])
        ? { ok: true, detail: 'clang 可用' }
        : {
            ok: false,
            detail: 'clang 不可用（cargo-xwin 需要 LLVM）',
            hint: {
              darwin: 'xcode-select --install（或 brew install llvm）',
              win32: '安装 LLVM：https://releases.llvm.org/download.html',
              linux: 'sudo apt install clang lld',
            }[process.platform],
          };
    },
  },
  {
    id: 'llvm-rc',
    needs: ['win-arm64', 'win-arm64-portable', 'win-portable'],
    // tauri-winres 编译 MSVC 目标的 Windows 资源（图标/清单）需要 llvm-rc；
    // brew 的 llvm 是 keg-only 不在 PATH，htb 构建时会自动注入其 bin 目录
    detect() {
      if (probe('llvm-rc', ['--version'])) return { ok: true, detail: 'llvm-rc 可用' };
      const keg = ['/opt/homebrew/opt/llvm/bin/llvm-rc', '/usr/local/opt/llvm/bin/llvm-rc']
        .find((p) => fs.existsSync(p));
      if (keg) return { ok: true, detail: `llvm-rc 可用（${keg}，构建时自动加入 PATH）` };
      return {
        ok: false,
        detail: '缺少 llvm-rc（tauri-winres 编译 Windows 资源失败：NotAttempted("llvm-rc")）',
        hint: {
          darwin: 'brew install llvm',
          win32: '安装 LLVM：https://releases.llvm.org/download.html',
          linux: 'sudo apt install llvm',
        }[process.platform],
      };
    },
  },
  {
    id: 'rust-target:mac-arm64',
    needs: ['mac-arm64'],
    // mac 目标是宿主机原生 cargo 构建（不经 cross），需要本机安装 rust target
    hostCheck() { return process.platform === 'darwin'; },
    detect() {
      try {
        const r = spawnSync(resolveExecutable('rustup'), ['target', 'list', '--installed'], { encoding: 'utf8', timeout: 15000 });
        const installed = r.status === 0 && r.stdout.includes('aarch64-apple-darwin');
        return installed
          ? { ok: true, detail: 'aarch64-apple-darwin 已安装' }
          : { ok: false, detail: '缺少 Rust 目标 aarch64-apple-darwin', hint: 'rustup target add aarch64-apple-darwin' };
      } catch (_) {
        return { ok: false, detail: 'rustup 不可用', hint: '安装 Rust：https://rustup.rs，然后 rustup target add aarch64-apple-darwin' };
      }
    },
  },
  {
    id: 'xcode',
    needs: ['mac', 'mac-arm64', 'mac-universal', 'desktop', 'ios'],
    hostCheck() { return process.platform === 'darwin'; },
    detect() {
      if (!probe('xcodebuild', ['-version'])) {
        return { ok: false, detail: 'Xcode 命令行工具不可用', hint: 'xcode-select --install（或安装 Xcode）' };
      }
      return { ok: true, detail: 'Xcode 可用' };
    },
  },
  {
    id: 'android-sdk',
    needs: ['android'],
    detect() {
      const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
      if (!home) {
        return {
          ok: false,
          detail: 'ANDROID_HOME 未设置',
          hint: {
            darwin: 'export ANDROID_HOME="$HOME/Library/Android/sdk"',
            win32: 'setx ANDROID_HOME "%LOCALAPPDATA%\\Android\\Sdk"',
            linux: 'export ANDROID_HOME="$HOME/Android/Sdk"',
          }[process.platform],
        };
      }
      const adb = path.join(home, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
      return fs.existsSync(adb)
        ? { ok: true, detail: home }
        : { ok: false, detail: `${home} 下缺少 platform-tools`, hint: '用 Android Studio SDK Manager 安装 Platform Tools' };
    },
  },
  {
    id: 'java',
    needs: ['android'],
    detect() {
      if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) {
        return { ok: true, detail: `JAVA_HOME=${process.env.JAVA_HOME}` };
      }
      return probe('java', ['-version'])
        ? { ok: true, detail: 'java 可用（未设 JAVA_HOME）' }
        : {
            ok: false,
            detail: '未找到 JDK（JAVA_HOME 未设置且 java 不在 PATH）',
            hint: {
              darwin: 'brew install openjdk@17',
              win32: '安装 JDK 17：https://adoptium.net/',
              linux: 'sudo apt install openjdk-17-jdk',
            }[process.platform],
          };
    },
  },
];

// ── 执行 ────────────────────────────────────────────

/**
 * 计算目标平台集合需要的检查项。
 * @param {string[]} targets - 平台名（win/win-arm64/mac/mac-arm64/mac-universal/linux/linux-arm64/android/ios/web/desktop）
 * @returns {Array<object>} 检查项
 */
function checksFor(targets) {
  return CHECKS.filter((c) => {
    if (c.needs === 'all') return true;
    const matched = targets.some((t) => c.needs.includes(t));
    if (!matched) return false;
    if (c.hostCheck && !targets.some((t) => c.needs.includes(t) && c.hostCheck(t))) return false;
    return true;
  });
}

/**
 * 执行检查，返回结果数组。
 * @param {Array<object>} checks
 * @returns {Array<{ id: string, ok: boolean, detail: string, hint?: string }>}
 */
function runChecks(checks) {
  return checks.map((c) => ({ id: c.id, ...c.detect() }));
}

/**
 * 打印检查报告（引导面板）。
 * @param {Array<{ id: string, ok: boolean, detail: string, hint?: string }>} results
 * @param {{ onlyFailures?: boolean }} [opts]
 */
function printReport(results, opts = {}) {
  const rows = opts.onlyFailures ? results.filter((r) => !r.ok) : results;
  if (rows.length === 0) return;
  const idW = Math.max(...rows.map((r) => r.id.length));
  console.log();
  for (const r of rows) {
    const mark = r.ok ? style.green('✓') : style.red('✗');
    const id = style.bold(r.id.padEnd(idW));
    console.log(`  ${mark} ${id}  ${r.detail}`);
    if (r.hint) console.log(`    ${' '.repeat(idW)}  ${style.cyan('修复：' + r.hint)}`);
  }
  console.log();
}

/**
 * 构建前预检：任一失败打印引导面板并返回 false。
 * @param {string[]} targets - 目标平台名
 * @returns {boolean}
 */
function preflight(targets) {
  const results = runChecks(checksFor(targets));
  const failures = results.filter((r) => !r.ok);
  if (failures.length === 0) return true;
  console.log(style.red.bold('✗ 环境检查未通过'));
  printReport(results, { onlyFailures: true });
  return false;
}

/**
 * htb doctor：全量检查报告。
 */
function doctor() {
  const allTargets = ['win', 'win-arm64', 'win-portable', 'win-arm64-portable', 'mac', 'mac-arm64', 'mac-universal', 'linux', 'linux-arm64', 'android', 'ios', 'desktop'];
  const results = runChecks(checksFor(allTargets));
  console.log(style.bold('htb doctor — 环境检查报告'));
  printReport(results);
  const failures = results.filter((r) => !r.ok);
  console.log(failures.length === 0
    ? style.green('全部通过。')
    : style.yellow(`${failures.length} 项未通过（仅影响对应平台的构建）。`));
  return failures.length === 0;
}

module.exports = { preflight, doctor, checksFor, runChecks, printReport, CHECKS };
