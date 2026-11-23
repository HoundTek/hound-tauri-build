/**
 * @file TUI 应用入口
 * @description 连接后端 TCP 服务，接收构建事件并驱动终端渲染循环。
 * @module tui-app/index
 * @author hound-builder
 */

// TUI 应用入口 — 连接后端 TCP，驱动前端渲染

import net from 'net';
import configModule from '../lib/config.cjs';
import screenModule from '../lib/term/screen.cjs';
import { makePage, running, toggleFinished, setScrollCallback, isFooterEditing, exitPanel, helpPanel,
         initFromTasks, onTaskStatus, onLogEntry, onBuildExit } from './pages/index.mjs';
import { initEvents, on, destroyEvents } from './utils/events.mjs';
import { advanceTick } from './utils/tick.mjs';
import { logSel, vimMode, logSearch } from './utils/focus.mjs';
import { getTerminalSize, initTerminalSize } from './utils/terminal-size.mjs';

const { Screen } = screenModule;

const tuiConfig = configModule.getConfig().tui;

const WRAP_OFF = '\x1b[?7l';
const WRAP_ON  = '\x1b[?7h';

const port = parseInt(process.argv[2], 10);
if (!port || isNaN(port)) {
  console.error('Usage: node index.mjs <port>');
  process.exit(1);
}

// 差量渲染出口：双缓冲 + 逐帧 diff + ?2026 同步输出（终端支持时）
const screen = new Screen(process.stdout);

/**
 * 构建并输出一帧画面（写入后台缓冲后差量 flush）
 * @returns {void}
 */
function buildFrame() {
  advanceTick();
  try {
    const page = makePage();
    screen.frame((buf) => {
      for (let y = 0; y < page.length; y++) buf.write(0, y, page[y]);
    });
  } catch (_) {
    // 渲染异常不杀死 TUI：跳过本帧，等待下帧重试
  }
}

/**
 * 同步重绘一帧
 * @returns {void}
 */
function redraw() {
  buildFrame();
}

// 防抖
let _pending = false;
/**
 * 请求防抖重绘，在下一个微任务中合并多次请求为一次重绘
 * @returns {void}
 */
function requestRedraw() {
  if (!_pending) {
    _pending = true;
    Promise.resolve().then(() => { _pending = false; redraw(); });
  }
}

// ── 退出面板键盘/点击处理 ──

function bindExitPanel() {
  on('key', (k) => {
    // 已被下层处理器消费（如日志区复制）的按键不再触发退出逻辑
    if (k.consumed) return;

    // ? / F1：切换帮助页（exitPanel 展开 / footer 编辑 / 搜索输入时不响应）
    if ((k.name === '?' || k.name === 'f1') && !exitPanel.visible
        && !isFooterEditing() && !logSearch.active) {
      helpPanel.visible = !helpPanel.visible;
      requestRedraw();
      return;
    }

    const isExitKey = k.name === 'escape' || (k.ctrl && k.name === 'c' && !logSel.active);
    if (isExitKey) {
      if (isFooterEditing()) return;
      if (helpPanel.visible) {
        // 帮助页展开时 ESC 只关闭帮助页，不触发退出
        helpPanel.visible = false;
        requestRedraw();
        return;
      }
      if (logSel.active) {
        logSel.active = false;
        logSel.startLine = -1;
        logSel.endLine = -1;
        vimMode.mode = 'normal';
        requestRedraw();
        return;
      }
      if (exitPanel.visible) {
        exitPanel.visible = false;
        requestRedraw();
        return;
      }
      exitPanel.visible = true;
      exitPanel.selected = 'n';
      requestRedraw();
      return;
    }

    if (exitPanel.visible) {
      if (k.name === 'y' || k.name === 'Y') {
        cleanupAndExit();
        return;
      }
      if (k.name === 'n' || k.name === 'N') {
        exitPanel.visible = false;
        requestRedraw();
        return;
      }
      if (['left','right','up','down','tab'].includes(k.name)) {
        exitPanel.selected = exitPanel.selected === 'y' ? 'n' : 'y';
        requestRedraw(); return;
      }
      if (k.name === 'return' || k.name === 'enter') {
        if (exitPanel.selected === 'y') {
          cleanupAndExit();
        } else {
          exitPanel.visible = false;
          requestRedraw();
        }
        return;
      }
      return;
    }
  });

  on('click', (e) => {
    if (!exitPanel.visible) return;
    const { rows: H, columns: W } = getTerminalSize();
    const modalW = 28;
    const modalH = 4;
    const mx = Math.max(0, Math.floor((W - modalW) / 2));
    const my = Math.max(0, Math.floor((H - modalH) / 2));
    if (e.y === my + 2) {
      const yX = mx + 3;
      const nX = mx + 16;
      if (e.x >= yX && e.x < yX + 7) {
        cleanupAndExit();
      } else if (e.x >= nX && e.x < nX + 7) {
        exitPanel.visible = false;
        requestRedraw();
      }
    }
  });
}

/**
 * 清理资源并退出进程（定时器、事件监听、终端状态）
 * @returns {void}
 */
function cleanupAndExit() {
  clearInterval(updateTimer);
  destroyEvents();
  restoreTerminal();
  process.exit(0);
}

/**
 * 完整恢复终端状态（正常退出与崩溃兜底共用）
 * @returns {void}
 */
function restoreTerminal() {
  try {
    process.stdout.write(WRAP_ON + '\x1b[?1002l\x1b[?1003l\x1b[?1006l');
    screen.exit();
  } catch (_) {}
  try { process.stdin.setRawMode?.(false); } catch (_) {}
}

// ── TCP 连接后端 ──

let tcpBuf = '';
const sock = net.createConnection({ port, host: tuiConfig.host });
sock.setEncoding('utf8');
sock.setNoDelay(true);

sock.on('data', (chunk) => {
  tcpBuf += chunk;
  const lines = tcpBuf.split('\n');
  tcpBuf = lines.pop();
  for (const l of lines) {
    if (!l.trim()) continue;
    try {
      const msg = JSON.parse(l);
      handleMessage(msg);
    } catch (_) { /* skip malformed */ }
  }
});

sock.on('error', (err) => {
  // 后端断开，退出
  cleanupAndExit();
});

let started = false;
let updateTimer = null;

/**
 * 处理从后端 TCP 接收的 JSON 消息，分发到对应的状态更新函数
 * @param {{ type: string }} msg - 后端消息对象
 * @returns {void}
 */
function handleMessage(msg) {
  switch (msg.type) {
    case 'init':
      initFromTasks(msg.tasks || []);
      if (!started) {
        started = true;
        process.stdout.write(WRAP_OFF);
        screen.enter();
        initEvents();
        bindExitPanel();
        setScrollCallback(requestRedraw);
        on('resize', ({ rows, columns }) => {
          screen.resize(columns, rows);
          redraw();
        });
        initTerminalSize();
        redraw();
        updateTimer = setInterval(redraw, tuiConfig.refreshMs);
      }
      break;
    case 'status':
      onTaskStatus(msg.id, msg.status, msg.elapsed);
      requestRedraw();
      break;
    case 'log':
      onLogEntry(msg.text, msg.taskId);
      requestRedraw();
      break;
    case 'exit':
      onBuildExit(msg.ok);
      requestRedraw();
      break;
    case 'auto-exit':
      // --end-tui：构建已结束，短暂展示最终结果后自动退出
      setTimeout(cleanupAndExit, tuiConfig.exitDelayMs);
      break;
  }
}

// ── 崩溃兜底：任何未捕获异常/拒绝都必须恢复终端，避免残留 raw/mouse/alt-screen ──

/**
 * 崩溃兜底：清理定时器、事件和终端状态后以非零码退出
 * @param {Error|any} err - 未捕获的异常或拒绝原因
 * @returns {void}
 */
function crashCleanup(err) {
  clearInterval(updateTimer);
  try { destroyEvents(); } catch (_) {}
  restoreTerminal();
  try { console.error('\n[TUI] fatal error:', err && (err.stack || err.message || err)); } catch (_) {}
  process.exit(1);
}

process.on('uncaughtException', (err) => {
  // 渲染异常已在 buildFrame 内隔离；此处兜底剩余异常
  crashCleanup(err);
});
process.on('unhandledRejection', (reason) => {
  crashCleanup(reason);
});

// ── 父进程监控：主进程意外崩溃/退出时自动清理终端，避免孤儿进程残留 ──

const PARENT_PID = process.ppid;
setInterval(() => {
  try {
    process.kill(PARENT_PID, 0); // 仅探测进程是否存活
  } catch (_) {
    // 父进程已退出 → 清理终端并退出
    clearInterval(updateTimer);
    try { destroyEvents(); } catch (_) {}
    restoreTerminal();
    process.exit(0);
  }
}, tuiConfig.parentPollMs);


