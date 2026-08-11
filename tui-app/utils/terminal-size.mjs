// 终端尺寸检测
// Windows 上 process.stdout.rows/columns 经常为 undefined（尤其经 yarn/cmd 启动时），
// 需要多级回退：getWindowSize() → ANSI 查询序列 \x1b[18t → 默认值。
// 查询结果异步缓存，渲染读取缓存值。

let cached = null;   // { rows, columns } 缓存的有效尺寸
let querying = false; // 避免并发查询

/** 回退：process.stdout 自带尺寸（可能 undefined）→ 默认 24x80 */
function fallback() {
  const { rows = 24, columns = 80 } = process.stdout;
  return { rows, columns };
}

/** 显式写入已知尺寸（resize 事件时调用） */
export function updateTerminalSize(rows, columns) {
  if (Number.isInteger(rows) && rows > 0 && Number.isInteger(columns) && columns > 0) {
    cached = { rows, columns };
  }
}

/**
 * 获取终端尺寸（优先缓存，其次回退）。
 * @returns {{ rows: number, columns: number }}
 */
export function getTerminalSize() {
  if (cached) return cached;
  return fallback();
}

/**
 * 初始化尺寸检测：优先 getWindowSize()，否则发 ANSI 查询序列。
 * 应在 TUI 初始化时调用一次（异步更新缓存）。
 */
export function initTerminalSize() {
  // 1. 已缓存 / stdout 自带有效值
  const { rows: r, columns: c } = process.stdout;
  if (Number.isInteger(r) && r > 0 && Number.isInteger(c) && c > 0) {
    cached = { rows: r, columns: c };
    return;
  }

  // 2. getWindowSize()（Windows TTY 下更可靠）
  try {
    const s = process.stdout.getWindowSize();
    if (Array.isArray(s) && Number.isInteger(s[0]) && Number.isInteger(s[1]) && s[0] > 0 && s[1] > 0) {
      cached = { columns: s[0], rows: s[1] };
      return;
    }
  } catch (_) { /* ignore */ }

  // 3. ANSI 查询：\x1b[18t → 终端回复 \x1b[8;rows;colst
  if (!process.stdin || !process.stdout || querying) return;
  try {
    querying = true;
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/\x1b\[8;(\d+);(\d+)t/);
      if (m) {
        updateTerminalSize(parseInt(m[1], 10), parseInt(m[2], 10));
        querying = false;
        process.stdin.removeListener('data', onData);
      }
    };
    process.stdin.on('data', onData);
    process.stdout.write('\x1b[18t');
    // 兜底：1 秒内无响应则放弃
    setTimeout(() => {
      if (querying) {
        querying = false;
        process.stdin.removeListener('data', onData);
      }
    }, 1000);
  } catch (_) { querying = false; }
}
