/**
 * @file 构建入口
 * @description 命令映射 → 声明式任务依赖解析 → TUI/回退执行。
 * @module scripts/build
 */

const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');
const { loadTaskRegistry, resolveTaskGraph, executeTasks, ROOT_DIR } = require('./task-runner.cjs');
const { loadConfig, getConfig } = require('./config.cjs');
const { tauriCmd } = require('./tauri-cli.cjs');
const { run } = require('./sys/run.cjs');
const { buildEnv } = require('./cross-build.cjs');
const { preflight, doctor } = require('./preflight.cjs');

const TUI_PATH = path.join(__dirname, '..', 'tui-app', 'index.mjs');

// ============================================================
//  命令 → 目标任务 ID 映射
// ============================================================

// ============================================================
// 平台 → 任务映射（全部来自统一配置 config/htb.default.json，可被项目 htb.config.json 覆盖）
// ============================================================
const config = loadConfig();
const ALL_PLATFORMS = config.commands.platforms;
const ICON_PLATFORMS = config.commands.iconPlatforms;

/**
 * 给定命令和平台，返回需要解析执行的目标任务 ID 列表
 */
const COMMAND_TASKS = {
  build: config.commands.build,
  'build-quick': config.commands.buildQuick,
  ship: config.commands.ship,
};

/** dev 命令在依赖任务完成后还需要 spawn tauri dev */
const DEV_SETUP_TASKS = config.commands.devSetup;

/** dev 命令的长运行进程 */
const DEV_CMD = config.commands.devCmd;

// ============================================================
//  TUI (TCP → Ink process)
// ============================================================

let tuiSock = null;
let tuiChild = null;
let NO_TUI = false;   // --no-tui 参数强制禁用 TUI
let END_TUI = false;  // --end-tui 构建结束后自动退出 TUI
let RETRY = null;     // --retry <n> 全局重试次数覆盖
const SET_OVERRIDES = {}; // --set <path>=<value> 命令行配置覆盖（可多次）
let SKIP = new Set(); // --skip <id...> 要跳过的任务 ID 集合

/** @returns {boolean} */
function isTuiAlive() {
  return tuiSock && !tuiSock.destroyed && tuiChild && !tuiChild.killed;
}

/**
 * 启动 TUI 子进程，失败时重试最多 3 次
 * @returns {Promise<void>}
 */
function startTui() {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let retries = 0;
    const MAX_RETRIES = config.build.tuiStartRetries;
    const RETRY_DELAY = config.build.tuiStartRetryDelayMs;

    function tryStart() {
      if (resolved) return;

      const server = net.createServer((sock) => {
        if (resolved) return;
        resolved = true;
        tuiSock = sock;
        sock.setNoDelay(true);
        sock.on('error', () => {});
        resolve();
      });

      server.on('error', (err) => {
        server.close();
        if (resolved) return;
        if (++retries < MAX_RETRIES) {
          setTimeout(tryStart, config.build.tuiStartRetryDelayMs);
          return;
        }
        resolved = true;
        reject(err);
      });

      server.listen(0, config.tui.host, () => {
        if (resolved) return;
        const port = server.address().port;
        tuiChild = spawn(process.execPath, [TUI_PATH, String(port)], {
          cwd: ROOT_DIR,
          stdio: ['inherit', 'inherit', 'inherit'],
        });

        tuiChild.on('error', (err) => {
          if (resolved) return;
          server.close();
          if (++retries < MAX_RETRIES) { scheduleRetry(); return; }
          resolved = true;
          reject(err);
        });

        tuiChild.on('exit', (code) => {
          tuiSock = null;
          if (resolved) return;
          server.close();
          if (++retries < MAX_RETRIES) {
            setTimeout(tryStart, config.build.tuiStartRetryDelayMs);
            return;
          }
          resolved = true;
          reject(new Error('TUI exited with code ' + code));
        });
      });
    }

    tryStart();

    setTimeout(() => {
      if (resolved) return;
      if (++retries < MAX_RETRIES) {
        tryStart();
        return;
      }
      resolved = true;
      reject(new Error('TUI connection timeout'));
    }, config.build.tuiConnectTimeoutMs);
  });
}

/** @param {object} msg */
function sendTui(msg) {
  if (!tuiSock || tuiSock.destroyed) return;
  try { tuiSock.write(JSON.stringify(msg) + '\n'); } catch (_) {}
}

/** @returns {Promise<void>} */
async function waitTuiExit() {
  if (tuiChild) {
    return new Promise((resolve) => { tuiChild.on('exit', resolve); });
  }
}

// ============================================================
//  TUI 回调适配器
// ============================================================

/**
 * 创建适配 task-runner 回调接口的 TUI 适配器
 * @returns {{ onInit, onStatus, onLog, onExit }}
 */
function createTuiAdapter() {
  return {
    onInit(tasks) {
      sendTui({ type: 'init', tasks });
    },
    onStatus(id, status, elapsed) {
      sendTui({ type: 'status', id, status, elapsed });
    },
    onLog(text, taskId) {
      sendTui({ type: 'log', text, taskId });
    },
    onExit(ok) {
      sendTui({ type: 'exit', ok });
    },
  };
}

// ============================================================
//  结果收集器 — 汇总任务状态和日志，供最终文本输出
// ============================================================

/**
 * 创建收集回调，同时转发到目标回调（如有）
 * @param {RunCallbacks} [target] - 转发目标（TUI 适配器），为 null 即仅收集
 * @returns {{ cb: RunCallbacks, getSummary: () => object }}
 */
function createCollector(target) {
  let tasks = [];
  let statuses = {};
  let allLogs = [];
  let exitOk = false;

  return {
    cb: {
      onInit(tasks_) {
        tasks = tasks_;
        for (const t of tasks_) statuses[t.id] = { status: 'pending', elapsed: null };
        if (target) target.onInit(tasks_);
      },
      onStatus(id, status, elapsed) {
        statuses[id] = { status, elapsed: elapsed || null };
        if (target) target.onStatus(id, status, elapsed);
      },
      onLog(text, taskId) {
        allLogs.push({ text, taskId });
        if (target) target.onLog(text, taskId);
      },
      onExit(ok) {
        exitOk = ok;
        if (target) target.onExit(ok);
      },
    },
    getSummary() {
      return { tasks, statuses, allLogs, exitOk };
    },
  };
}

/**
 * 打印构建结果摘要
 * @param {{ tasks, statuses, allLogs, exitOk }} summary
 */
function printSummary(summary) {
  const { tasks, statuses, exitOk } = summary;
  if (!tasks.length) return;

  const counts = { done: 0, failed: 0, skipped: 0 };
  for (const t of tasks) {
    const s = statuses[t.id]?.status;
    if (counts[s] !== undefined) counts[s]++;
  }

  console.log();
  console.log('─'.repeat(config.build.summaryWidth));

  // 总体结果
  const ok = exitOk && counts.failed === 0;
  console.log(ok ? '  Result  PASS' : '  Result  FAIL');

  // 汇总统计
  const parts = [];
  if (counts.done) parts.push(`${counts.done} passed`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.skipped) parts.push(`${counts.skipped} skipped`);
  console.log(`  Tasks   ${tasks.length} total, ${parts.join(', ')}`);

  // 每个任务状态
  const STATUS_ICONS = {
    done: '\x1b[32m✓\x1b[0m', failed: '\x1b[31m✗\x1b[0m',
    skipped: '\x1b[33m○\x1b[0m', running: '…', pending: '…',
  };
  console.log('─'.repeat(config.build.summaryWidth));
  for (const t of tasks) {
    const s = statuses[t.id];
    const icon = STATUS_ICONS[s?.status] || ' ';
    const elapsed = s?.elapsed != null ? ` (${s.elapsed}ms)` : '';
    console.log(`  ${icon}  ${t.description || t.id}${elapsed}`);
  }

  console.log('─'.repeat(config.build.summaryWidth));
  console.log();
}

// ============================================================
//  编排：TUI → 回退
// ============================================================

/** 内联执行 + 打印摘要（TUI 不可用时的回退路径） */
async function runInline(targetIds, retry) {
  const collector = createCollector(null);
  const ok = await executeResolved(targetIds, 'inline', collector.cb, undefined, retry);
  printSummary(collector.getSummary());
  return ok;
}

/**
 * 尝试用 TUI 执行目标任务，失败则回退内联
 * @param {string[]} targetIds
 * @param {{ retry?: number, endTui?: boolean }} [opts] - retry: 全局重试次数；endTui: 构建后自动退出 TUI
 * @returns {Promise<boolean>}
 */
async function runWithTuiOrFallback(targetIds, opts = {}) {
  const retry = opts.retry != null ? opts.retry : RETRY;
  const endTui = opts.endTui != null ? opts.endTui : END_TUI;

  // 禁用 TUI 或非 TTY 环境 → 直接内联
  if (NO_TUI) return runInline(targetIds, retry);
  if (!process.stdout.isTTY) {
    process.stderr.write('[info] 非 TTY 环境，回退内联模式\n');
    return runInline(targetIds, retry);
  }

  // 尝试启动 TUI，失败则回退
  try { await startTui(); } catch (_) { return runInline(targetIds, retry); }
  if (!isTuiAlive()) return runInline(targetIds, retry);

  const abort = { signaled: false };

  const tuiAdapter = createTuiAdapter();
  const collector = createCollector(tuiAdapter);

  // 监听 TUI 退出 → 设置中止信号。
  // 仅用户主动退出（exit 0）时中止构建；TUI 崩溃（非 0，如渲染异常）不中止，
  // 让任务继续完成，避免误杀正常构建。
  tuiChild.on('exit', (code) => {
    if (code === 0) abort.signaled = true;
  });
  tuiSock.on('error', () => {});

  const ok = await executeResolved(targetIds, 'tui', collector.cb, abort, retry);
  // --end-tui：构建已结束，让 TUI 短暂展示结果后自动退出
  if (endTui && isTuiAlive()) sendTui({ type: 'auto-exit' });
  if (isTuiAlive()) await waitTuiExit();
  // 等待 TUI 的 stdout 缓冲区完全刷新，避免 printSummary 输出交叠
  await new Promise((r) => setTimeout(r, config.build.tuiExitFlushMs));
  printSummary(collector.getSummary());
  return ok;
}

/**
 * 解析 + 执行（公共流程）
 * @param {string[]} targetIds
 * @param {'tui'|'inline'} mode
 * @param {RunCallbacks} cb
 * @param {{ signaled: boolean }} [abort]
 * @param {number} [retry] - 全局重试次数覆盖
 * @returns {Promise<boolean>}
 */
async function executeResolved(targetIds, mode, cb, abort, retry) {
  const registry = loadTaskRegistry();
  const { ordered, errors } = resolveTaskGraph(targetIds, registry);

  if (errors.length > 0) {
    console.error('Errors:', errors.join(', '));
    return false;
  }

  // --skip：警告跳过了不存在的任务 ID
  if (SKIP.size > 0) {
    const planned = new Set(ordered.map((t) => t.id));
    for (const id of SKIP) {
      if (!planned.has(id)) {
        console.warn(`[warn] --skip: task "${id}" is not part of this build, ignored`);
      }
    }
  }

  return executeTasks(ordered, mode, cb, abort, retry, SKIP);
}

// ============================================================
//  Help
// ============================================================

function showHelp() {
  console.log('Commands:');
  console.log('  init                      - Generate htb.config.json with project settings');
  console.log('  doctor                    - Check build environment (deps, tools, SDKs)');
  console.log('  dev [platform]            - Start development server');
  console.log('  build [platform|task...]  - Build for platforms or orchestrate task IDs');
  console.log('  build-quick [platform...] - Build only (skip deps/icons)');
  console.log('  ship [platform|task...]   - Run tests + build for platform');
  console.log('  icon [platform|all|task...] - Generate icons');
  console.log();
  console.log('  build/ship auto-collect artifacts to artifacts.output (default release/<platform>/).');
  console.log('  collect:<platform> tasks can be run explicitly: htb build collect:win');
  console.log();
  console.log('Options:');
  console.log('  --no-tui                  - Disable TUI mode, use inline output');
  console.log('  --end-tui                 - Auto-exit TUI when build finishes');
  console.log(`  --retry <n>               - Override retry count for failed tasks (default ${config.build.retry})`);
  console.log('  --skip <id[,id...]>       - Skip specified tasks (dependents still run)');
  console.log('  --set <path>=<value>      - Override build config (repeatable), e.g. --set ios.target=sim');
  console.log();
  console.log('Build config:');
  console.log('  Defaults:  config/htb.default.json (htb repo, built-in)');
  console.log('  Project:   htb.config.json in project root (overrides defaults)');
  console.log('  CLI:       --set <path>=<value> overrides both (highest)');
  console.log('  Config domains:');
  console.log('    {');
  console.log('      "build":   { "retry", "concurrency", "retryBaseDelay", "retryMaxDelay", ... }');
  console.log('      "tui":     { "refreshMs", "logLimit", "minCols", "minRows", ... }');
  console.log('      "icons":   { "platforms": { desktop|mac|win|linux|android|ios }, "tempDir" }');
  console.log('      "ios":     { "target": "device|sim", "sign": true|false }');
  console.log('      "artifacts":{ "output": "dist", "platforms": { "<plat>": { "dir", "patterns" } } }');
  console.log('      "commands":{ "build", "buildQuick", "ship", "devSetup", "devCmd", "platforms" }');
  console.log('      "tasks":   { "<taskId>": { "cmd", "retry", "dependsOn" } }  // override task defs');
  console.log('    }');
  console.log('  Examples:');
  console.log('    htb build ios --set ios.target=sim        # simulator build');
  console.log('    htb build win --set tasks.build:win.cmd="tauri build"');
  console.log('    htb icon ios --set icons.platforms.ios.output=custom/path');
  console.log();
  console.log('Platforms:');
  console.log('  desktop, win, win-arm64, win-portable, win-arm64-portable, mac, mac-arm64, mac-universal, linux, linux-arm64, android, ios, web');
  console.log();
  console.log('Examples:');
  console.log('  htb build win linux');
  console.log('  htb build:win linux:init test');
  console.log('  htb build linux --retry 1 --end-tui');
  console.log('  htb build:win --skip icon:win');
}

// ============================================================
//  Main
// ============================================================

// ============================================================
//  参数解析
// ============================================================

/**
 * 从 args 中提取 flag 值，支持 `--flag value` 和 `--flag=value` 两种形式
 * @param {string[]} args - 参数数组
 * @param {number} i - 当前索引
 * @param {string} flag - flag 名称（如 '--retry'）
 * @returns {{ value: string, nextIdx: number } | null}
 */
function flagValue(args, i, flag) {
  const a = args[i];
  if (a.startsWith(flag + '=')) return { value: a.slice(flag.length + 1), nextIdx: i };
  if (a === flag) {
    const v = args[i + 1];
    if (!v) { console.error(`Invalid ${flag}: missing value`); process.exit(1); }
    return { value: v, nextIdx: i + 1 };
  }
  return null;
}

/**
 * 解析 CLI 参数：提取 flags，返回位置参数
 * @returns {string[]} 位置参数（不含 flags）
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--no-tui') { NO_TUI = true; continue; }
    if (a === '--end-tui') { END_TUI = true; continue; }

    // --set <path>=<value>
    const setMatch = flagValue(args, i, '--set');
    if (setMatch) {
      const eq = setMatch.value.indexOf('=');
      if (eq <= 0) { console.error(`Invalid --set "${setMatch.value}": expected <path>=<value>`); process.exit(1); }
      SET_OVERRIDES[setMatch.value.slice(0, eq)] = setMatch.value.slice(eq + 1);
      i = setMatch.nextIdx;
      continue;
    }

    // --retry <n>
    const retryMatch = flagValue(args, i, '--retry');
    if (retryMatch) {
      const v = Number(retryMatch.value);
      if (!Number.isInteger(v) || v < 0) { console.error('Invalid --retry: must be a non-negative integer'); process.exit(1); }
      RETRY = v;
      i = retryMatch.nextIdx;
      continue;
    }

    // --skip <id,id,...>
    const skipMatch = flagValue(args, i, '--skip');
    if (skipMatch) {
      for (const id of skipMatch.value.split(',')) { const t = id.trim(); if (t) SKIP.add(t); }
      i = skipMatch.nextIdx;
      continue;
    }

    positional.push(a);
  }

  return positional;
}

/**
 * 将位置参数展开为目标任务 ID 列表。
 * 平台名 → 命令映射的任务；其余 → 视为任务 ID。
 * @param {string} command - build / build-quick / ship
 * @param {string[]} args - 位置参数
 * @returns {string[]} 目标任务 ID（去重）
 */
function expandTargets(command, args) {
  const targets = [];
  for (const arg of args) {
    const mapping = COMMAND_TASKS[command][arg];
    if (mapping) targets.push(...mapping);
    else targets.push(arg); // 任务 ID（含依赖解析，未知任务由 resolveTaskGraph 报错）
  }
  return [...new Set(targets)];
}

/**
 * 从位置参数中提取目标平台集合（聚合名展开）。
 * 任务 ID（含 ':' 或已注册任务）不产生平台检查。
 * @param {string[]} args - 位置参数
 * @returns {string[]} 平台名（去重，desktop 按本机处理）
 */
function platformsOf(args) {
  const out = new Set();
  for (const a of args) {
    if (a === 'desktop-platforms' || a === 'all') {
      out.add('win'); out.add('win-arm64'); out.add('mac'); out.add('mac-arm64'); out.add('mac-universal'); out.add('linux'); out.add('linux-arm64');
      if (a === 'all') { out.add('android'); out.add('ios'); }
    } else if (a === 'mobile') {
      out.add('android'); out.add('ios');
    } else if (ALL_PLATFORMS.includes(a)) {
      out.add(a);
    }
  }
  return [...out];
}

// ============================================================
//  Main
// ============================================================

// ============================================================
//  递归构建防护
// ============================================================

/**
 * 判断命令是否（经 package.json scripts 递归解析后）会调回 htb。
 * @param {string} command
 * @param {Object<string, string>} scripts - package.json 的 scripts
 * @param {Set<string>} [seen] - 防脚本循环引用
 * @returns {string[]|null} 递归脚本链（如 ['build']），不会递归返回 null
 */
function htbCallChain(command, scripts, seen = new Set()) {
  if (!command) return null;
  for (const segment of String(command).split(/&&|\|\||;/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const exe = tokens[0].split(/[/\\]/).pop().replace(/\.(js|cmd|bat|exe)$/i, '');
    if (exe === 'htb' || exe === 'hound-tauri-build') return [];
    // 包管理器调用脚本：yarn <s> / yarn run <s> / npm run <s> / pnpm [run] <s>
    let scriptName = null;
    if (exe === 'yarn' || exe === 'pnpm') {
      scriptName = tokens[1] === 'run' ? tokens[2] : tokens[1];
    } else if (exe === 'npm' && tokens[1] === 'run') {
      scriptName = tokens[2];
    }
    if (!scriptName || seen.has(scriptName)) continue;
    const body = scripts[scriptName];
    if (body == null) continue;
    seen.add(scriptName);
    const sub = htbCallChain(body, scripts, seen);
    if (sub) return [scriptName, ...sub];
  }
  return null;
}

/**
 * 检查 tauri.conf.json 的 beforeBuildCommand/beforeDevCommand 是否会递归调回 htb。
 * 会递归时打印精确修复引导。
 * @returns {boolean} true = 无递归
 */
function checkHooksNotRecursive() {
  const tauriDir = getConfig().project.tauriDir || 'src-tauri';
  let conf;
  try {
    conf = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, tauriDir, 'tauri.conf.json'), 'utf8'));
  } catch { return true; }
  let scripts = {};
  try {
    scripts = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).scripts || {};
  } catch { /* 无 package.json 时仅匹配直接调用 */ }

  let bad = false;
  for (const field of ['beforeBuildCommand', 'beforeDevCommand']) {
    const hook = conf.build && conf.build[field];
    if (!hook) continue;
    const chain = htbCallChain(hook, scripts);
    if (!chain) continue;
    bad = true;
    console.error('[error] 检测到递归构建配置:');
    console.error(`  ${tauriDir}/tauri.conf.json 的 ${field} 为 "${hook}"`);
    let indent = '  ';
    for (const s of chain) {
      console.error(`${indent}→ package.json 脚本 "${s}" = "${scripts[s]}"`);
      indent += '  ';
    }
    console.error(`${indent}→ 再次调用 htb，形成无限递归（进程爆炸、.htb-frontend-dist 反复创建删除）`);
    console.error('修复（任选其一）:');
    console.error(`  1. 将 ${field} 改为纯前端命令，如 "node node_modules/vite/bin/vite.js build"（beforeDevCommand 用 "node node_modules/vite/bin/vite.js"）`);
    console.error('  2. 将链路中的 package.json 脚本改为不经过 htb 的命令');
  }
  return !bad;
}

// ============================================================
//  Main
// ============================================================

async function main() {
  // 递归防护兜底：htb 启动的构建环境携带 HTB_BUILD_ACTIVE，
  // 嵌套调用（tauri hook / 自定义任务再次触发 htb）直接拒绝，避免进程爆炸。
  if (process.env.HTB_BUILD_ACTIVE) {
    console.error('[htb] 拒绝执行：检测到在 htb 构建环境中递归调用 htb（HTB_BUILD_ACTIVE 已设置）。');
    console.error('  通常是 tauri.conf.json 的 beforeBuildCommand/beforeDevCommand 或某个自定义任务再次触发了 htb。');
    console.error('  请将 hook 改为不经过 htb 的命令（如 "node node_modules/vite/bin/vite.js build"）。');
    process.exit(1);
  }
  process.env.HTB_BUILD_ACTIVE = '1';

  const args = parseArgs();
  loadConfig(SET_OVERRIDES);
  const command = args[0];
  const rest = args.slice(1);

  if (!command || ['help', '--help', '-h'].includes(command)) {
    showHelp();
    return;
  }

  // ---- doctor ----
  if (command === 'doctor') {
    process.exit(doctor() ? 0 : 1);
    return;
  }

  // ---- init ----
  if (command === 'init') {
    const { runInit } = require('./init.cjs');
    const ok = runInit(rest);
    process.exit(ok ? 0 : 1);
    return;
  }

  // ---- 任务 ID 编排模式：命令本身也是任务 ID（含 ':'）----
  // 例：htb build:win linux:init test
  if (command.includes(':')) {
    const targetIds = [...new Set([command, ...rest])];
    const ok = await runWithTuiOrFallback(targetIds);
    process.exit(ok ? 0 : 1);
    return;
  }

  // ---- icon ----
  if (command === 'icon') {
    const platforms = rest.length > 0 ? rest : ['desktop'];
    const targetIds = [];
    for (const p of platforms) {
      if (p === 'all') targetIds.push(...ICON_PLATFORMS.map((x) => `icon:${x}`));
      else if (ICON_PLATFORMS.includes(p)) targetIds.push(`icon:${p}`);
      else targetIds.push(p); // 直接任务 ID
    }
    const ok = await runWithTuiOrFallback([...new Set(targetIds)]);
    process.exit(ok ? 0 : 1);
    return;
  }

  // ---- dev ----
  if (command === 'dev') {
    const platform = rest[0] || 'desktop';
    const setupTasks = DEV_SETUP_TASKS[platform];
    if (!setupTasks) {
      console.error('Unknown platform:', platform);
      console.error('Available:', Object.keys(DEV_SETUP_TASKS).join(', '));
      process.exit(1);
    }
    // 递归 hook 检查：失败给出引导后中止
    if (!checkHooksNotRecursive()) process.exit(1);
    // 环境预检：失败给出引导后中止
    if (!preflight(platformsOf([platform]))) process.exit(1);
    // dev 是长运行命令：setup 完成后必须自动退出 TUI，让 tauri dev 接管终端
    const ok = await runWithTuiOrFallback(setupTasks, { endTui: true });
    if (!ok) { process.exit(1); return; }

    // 依赖任务完成后，spawn 长期运行的 tauri dev。
    // devCmd 配置语义：tauri 子命令参数（如 "dev" / "android dev"），
    // 经 lib/tauri-cli.cjs 解析后直接调用 CLI 入口，不经 shell/包管理器。
    const devArgs = String(DEV_CMD[platform]).trim().split(/\s+/).filter(Boolean);
    const { cmd: devCmd, args: devFullArgs } = tauriCmd(devArgs);
    const devResult = await run(devCmd, devFullArgs, { cwd: ROOT_DIR, inherit: true, env: buildEnv() });
    process.exit(devResult.ok ? 0 : (devResult.code == null ? 1 : devResult.code));
    return;
  }

  // ---- build / build-quick / ship ----
  if (command === 'build' || command === 'build-quick' || command === 'ship') {
    const raw = rest.length > 0 ? rest : ['desktop'];

    // 校验：至少一个参数是有效平台或已注册任务，否则给出友好提示
    const registry = loadTaskRegistry();
    const invalid = raw.filter((a) => !COMMAND_TASKS[command][a] && !registry.has(a));
    if (invalid.length === raw.length) {
      console.error('Unknown platform or task:', raw.join(', '));
      console.error('Platforms:', Object.keys(COMMAND_TASKS[command]).join(', '));
      process.exit(1);
    }

    // 递归 hook 检查：失败给出引导后中止
    if (!checkHooksNotRecursive()) process.exit(1);
    // 环境预检：按目标平台检查依赖，失败给出引导后中止
    if (!preflight(platformsOf(raw))) process.exit(1);

    const ok = await runWithTuiOrFallback(expandTargets(command, raw));
    process.exit(ok ? 0 : 1);
    return;
  }

  console.error('Unknown command:', command);
  showHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
