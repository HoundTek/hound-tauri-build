/**
 * @file 终端二维格子缓冲（TermBuffer）
 * @description rows × cols 的 Cell 网格，所有绘制越界静默裁剪。
 *   严格执行宽字符规则：w=2 主格 + w=0 续格成对维护；覆盖半字时清理另一半；
 *   行尾放不下宽字符时整个裁剪。组件既可 write(raw 字符串) 也可 set(格子)。
 * @module lib/term/buffer
 * @see docs/tui-cell-refactor.md §2.3
 */

const core = require('./core.cjs');
const {
  BLANK, defaultStyle, sameStyle, degradeStyle,
} = require('./cell.cjs');
const { styleToAnsi, isDefaultStyle, linkOpenSeq, LINK_CLOSE } = require('./sgr.cjs');

class TermBuffer {
  /**
   * @param {number} cols
   * @param {number} rows
   */
  constructor(cols, rows) {
    this.cols = Math.max(0, cols | 0);
    this.rows = Math.max(0, rows | 0);
    this.grid = [];
    for (let y = 0; y < this.rows; y++) this.grid.push(new Array(this.cols).fill(BLANK));
  }

  /**
   * 调整尺寸，保留左上角重叠区域的内容。
   * @param {number} cols
   * @param {number} rows
   * @returns {void}
   */
  resize(cols, rows) {
    cols = Math.max(0, cols | 0);
    rows = Math.max(0, rows | 0);
    const grid = [];
    for (let y = 0; y < rows; y++) {
      const row = new Array(cols).fill(BLANK);
      if (y < this.rows) {
        for (let x = 0; x < Math.min(cols, this.cols); x++) row[x] = this.grid[y][x];
      }
      grid.push(row);
    }
    this.cols = cols;
    this.rows = rows;
    this.grid = grid;
  }

  /** 清空为空白格 */
  clear() {
    for (let y = 0; y < this.rows; y++) this.grid[y].fill(BLANK);
  }

  /**
   * 读取格子；越界返回 BLANK。
   * @param {number} x
   * @param {number} y
   * @returns {import('./cell.cjs').Cell}
   */
  get(x, y) {
    if (y < 0 || y >= this.rows || x < 0 || x >= this.cols) return BLANK;
    return this.grid[y][x];
  }

  /**
   * 写入格子（越界静默丢弃）。维护宽字符不变量：
   * 覆盖 w=2 主格时清理其续格；覆盖续格时清理其主格；
   * 行尾放不下的 w=2 格子降级为同样式空格。
   * @param {number} x
   * @param {number} y
   * @param {import('./cell.cjs').Cell} c
   * @returns {void}
   */
  set(x, y, c) {
    if (y < 0 || y >= this.rows || x < 0 || x >= this.cols) return;
    const row = this.grid[y];
    const old = row[x];
    if (old.w === 2 && x + 1 < this.cols) row[x + 1] = BLANK; // 清掉旧主格的续格
    else if (old.w === 0 && x - 1 >= 0) row[x - 1] = BLANK;   // 清掉旧续格的主格
    if (c.w === 2) {
      if (x + 1 >= this.cols) { row[x] = { ...c, text: ' ', w: 1 }; return; } // 行尾放不下整字
      row[x] = c;
      row[x + 1] = { ...c, text: '', w: 0 };
      return;
    }
    row[x] = c;
  }

  /**
   * 解析 raw 字符串并落格，返回结束列（最后写入格子的下一列）。
   * 越界与 maxW 边界自动裁剪；grapheme cluster 永不拆半。
   * @param {number} x
   * @param {number} y
   * @param {string} raw - 含 ANSI 的原始串
   * @param {number} [maxW] - 可写入的最大列数（缺省到行尾）
   * @returns {number} 结束列
   */
  write(x, y, raw, maxW) {
    if (y < 0 || y >= this.rows || !raw) return x;
    const endX = maxW == null ? this.cols : Math.min(this.cols, x + Math.max(0, maxW));
    let cx = x;
    for (const token of core.tokenize(raw)) {
      if (token.w === 0) continue;
      for (const cluster of token.clusters) {
        if (cx + cluster.w > endX) return cx; // 放不下（含半字情形）→ 裁剪剩余
        this.set(cx, y, { text: cluster.text, w: cluster.w, ...token.style });
        cx += cluster.w;
      }
    }
    return cx;
  }

  /**
   * 先按宽度折行再逐行写入。
   * @param {number} x
   * @param {number} y
   * @param {string} raw
   * @param {number} w - 折行宽度
   * @param {number} [h] - 最大行数（缺省到缓冲底）
   * @returns {number} 实际写入的行数
   */
  writeWrapped(x, y, raw, w, h) {
    const lines = core.wrap(raw, w);
    const maxLines = h == null ? this.rows - y : h;
    let n = 0;
    for (const line of lines) {
      if (n >= maxLines || y + n >= this.rows) break;
      this.write(x, y + n, line, w);
      n++;
    }
    return n;
  }

  /**
   * 矩形区域样式覆盖（只改样式，不动文本）——焦点行/选区高亮的正解。
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {Partial<import('./cell.cjs').StyleState>} patch - 要覆盖的样式字段
   * @returns {void}
   */
  fillRect(x, y, w, h, patch) {
    const y1 = Math.min(this.rows, y + h);
    const x1 = Math.min(this.cols, x + w);
    for (let yy = Math.max(0, y); yy < y1; yy++) {
      for (let xx = Math.max(0, x); xx < x1; xx++) {
        this.grid[yy][xx] = { ...this.grid[yy][xx], ...patch };
      }
    }
  }

  /**
   * 区域拷贝（横向滚动：全宽内容缓冲 + 视口 blit 上屏）。
   * 区域边缘切割宽字符时，被切的一半降级为同样式空格。
   * @param {TermBuffer} src
   * @param {number} sx
   * @param {number} sy
   * @param {number} w
   * @param {number} h
   * @param {number} dx
   * @param {number} dy
   * @returns {void}
   */
  blit(src, sx, sy, w, h, dx, dy) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const c = src.get(sx + i, sy + j);
        let out = c;
        if (c.w === 2 && i + 1 >= w) out = { ...c, text: ' ', w: 1 }; // 右缘切掉主格
        else if (c.w === 0 && i === 0) out = { ...c, text: ' ', w: 1 }; // 左缘切入续格
        this.set(dx + i, dy + j, out);
      }
    }
  }

  /**
   * 整缓冲序列化为 raw 行数组（测试与 inline 回退用；渲染出口不走这里）。
   * 行内按 sameStyle 合并 run；行尾空白格裁剪。
   * @param {?object} [caps] - 能力（提供时序列化降级）
   * @returns {string[]}
   */
  toRawLines(caps) {
    const lines = [];
    for (let y = 0; y < this.rows; y++) {
      // 找最后一个非空白格
      let last = this.cols - 1;
      while (last >= 0 && this.grid[y][last] === BLANK) last--;
      if (last < 0) { lines.push(''); continue; }
      let out = '';
      let curStyle = null;  // 原始样式（sameStyle 比较用）
      let openStyle = null; // 实际输出的（降级后）样式；null = 当前无打开样式
      const close = () => {
        if (openStyle && (openStyle.link || !isDefaultStyle(openStyle))) {
          out += (openStyle.link ? LINK_CLOSE : '') + '\x1b[0m';
        }
        openStyle = null;
      };
      for (let x = 0; x <= last; x++) {
        const c = this.grid[y][x];
        if (c.w === 0) continue; // 续格已由主格文本覆盖
        if (!curStyle || !sameStyle(curStyle, c)) {
          close();
          const s = caps ? degradeStyle(c, caps) : c;
          if (!isDefaultStyle(s) || s.link) {
            out += styleToAnsi(s) + linkOpenSeq(s);
            openStyle = s;
          }
          curStyle = c;
        }
        out += c.text;
      }
      close();
      lines.push(out);
    }
    return lines;
  }
}

module.exports = { TermBuffer };
