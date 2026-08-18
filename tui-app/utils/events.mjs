// 事件系统：统一捕获 keyboard + mouse 事件并分发
// 架构：双路径输入（data + readable），手动解析，无 readline 依赖

import { updateTerminalSize } from './terminal-size.mjs';
import configModule from '../../config.cjs';

const tuiConfig = configModule.getConfig().tui;

const handlers = { key: [], mouse: [], click: [], scroll: [], resize: [] };
let stdin = null;
let dataHandler = null;
let resizeRegistered = false;

// ── 诊断计数器 ────────────────────────────────────────
export const diag = {
  dataFired: 0, readableFired: 0, key: 0, click: 0, scroll: 0, mouse: 0,
};

// ── emit ──────────────────────────────────────────────

function emit(type, data) {
  if (diag[type] !== undefined) diag[type]++;
  for (const h of handlers[type] || []) h(data);
}

export function on(type, fn) {
  if (handlers[type]) handlers[type].push(fn);
}

export function off(type, fn) {
  if (handlers[type]) {
    handlers[type] = handlers[type].filter((h) => h !== fn);
  }
}

// ── 键盘序列解析 ──────────────────────────────────────

// ESC [ 终止符 → key name
const CSI_MAP = {
  'A': 'up', 'B': 'down', 'C': 'right', 'D': 'left',
  'H': 'home', 'F': 'end',
  '2~': 'insert', '3~': 'delete', '5~': 'pageup', '6~': 'pagedown',
};
// ESC O 终止符
const SS3_MAP = {
  'H': 'home', 'F': 'end',
  'P': 'f1', 'Q': 'f2', 'R': 'f3', 'S': 'f4',
};

/**
 * 从 buf 开头尝试解析一个键盘按键。
 * 返回 { key, consumed } — key 为 null 表示需要更多数据。
 */
function tryParseKey(buf) {
  if (buf.length === 0) return { key: null, consumed: 0 };

  const b0 = buf.charCodeAt(0);

  // ── ESC 序列 ──（必须在 b0 < 0x20 之前，因为 0x1b=27<32）
  if (b0 === 0x1b) {
    // 单独的 ESC — 作为 Escape 键处理
    if (buf.length === 1) return { key: { name: 'escape', sequence: '\x1b' }, consumed: 1 };

    const b1 = buf[1];

    // ESC [ ... CSI 序列
    if (b1 === '[') {
      // 找到 CSI 终止字节 (0x40-0x7e)
      let end = 2;
      let found = false;
      while (end < buf.length) {
        const c = buf.charCodeAt(end);
        if (c >= 0x40 && c <= 0x7e) { found = true; end++; break; }
        end++;
      }
      if (!found) return { key: null, consumed: 0 }; // 序列不完整

      const seq = buf.slice(0, end);
      const inner = buf.slice(2, end);

      // 含修饰符: ESC [ 1 ; mod letter
      const modM = inner.match(/^1;(\d)([A-D])$/);
      if (modM) {
        const mod = parseInt(modM[1], 10);
        const name = CSI_MAP[modM[2]] || modM[2].toLowerCase();
        return { key: { name, ctrl: !!(mod & 4), shift: !!(mod & 1), meta: !!(mod & 8), sequence: seq }, consumed: end };
      }

      const name = CSI_MAP[inner];
      if (name) return { key: { name, sequence: seq }, consumed: end };

      // 无法识别 → 消费掉，不阻塞
      return { key: { name: 'unknown', sequence: seq }, consumed: end };
    }

    // ESC O ... SS3 序列
    if (b1 === 'O' || b1 === 'o') {
      if (buf.length < 3) return { key: null, consumed: 0 };
      const seq = buf.slice(0, 3);
      const name = SS3_MAP[buf[2]] || 'unknown';
      return { key: { name, sequence: seq }, consumed: 3 };
    }

    // Meta + key: ESC char — 无条件消费
    if (buf.length >= 2) {
      return { key: { name: buf[1], meta: true, sequence: buf.slice(0, 2) }, consumed: 2 };
    }

    return { key: null, consumed: 0 };
  }

  // ── 单字节控制字符 ──
  if (b0 === 0x20) return { key: { name: 'space', sequence: ' ' }, consumed: 1 };
  if (b0 === 0x0d) return { key: { name: 'return', sequence: '\r' }, consumed: 1 };
  if (b0 === 0x0a) return { key: { name: 'return', sequence: '\n' }, consumed: 1 };
  if (b0 === 0x09) return { key: { name: 'tab', sequence: '\t' }, consumed: 1 };
  if (b0 === 0x7f) return { key: { name: 'backspace', sequence: '\x7f' }, consumed: 1 };
  if (b0 === 0x08) return { key: { name: 'backspace', sequence: '\x08' }, consumed: 1 };
  if (b0 < 0x20) {
    const letter = b0 === 0 ? '@' : String.fromCharCode(b0 + 0x60);
    return { key: { name: letter, ctrl: true, sequence: buf[0] }, consumed: 1 };
  }

  // ── 普通可打印字符（含多字节 UTF-8） ──
  let len = 1;
  if ((b0 & 0xe0) === 0xc0) len = 2;
  else if ((b0 & 0xf0) === 0xe0) len = 3;
  else if ((b0 & 0xf8) === 0xf0) len = 4;

  if (buf.length < len) return { key: null, consumed: 0 };

  const seq = buf.slice(0, len);
  return { key: { name: seq, sequence: seq }, consumed: len };
}

// ── 鼠标序列解析 ──────────────────────────────────────

function tryParseMouse(buf) {
  // SGR: \x1b[<btn;x;yM/m
  const sgr = buf.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
  if (sgr) {
    const btn = parseInt(sgr[1], 10);
    const x = parseInt(sgr[2], 10) - 1;
    const y = parseInt(sgr[3], 10) - 1;
    const action = sgr[4];
    let type;
    if (btn === 64 || btn === 65) type = 'scroll';
    else if (action === 'M' && btn <= 2) type = 'press';
    else if (action === 'm' && btn <= 2) type = 'release';
    else return { parsed: null, consumed: sgr[0].length }; // 忽略其他（motion等）

    return { parsed: { type, btn, x, y }, consumed: sgr[0].length };
  }

  // X10: \x1b[M + 3 bytes
  if (buf.startsWith('\x1b[M')) {
    if (buf.length < 6) return { parsed: null, consumed: 0, incomplete: true };
    const rawBtn = buf.charCodeAt(3) - 32;
    const x = (buf.charCodeAt(4) || 0) - 33;
    const y = (buf.charCodeAt(5) || 0) - 33;
    let type;
    const btnField = rawBtn & 3;
    if (rawBtn & 0x40) type = 'scroll';
    else if (rawBtn & 0x20) type = 'motion';
    else if (btnField === 3) type = 'release';
    else type = 'press';
    return { parsed: { type, btn: rawBtn, x, y }, consumed: 6 };
  }

  // 不完整 SGR 前缀
  if (buf.startsWith('\x1b[<')) return { parsed: null, consumed: 0, incomplete: true };

  return { parsed: null, consumed: 0 };
}

function emitMouse(parsed) {
  if (parsed.type === 'press') {
    emit('click', { btn: parsed.btn, x: parsed.x, y: parsed.y });
    emit('mouse', { type: 'down', btn: parsed.btn, x: parsed.x, y: parsed.y });
  } else if (parsed.type === 'motion') {
    emit('mouse', { type: 'move', btn: parsed.btn, x: parsed.x, y: parsed.y });
  } else if (parsed.type === 'release') {
    emit('mouse', { type: 'up', btn: parsed.btn, x: parsed.x, y: parsed.y });
  } else if (parsed.type === 'scroll') {
    emit('scroll', { dir: parsed.btn === 64 ? 'up' : 'down', x: parsed.x, y: parsed.y });
  }
}

// ── 输入处理 ──────────────────────────────────────────

let inputBuf = '';

function processChunk(chunk) {
  inputBuf += chunk;

  let progress = true;
  while (progress && inputBuf.length > 0) {
    progress = false;

    // 1. 尝试鼠标序列
    const mr = tryParseMouse(inputBuf);
    if (mr.incomplete) break;
    if (mr.parsed) {
      emitMouse(mr.parsed);
      inputBuf = inputBuf.slice(mr.consumed);
      progress = true;
      continue;
    }
    if (mr.consumed > 0) {
      inputBuf = inputBuf.slice(mr.consumed);
      progress = true;
      continue;
    }

    // 2. 尝试键盘序列
    const kr = tryParseKey(inputBuf);
    if (kr.key) {
      emit('key', kr.key);
      inputBuf = inputBuf.slice(kr.consumed);
      progress = true;
      continue;
    }

    // 两个解析器都无法消费
    // ESC 开头说明是不完整序列 → 等待更多数据
    // 其他字符则跳过以避免死锁
    if (inputBuf[0] === '\x1b') break;
    inputBuf = inputBuf.slice(1);
    progress = true;
  }

  if (inputBuf.length > tuiConfig.inputBufferLimit) inputBuf = '';
}

// ── 初始化 / 销毁 ─────────────────────────────────────

export function initEvents(opts = {}) {
  stdin = opts.stdin || process.stdin;

  stdin.setRawMode?.(true);

  // mouse tracking：button-event 模式，支持拖拽
  process.stdout.write('\x1b[?1002h');

  // raw data 路径
  dataHandler = (buf) => {
    diag.dataFired++;
    processChunk(typeof buf === 'string' ? buf : buf.toString());
  };
  stdin.on('data', dataHandler);

  stdin.resume();

  // resize
  if (!resizeRegistered) {
    resizeRegistered = true;
    process.stdout.on('resize', () => {
      const { rows, columns } = process.stdout;
      if (Number.isInteger(rows) && rows > 0 && Number.isInteger(columns) && columns > 0) {
        updateTerminalSize(rows, columns);
      }
      emit('resize', { rows, columns });
    });
  }
}

export function destroyEvents() {
  try { process.stdout.write('\x1b[?1002l'); } catch (_) {}
  if (stdin) {
    try { stdin.setRawMode?.(false); } catch (_) {}
    if (dataHandler) stdin.removeListener('data', dataHandler);
  }
  dataHandler = null;
  stdin = null;
  inputBuf = '';
}
