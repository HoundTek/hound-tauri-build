/**
 * @file 构建入口
 * @description 命令映射 → 声明式任务依赖解析 → TUI/回退执行。
 * @module scripts/build
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const net = require('net');
const fs = require('fs');
const { runCmdInherit, loadTaskRegistry, resolveTaskGraph, executeTasks, ROOT_DIR } = require('./task-runner.cjs');
const { loadConfig, getConfig } = require('./config.cjs');

const TUI_PATH = path.join(__dirname, 'tui-app', 'index.mjs');

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
const CP = `node "${path.join(__dirname, 'gen-icons.cjs')}"`;
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
          if (++retries < MAX_RETRIES) {
            setTimeout(tryStart, config.build.tuiStartRetryDelayMs);
            return;
          }
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
  console.log('─'.repeat(config.build.summaryWidth));
  for (const t of tasks) {
    const s = statuses[t.id];
    const icon = { done: '\x1b[32m✓\x1b[0m', failed: '\x1b[31m✗\x1b[0m', skipped: '\x1b[33m○\x1b[0m', running: '…', pending: '…' }[s?.status] || ' ';
    const elapsed = s?.elapsed != null ? ` (${s.elapsed}ms)` : '';
    console.log(`  ${icon}  ${t.description || t.id}${elapsed}`);
  }

  console.log('─'.repeat(config.build.summaryWidth));
  console.log();
}

// ============================================================
//  编排：TUI → 回退
// ============================================================

/**
 * 尝试用 TUI 执行目标任务，失败则回退内联
 * @param {string[]} targetIds
 * @param {{ retry?: number, endTui?: boolean }} [opts] - retry: 全局重试次数；endTui: 构建后自动退出 TUI
 * @returns {Promise<boolean>}
 */
async function runWithTuiOrFallback(targetIds, opts = {}) {
  const retry = opts.retry != null ? opts.retry : RETRY;
  const endTui = opts.endTui != null ? opts.endTui : END_TUI;

  // 终端过小时不跳过 TUI，子进程内会渲染 SizeWarning 提示页 + resize 自动恢复
  if (!process.stdout.isTTY || NO_TUI) {
    if (NO_TUI) { /* 用户主动禁用，不提示 */ }
    else if (!process.stdout.isTTY) { process.stderr.write('[info] 非 TTY 环境，回退内联模式\n'); }
    const collector = createCollector(null);
    const ok = await executeResolved(targetIds, 'inline', collector.cb, undefined, retry);
    printSummary(collector.getSummary());
    return ok;
  }

  // 尝试启动 TUI
  try { await startTui(); } catch (_) {
    const collector = createCollector(null);
    const ok = await executeResolved(targetIds, 'inline', collector.cb, undefined, retry);
    printSummary(collector.getSummary());
    return ok;
  }

  if (!isTuiAlive()) {
    const collector = createCollector(null);
    const ok = await executeResolved(targetIds, 'inline', collector.cb, undefined, retry);
    printSummary(collector.getSummary());
    return ok;
  }

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
  console.log('  dev [platform]            - Start development server');
  console.log('  build [platform|task...]  - Build for platforms or orchestrate task IDs');
  console.log('  build-quick [platform...] - Build only (skip deps/icons)');
  console.log('  ship [platform|task...]   - Run tests + build for platform');
  console.log('  icon [platform|all|task...] - Generate icons');
  console.log();
  console.log('  build/ship auto-collect artifacts to artifacts.output (default dist/<platform>/).');
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
  console.log('  desktop, win, mac, mac-universal, linux, android, ios');
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
    if (a === '--set') {
      const v = args[++i];
      if (!v) {
        console.error('Invalid --set: missing <path>=<value>');
        process.exit(1);
      }
      const eq = v.indexOf('=');
      if (eq <= 0) {
        console.error(`Invalid --set value "${v}": expected <path>=<value>`);
        process.exit(1);
      }
      SET_OVERRIDES[v.slice(0, eq)] = v.slice(eq + 1);
      continue;
    }
    if (a.startsWith('--set=')) {
      const v = a.slice('--set='.length);
      const eq = v.indexOf('=');
      if (eq <= 0) {
        console.error(`Invalid --set value "${v}": expected <path>=<value>`);
        process.exit(1);
      }
      SET_OVERRIDES[v.slice(0, eq)] = v.slice(eq + 1);
      continue;
    }
    if (a === '--retry') {
      const v = Number(args[++i]);
      if (!Number.isInteger(v) || v < 0) {
        console.error('Invalid --retry value: must be a non-negative integer');
        process.exit(1);
      }
      RETRY = v;
      continue;
    }
    if (a.startsWith('--retry=')) {
      const v = Number(a.slice('--retry='.length));
      if (!Number.isInteger(v) || v < 0) {
        console.error('Invalid --retry value: must be a non-negative integer');
        process.exit(1);
      }
      RETRY = v;
      continue;
    }
    if (a === '--skip') {
      const v = args[++i];
      if (!v) {
        console.error('Invalid --skip: missing task ids');
        process.exit(1);
      }
      for (const id of v.split(',')) {
        const t = id.trim();
        if (t) SKIP.add(t);
      }
      continue;
    }
    if (a.startsWith('--skip=')) {
      for (const id of a.slice('--skip='.length).split(',')) {
        const t = id.trim();
        if (t) SKIP.add(t);
      }
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

// ============================================================
//  Main
// ============================================================

async function main() {
  const args = parseArgs();
  loadConfig(SET_OVERRIDES);
  const command = args[0];
  const rest = args.slice(1);

  if (!command || ['help', '--help', '-h'].includes(command)) {
    showHelp();
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
    // dev 是长运行命令：setup 完成后必须自动退出 TUI，让 tauri dev 接管终端
    const ok = await runWithTuiOrFallback(setupTasks, { endTui: true });
    if (!ok) { process.exit(1); return; }

    // 依赖任务完成后，spawn 长期运行的 tauri dev
    await runCmdInherit(DEV_CMD[platform]);
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
