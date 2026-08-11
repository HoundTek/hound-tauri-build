// TUI 应用入口 — 连接后端 TCP，驱动前端渲染

import net from 'net';
import { makePage, running, toggleFinished, setScrollCallback, isFooterEditing, exitPanel,
         initFromTasks, onTaskStatus, onLogEntry, onBuildExit } from './demos/index.mjs';
import { initEvents, on, destroyEvents } from './utils/events.mjs';
import { advanceTick } from './utils/tick.mjs';
import { logSel } from './utils/focus.mjs';
import { getTerminalSize } from './utils/terminal-size.mjs';

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
  const page = makePage();
  bufs[back] = HOME + page.join('\n') + CLEAR_EOS;
  back = 1 - back;
  process.stdout.write(bufs[1 - back]);
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
  process.stdout.write(ALT_OFF + WRAP_ON + SHOW);
  process.exit(0);
}

// ── TCP 连接后端 ──

let tcpBuf = '';
const sock = net.createConnection({ port, host: '127.0.0.1' });
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
        redraw();
        updateTimer = setInterval(redraw, 500);
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
      setTimeout(cleanupAndExit, 1500);
      break;
  }
}
