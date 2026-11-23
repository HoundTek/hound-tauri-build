/**
 * @file 差量渲染出口（Screen）
 * @description 双缓冲（front/back）+ 逐帧 diff：只重绘变化的格子，
 *   行内按样式合并 run，行间用绝对定位（CUP）。帧输出用 DEC ?2026 同步输出
 *   包裹（终端支持时），消除绘制过程中的撕裂帧。
 *   调用方每帧拿后台缓冲绘制（frame(draw)），flush 自动做最小输出。
 * @module lib/term/screen
 * @see docs/tui-cell-refactor.md §2.4
 */

const { TermBuffer } = require('./buffer.cjs');
const { sameStyle, sameCell, degradeStyle, BLANK } = require('./cell.cjs');
const { styleToAnsi, isDefaultStyle, linkOpenSeq, LINK_CLOSE } = require('./sgr.cjs');
const { getCaps } = require('./caps.cjs');

/** 脏行比例超过该阈值时整帧重绘（比逐行定位更省） */
const FULL_REDRAW_RATIO = 0.7;

class Screen {
  /**
   * @param {NodeJS.WriteStream | { write: (s: string) => void, columns?: number, rows?: number }} out
   * @param {object} [opts]
   * @param {import('./caps.cjs').TermCaps} [opts.caps] - 缺省 detectCaps()
   * @param {number} [opts.cols]
   * @param {number} [opts.rows]
   */
  constructor(out, opts = {}) {
    this.out = out;
    this.caps = opts.caps || getCaps();
    this.cols = Math.max(1, opts.cols || out.columns || 80);
    this.rows = Math.max(1, opts.rows || out.rows || 24);
    this.front = new TermBuffer(this.cols, this.rows);
    this.back = new TermBuffer(this.cols, this.rows);
    this.entered = false;
    this._fullRedraw = true;
  }

  /** 进入 TUI：备用屏幕 + 隐藏光标 + 清屏 */
  enter() {
    this.out.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[1;1H');
    this.entered = true;
    this._fullRedraw = true;
  }

  /** 退出 TUI：恢复光标与主屏幕 */
  exit() {
    this.out.write('\x1b[?25h\x1b[?1049l');
    this.entered = false;
  }

  /**
   * 尺寸变化：双缓冲同步 resize，并强制下一帧整帧重绘。
   * @param {number} cols
   * @param {number} rows
   * @returns {void}
   */
  resize(cols, rows) {
    this.cols = Math.max(1, cols | 0);
    this.rows = Math.max(1, rows | 0);
    this.front.resize(this.cols, this.rows);
    this.back.resize(this.cols, this.rows);
    this._fullRedraw = true;
  }

  /**
   * 绘制一帧并 flush：后台缓冲清空后交给 draw 绘制，然后差量输出。
   * @param {(buf: TermBuffer) => void} draw
   * @returns {void}
   */
  frame(draw) {
    this.back.clear();
    draw(this.back);
    this.flush();
  }

  /**
   * 比较 front/back，输出最小 ANSI 序列；无变化时不输出任何内容。
   * @returns {void}
   */
  flush() {
    const out = this._diff();
    if (out) {
      this.out.write(this.caps.syncOutput ? `\x1b[?2026h${out}\x1b[?2026l` : out);
    }
    // 交换前后缓冲（旧 front 作为下一帧的 back 复用）
    const t = this.front;
    this.front = this.back;
    this.back = t;
    this._fullRedraw = false;
  }

  /**
   * 计算本帧的 ANSI 输出（无变化返回 ''）。
   * @returns {string}
   */
  _diff() {
    const { rows, cols, front, back, caps } = this;

    // 逐行找脏区间 [x0, x1]
    const dirty = [];
    for (let y = 0; y < rows; y++) {
      let x0 = -1;
      let x1 = -1;
      for (let x = 0; x < cols; x++) {
        if (!sameCell(front.grid[y][x], back.grid[y][x])) {
          if (x0 < 0) x0 = x;
          x1 = x;
        }
      }
      if (x0 >= 0) {
        // x1 是宽字符主格时带上续格
        if (back.grid[y][x1].w === 2 && x1 + 1 < cols) x1++;
        dirty.push({ y, x0, x1 });
      }
    }
    if (dirty.length === 0 && !this._fullRedraw) return '';

    const full = this._fullRedraw || dirty.length > rows * FULL_REDRAW_RATIO;

    let out = '';
    let curStyle = null; // 当前生效样式（null = 默认）
    let curLink = false;

    const closeStyle = () => {
      if (curLink) out += LINK_CLOSE;
      if (curStyle !== null) out += '\x1b[0m';
      curStyle = null;
      curLink = false;
    };
    const emitStyle = (st) => {
      if (curStyle !== null && sameStyle(curStyle, st)) return;
      closeStyle();
      if (!isDefaultStyle(st) || st.link) {
        const s = caps ? degradeStyle(st, caps) : st;
        out += styleToAnsi(s);
        if (s.link) {
          out += linkOpenSeq(s);
          curLink = true;
        }
        curStyle = st;
      }
    };
    const emitRow = (y, x0, x1) => {
      out += `\x1b[${y + 1};${x0 + 1}H`;
      for (let x = x0; x <= x1; x++) {
        const c = back.grid[y][x];
        if (c.w === 0) continue; // 续格由主格文本覆盖
        emitStyle(c);
        out += c.text;
      }
    };

    if (full) {
      for (let y = 0; y < rows; y++) emitRow(y, 0, cols - 1);
    } else {
      for (const { y, x0, x1 } of dirty) emitRow(y, x0, x1);
    }
    closeStyle();
    return out;
  }
}

module.exports = { Screen, FULL_REDRAW_RATIO };
