// TUI 应用入口 — 连接后端 TCP，驱动前端渲染

import net from 'net';
import configModule from '../config.cjs';
import { makePage, running, toggleFinished, setScrollCallback, isFooterEditing, exitPanel,
         initFromTasks, onTaskStatus, onLogEntry, onBuildExit } from './demos/index.mjs';
import { initEvents, on, destroyEvents } from './utils/events.mjs';
import { advanceTick } from './utils/tick.mjs';
import { logSel, vimMode } from './utils/focus.mjs';
import { getTerminalSize, initTerminalSize, updateTerminalSize } from './utils/terminal-size.mjs';

const tuiConfig = configModule.getConfig().tui;

const ALT_ON   = '\x1b[?1049h';
const ALT_OFF  = '\x1b[?1049l';
const HOME     = '\x1b[H';
const CLEAR_EOS = '\x1b[J';
const HIDE     = '\x1b[?25l';
const SHOW     = '\x1b[?25h';
const WRAP_OFF = '\x1b[?7l';
const WRAP_ON  = '\x1b[?7h';

const port = parseInt(process.argv[2], 10);
if (!port || isNaN(port)) {
  console.error('Usage: node index.mjs <port>');
  process.exit(1);
}

// 双缓冲
let back = 0;
const bufs = ['', ''];

function buildFrame() {
  advanceTick();
  try {
    const page = makePage();
    bufs[back] = HOME + page.join('\n') + CLEAR_EOS;
    back = 1 - back;
    process.stdout.write(bufs[1 - back]);
  } catch (_) {
    // 渲染异常不杀死 TUI：跳过本帧，等待下帧重试
  }
}

function redraw() {
  buildFrame();
}

// 防抖
let _pending = false;
function requestRedraw() {
  if (!_pending) {
    _pending = true;
    Promise.resolve().then(() => { _pending = false; redraw(); });
  }
}

// ── 退出面板键盘/点击处理 ──

function bindExitPanel() {
  on('key', (k) => {
    const isExitKey = k.name === 'escape' || (k.ctrl && k.name === 'c' && !logSel.active);
    if (isExitKey) {
      if (isFooterEditing()) return;
      if (logSel.active) {
        logSel.active = false;
        logSel.startLine = -1;
        logSel.endLine = -1;
        vimMode.visual = false;
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

function cleanupAndExit() {
  clearInterval(updateTimer);
  destroyEvents();
  restoreTerminal();
  process.exit(0);
}

/** 完整恢复终端状态（正常退出与崩溃兜底共用） */
function restoreTerminal() {
  try {
    process.stdout.write(ALT_OFF + WRAP_ON + SHOW + '\x1b[?1002l\x1b[?1003l\x1b[?1006l');
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

function handleMessage(msg) {
  switch (msg.type) {
    case 'init':
      initFromTasks(msg.tasks || []);
      if (!started) {
        started = true;
        process.stdout.write(ALT_ON + WRAP_OFF + HIDE);
        initEvents();
        bindExitPanel();
        setScrollCallback(requestRedraw);
        on('resize', redraw);
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


